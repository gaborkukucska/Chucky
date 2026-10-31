// Joint games: a small WebSocket game server inside the Vite dev/preview server.
//
// Players on the same network open the game from the laptop running `npm start`;
// one taps "Create game" and gets a room code (e.g. BARK-27), the others join with it.
//
// The server keeps each room's shared world and relays player updates:
//   - the world seed (every client generates the same trees/boulders)
//   - tree damage and which trees are felled (first "fell" wins)
//   - loose logs and fruit (the first player to grab one gets it)
//   - placed structures, the day/night clock, who is on which team
// Physics runs on every client; the client that created a log (felling, throwing,
// demolishing, a knock-out drop) is its "owner" and sends position corrections.
//
//   ws://<host>/ws/chucky   JSON messages { t: type, ... } - see the handlers below.

import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import type { Plugin } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';

const WS_PATH = '/ws/chucky';
const MAX_PLAYERS = 8;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_LOGS_PER_MESSAGE = 32;
const ROOM_IDLE_MS = 10 * 60 * 1000;     // Empty rooms are kept this long (rejoin after a drop)
const LOG_LIFETIME_MS = 125 * 1000;      // Clients expire loose logs after 120 s
const FOOD_LIFETIME_MS = 10 * 60 * 1000;
const MAX_NAME_LENGTH = 16;
const TEAMS = ['red', 'blue', 'green', 'yellow', 'solo'] as const;
const CODE_WORDS = ['BARK', 'LOGS', 'DAMS', 'TREE', 'MOSS', 'FERN', 'PINE', 'REED', 'OAKS', 'TWIG', 'LEAF', 'ROOT', 'POND', 'WOOD'];

type Vec3 = [number, number, number];
type Team = typeof TEAMS[number];

interface LogEntry {
    id: string;
    position: Vec3;
    rotation: Vec3;
    value: number;
    velocity?: Vec3;
    thrown?: boolean;
    thrownBy?: string;
    team?: Team;
    woodOnly?: boolean;
    owner: string;
    createdAt: number;   // Server time
}

interface FoodEntry {
    id: string;
    position: Vec3;
    type: 'apple' | 'berry';
    createdAt: number;
}

interface StructureEntry {
    id: string;
    blueprintId: string;
    position: Vec3;
    rotation: Vec3;
    health: number;
    maxHealth: number;
    points: number;
    ownerId: string;
    team: Team;
}

interface Player {
    id: string;
    name: string;
    team: Team;
    ws: WebSocket;
    state: Record<string, unknown> | null;
}

interface Room {
    code: string;
    seed: number;
    hostId: string;
    players: Map<string, Player>;
    trees: Map<string, { h: number; felled: boolean }>;
    logs: Map<string, LogEntry>;
    food: Map<string, FoodEntry>;
    structures: Map<string, StructureEntry>;
    clock: { tod: number; day: number; at: number; dayDuration: number };
    emptySince: number | null;
}

const rooms = new Map<string, Room>();
let nextPlayer = 1;

// ---------------------------------------------------------------------------
// Validation helpers (everything from the network is untrusted)
// ---------------------------------------------------------------------------
const num = (v: unknown, min: number, max: number, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
const vec3 = (v: unknown, limit = 1000): Vec3 | null =>
    Array.isArray(v) && v.length === 3 && v.every(x => Number.isFinite(Number(x)))
        ? [num(v[0], -limit, limit), num(v[1], -limit, limit), num(v[2], -limit, limit)]
        : null;
const id = (v: unknown) => (typeof v === 'string' ? v.replace(/[^\w\-.:]/g, '').slice(0, 80) : '');
const name = (v: unknown) =>
    (typeof v === 'string' ? v : '').replace(/[^\p{L}\p{N} _\-.!]/gu, '').trim().slice(0, MAX_NAME_LENGTH) || 'Chucky';
const team = (v: unknown): Team => (TEAMS as readonly string[]).includes(v as string) ? v as Team : 'solo';

const cleanLog = (raw: any, owner: string, now: number): LogEntry | null => {
    if (!raw || typeof raw !== 'object') return null;
    const logId = id(raw.id);
    const position = vec3(raw.position);
    if (!logId || !position) return null;
    const velocity = raw.velocity ? vec3(raw.velocity, 100) : null;
    return {
        id: logId,
        position,
        rotation: vec3(raw.rotation, 10) ?? [0, 0, 0],
        value: Math.round(num(raw.value, 1, 10000, 1)),
        ...(velocity ? { velocity } : {}),
        ...(raw.thrown ? { thrown: true, thrownBy: owner, team: team(raw.team) } : {}),
        ...(raw.woodOnly ? { woodOnly: true } : {}),
        owner,
        createdAt: now - num(raw.age, 0, LOG_LIFETIME_MS),
    };
};

const cleanFood = (raw: any, now: number): FoodEntry | null => {
    if (!raw || typeof raw !== 'object') return null;
    const foodId = id(raw.id);
    const position = vec3(raw.position);
    if (!foodId || !position) return null;
    return { id: foodId, position, type: raw.type === 'berry' ? 'berry' : 'apple', createdAt: now };
};

const cleanStructure = (raw: any, player: Player): StructureEntry | null => {
    if (!raw || typeof raw !== 'object') return null;
    const structureId = id(raw.id);
    const position = vec3(raw.position);
    const blueprintId = id(raw.blueprintId);
    if (!structureId || !position || !blueprintId) return null;
    const maxHealth = num(raw.maxHealth, 1, 1e6, 100);
    return {
        id: structureId,
        blueprintId,
        position,
        rotation: vec3(raw.rotation, 10) ?? [0, 0, 0],
        health: num(raw.health, 0, maxHealth, maxHealth),
        maxHealth,
        points: num(raw.points, 0, 1e6),
        ownerId: player.id,
        team: player.team,
    };
};

// Logs as sent to clients: age instead of a timestamp (clocks differ between devices)
const logOut = (l: LogEntry, now: number) => {
    const { createdAt, ...rest } = l;
    return { ...rest, age: Math.max(0, now - createdAt) };
};

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------
const newCode = () => {
    for (let i = 0; i < 200; i++) {
        const code = `${CODE_WORDS[Math.floor(Math.random() * CODE_WORDS.length)]}-${10 + Math.floor(Math.random() * 90)}`;
        if (!rooms.has(code)) return code;
    }
    return `WOOD-${Date.now() % 100000}`;
};

const currentClock = (room: Room, now: number) => {
    const { tod, day, at, dayDuration } = room.clock;
    const total = tod + (now - at) / 1000 / dayDuration;
    return { tod: total - Math.floor(total), day: day + Math.floor(total), dayDuration };
};

const send = (ws: WebSocket, msg: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

const broadcast = (room: Room, msg: unknown, exceptId?: string) => {
    const data = JSON.stringify(msg);
    for (const p of room.players.values()) {
        if (p.id !== exceptId && p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
    }
};

const playerInfo = (p: Player) => ({ id: p.id, name: p.name, team: p.team, state: p.state });

const snapshot = (room: Room, you: Player) => {
    const now = Date.now();
    return {
        t: 'welcome',
        you: you.id,
        code: room.code,
        seed: room.seed,
        host: room.hostId === you.id,
        players: [...room.players.values()].filter(p => p.id !== you.id).map(playerInfo),
        trees: [...room.trees.entries()].map(([treeId, s]) => [treeId, s.h, s.felled ? 1 : 0]),
        logs: [...room.logs.values()].map(l => logOut(l, now)),
        food: [...room.food.values()].map(f => ({ id: f.id, position: f.position, type: f.type })),
        structures: [...room.structures.values()],
        clock: currentClock(room, now),
    };
};

const pruneRoom = (room: Room, now: number) => {
    for (const [logId, l] of room.logs) if (now - l.createdAt > LOG_LIFETIME_MS) room.logs.delete(logId);
    for (const [foodId, f] of room.food) if (now - f.createdAt > FOOD_LIFETIME_MS) room.food.delete(foodId);
};

const leaveRoom = (room: Room, player: Player) => {
    if (!room.players.delete(player.id)) return;
    broadcast(room, { t: 'left', id: player.id });
    if (room.players.size === 0) {
        room.emptySince = Date.now();
    } else if (room.hostId === player.id) {
        // Someone else keeps the day/night clock going
        room.hostId = room.players.keys().next().value as string;
        const host = room.players.get(room.hostId);
        if (host) send(host.ws, { t: 'host' });
    }
};

// Forget rooms that stayed empty for a while
setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
        if (room.emptySince !== null && now - room.emptySince > ROOM_IDLE_MS) rooms.delete(code);
        else pruneRoom(room, now);
    }
}, 30 * 1000).unref?.();

// ---------------------------------------------------------------------------
// Connection handling
// ---------------------------------------------------------------------------
const onConnection = (ws: WebSocket) => {
    let room: Room | null = null;
    let player: Player | null = null;

    const join = (target: Room, playerName: unknown, playerTeam: unknown) => {
        if (target.players.size >= MAX_PLAYERS) {
            send(ws, { t: 'error', message: `That game is full (${MAX_PLAYERS} players).` });
            return;
        }
        player = { id: `p${nextPlayer++}`, name: name(playerName), team: team(playerTeam), ws, state: null };
        room = target;
        target.emptySince = null;
        if (!target.players.size) target.hostId = player.id;
        target.players.set(player.id, player);
        pruneRoom(target, Date.now());
        send(ws, snapshot(target, player));
        broadcast(target, { t: 'joined', player: playerInfo(player) }, player.id);
    };

    ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        const text = data.toString();
        if (text.length > MAX_MESSAGE_BYTES) return;
        let msg: any;
        try {
            msg = JSON.parse(text);
        } catch {
            return;
        }
        if (!msg || typeof msg !== 'object') return;
        const now = Date.now();

        // --- Before joining ---
        if (!room || !player) {
            if (msg.t === 'create') {
                const code = newCode();
                const created: Room = {
                    code,
                    seed: Math.floor(num(msg.seed, 0, 2147483646, Math.random() * 2147483646)),
                    hostId: '',
                    players: new Map(),
                    trees: new Map(),
                    logs: new Map(),
                    food: new Map(),
                    structures: new Map(),
                    clock: { tod: num(msg.tod, 0, 0.999, 0.08), day: 1, at: now, dayDuration: num(msg.dayDuration, 30, 3600, 300) },
                    emptySince: null,
                };
                rooms.set(code, created);
                join(created, msg.name, msg.team);
            } else if (msg.t === 'join') {
                const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^([A-Z]+)(\d+)$/, '$1-$2');
                const target = rooms.get(code);
                if (!target) send(ws, { t: 'error', message: `No game with code ${code || '?'} on this server.` });
                else join(target, msg.name, msg.team);
            }
            return;
        }

        const r: Room = room;
        const me: Player = player;

        switch (msg.t) {
            case 'state': {
                // Position/animation 10x a second - relayed, the last one kept for late joiners
                const p = vec3(msg.p);
                if (!p) return;
                me.state = {
                    p,
                    f: num(msg.f, -1e4, 1e4),
                    sw: !!msg.sw,
                    dv: !!msg.dv,
                    ch: !!msg.ch,
                    ko: !!msg.ko,
                    s: Math.round(num(msg.s, 0, 1e9)),
                    w: Math.round(num(msg.w, 0, 1e9)),
                };
                broadcast(r, { t: 'state', id: me.id, ...me.state }, me.id);
                break;
            }
            case 'clock': {
                if (r.hostId !== me.id) return;
                r.clock = { tod: num(msg.tod, 0, 0.9999), day: Math.round(num(msg.day, 1, 1e6, 1)), at: now, dayDuration: r.clock.dayDuration };
                broadcast(r, { t: 'clock', ...currentClock(r, now) }, me.id);
                break;
            }
            case 'tree': {
                const treeId = id(msg.id);
                if (!treeId) return;
                const prev = r.trees.get(treeId);
                if (prev?.felled) return;
                const h = Math.min(prev ? prev.h : Infinity, num(msg.h, 0, 1e6));
                r.trees.set(treeId, { h, felled: false });
                broadcast(r, { t: 'tree', id: treeId, h }, me.id);
                break;
            }
            case 'fell': {
                const treeId = id(msg.id);
                if (!treeId) return;
                const logs = (Array.isArray(msg.logs) ? msg.logs : []).slice(0, MAX_LOGS_PER_MESSAGE).map((l: any) => cleanLog(l, me.id, now)).filter(Boolean) as LogEntry[];
                const food = (Array.isArray(msg.food) ? msg.food : []).slice(0, 4).map((f: any) => cleanFood(f, now)).filter(Boolean) as FoodEntry[];
                if (r.trees.get(treeId)?.felled) {
                    // Someone else felled it first: the sender removes what it spawned
                    send(ws, { t: 'fellRejected', id: treeId, logs: logs.map(l => l.id), food: food.map(f => f.id) });
                    return;
                }
                r.trees.set(treeId, { h: 0, felled: true });
                logs.forEach(l => r.logs.set(l.id, l));
                food.forEach(f => r.food.set(f.id, f));
                broadcast(r, { t: 'felled', id: treeId, by: me.id, logs: logs.map(l => logOut(l, now)), food: food.map(f => ({ id: f.id, position: f.position, type: f.type })) }, me.id);
                break;
            }
            case 'addLogs': {
                // Thrown logs, knock-out drops
                const logs = (Array.isArray(msg.logs) ? msg.logs : []).slice(0, MAX_LOGS_PER_MESSAGE).map((l: any) => cleanLog(l, me.id, now)).filter(Boolean) as LogEntry[];
                if (!logs.length) return;
                logs.forEach(l => r.logs.set(l.id, l));
                broadcast(r, { t: 'logs', by: me.id, logs: logs.map(l => logOut(l, now)) }, me.id);
                break;
            }
            case 'logPos': {
                // Position corrections from a log's owner: [[id, x, y, z, qx, qy, qz, qw], ...]
                if (!Array.isArray(msg.u)) return;
                const out: unknown[] = [];
                for (const u of msg.u.slice(0, 256)) {
                    if (!Array.isArray(u) || u.length !== 8) continue;
                    const log = r.logs.get(id(u[0]));
                    if (!log || log.owner !== me.id) continue;
                    const v = u.slice(1).map((x: unknown) => num(x, -1000, 1000));
                    log.position = [v[0], v[1], v[2]];
                    out.push([log.id, ...v]);
                }
                if (out.length) broadcast(r, { t: 'logPos', u: out }, me.id);
                break;
            }
            case 'take': {
                // Pick up a log/fruit, or catch a team mate's throw: first come, first served
                const kind = msg.kind === 'food' ? 'food' : 'log';
                const takeId = id(msg.id);
                if (kind === 'log') {
                    const log = r.logs.get(takeId);
                    if (!log) return send(ws, { t: 'taken', kind, id: takeId, ok: false });
                    r.logs.delete(takeId);
                    send(ws, { t: 'taken', kind, id: takeId, ok: true, value: log.value, woodOnly: !!(log.woodOnly || log.thrown), catch: !!msg.catch });
                    broadcast(r, { t: 'gone', kind, id: takeId, by: me.id }, me.id);
                    if (msg.catch && log.thrownBy) broadcast(r, { t: 'feed', kind: 'catch', a: me.id, b: log.thrownBy });
                } else {
                    const food = r.food.get(takeId);
                    if (!food) return send(ws, { t: 'taken', kind, id: takeId, ok: false });
                    r.food.delete(takeId);
                    send(ws, { t: 'taken', kind, id: takeId, ok: true });
                    broadcast(r, { t: 'gone', kind, id: takeId, by: me.id }, me.id);
                }
                break;
            }
            case 'place': {
                const s = cleanStructure(msg.s, me);
                if (!s) return;
                r.structures.set(s.id, s);
                broadcast(r, { t: 'placed', s }, me.id);
                break;
            }
            case 'demolish': {
                const structureId = id(msg.id);
                const s = r.structures.get(structureId);
                if (!s) return;
                // Only your own structures, or your team's
                if (s.ownerId !== me.id && (me.team === 'solo' || s.team !== me.team)) return;
                r.structures.delete(structureId);
                const logs = (Array.isArray(msg.logs) ? msg.logs : []).slice(0, MAX_LOGS_PER_MESSAGE).map((l: any) => cleanLog(l, me.id, now)).filter(Boolean) as LogEntry[];
                logs.forEach(l => r.logs.set(l.id, l));
                broadcast(r, { t: 'demolished', id: structureId, by: me.id, logs: logs.map(l => logOut(l, now)) }, me.id);
                break;
            }
            case 'hit': {
                // A thrown log hit this player (the victim reports it)
                const by = id(msg.by);
                if (r.players.has(by)) broadcast(r, { t: 'feed', kind: 'hit', a: by, b: me.id });
                break;
            }
            case 'ko': {
                const by = id(msg.by);
                broadcast(r, { t: 'feed', kind: 'ko', a: r.players.has(by) ? by : '', b: me.id });
                break;
            }
            case 'leave': {
                leaveRoom(r, me);
                room = null;
                player = null;
                break;
            }
        }
    });

    ws.on('close', () => {
        if (room && player) leaveRoom(room, player);
        room = null;
        player = null;
    });
    ws.on('error', () => { /* 'close' follows */ });
};

const attach = (httpServer: { on: (event: 'upgrade', cb: (req: IncomingMessage, socket: Duplex, head: Buffer) => void) => void } | null | undefined) => {
    if (!httpServer) return;
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
    wss.on('connection', onConnection);
    httpServer.on('upgrade', (req, socket, head) => {
        // Vite's own hot-reload socket uses the same server: only take our path
        if ((req.url || '').split('?')[0] !== WS_PATH) return;
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
};

export const multiplayerServer = (): Plugin => ({
    name: 'chucky-multiplayer',
    configureServer(server) {
        attach(server.httpServer as any);
    },
    configurePreviewServer(server) {
        attach(server.httpServer as any);
    },
});
