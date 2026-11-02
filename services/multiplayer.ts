// Joint games - the client side (server: server/multiplayerServer.ts).
//
// Connects to ws://<the page's host>/ws/chucky, creates or joins a room, and keeps
// the local store in step with the shared world:
//   outgoing: our position 10x/s, tree damage, felled trees, thrown/dropped logs,
//             pick-up requests (first come, first served), placed/demolished structures
//   incoming: other players, the same events from them, the day/night clock
//
// High-frequency data (other players' positions, log corrections) goes into the
// `remotePlayers` / `logCorrections` maps below so it never re-renders React.
// UI state (status, room code, players, feed) lives in the store's `mp` slice.

import { useGameStore } from '../store';
import type { LooseLogData, FoodData, PlacedStructure } from '../types';

export type Team = 'red' | 'blue' | 'green' | 'yellow' | 'solo';
export const TEAMS: Team[] = ['red', 'blue', 'green', 'yellow', 'solo'];
export const TEAM_INFO: Record<Team, { label: string; color: string; emoji: string }> = {
    red: { label: 'Red', color: '#ef4444', emoji: '🔴' },
    blue: { label: 'Blue', color: '#3b82f6', emoji: '🔵' },
    green: { label: 'Green', color: '#22c55e', emoji: '🟢' },
    yellow: { label: 'Yellow', color: '#eab308', emoji: '🟡' },
    solo: { label: 'Solo', color: '#e5e7eb', emoji: '⚪' },
};

export type MpStatus = 'off' | 'connecting' | 'playing' | 'lost';

export interface MpPlayer {
    id: string;
    name: string;
    team: Team;
    score: number;
    ko: boolean;
}

export interface MpFeedItem {
    id: number;
    text: string;
    at: number;
}

export interface MpState {
    status: MpStatus;
    code: string;
    myId: string;
    team: Team;
    isHost: boolean;
    players: Record<string, MpPlayer>;
    feed: MpFeedItem[];
    error: string | null;
    invite: boolean;   // The invite QR code is showing (pops up after creating a game)
}

export const MP_OFF: MpState = { status: 'off', code: '', myId: '', team: 'solo', isHost: false, players: {}, feed: [], error: null, invite: false };

// --- Per-frame data, read by components without re-rendering ---
export interface RemoteSample {
    t: number;                       // Local receive time (ms)
    p: [number, number, number];
    f: number;
    sw: boolean;
    sh: boolean;                     // Log Shield active
    dv: boolean;
    ch: boolean;
    ko: boolean;
}
export const remotePlayers = new Map<string, { samples: RemoteSample[] }>();
/** Owner position updates for loose logs: id -> [x, y, z, qx, qy, qz, qw] */
export const logCorrections = new Map<string, number[]>();
/** Our own logs that moved, flushed a few times per second: id -> [x, y, z, qx, qy, qz, qw] */
export const outgoingLogPositions = new Map<string, number[]>();

const STATE_INTERVAL_MS = 100;
const LOG_POS_INTERVAL_MS = 250;
const CLOCK_INTERVAL_MS = 5000;
const TREE_REPORT_INTERVAL_MS = 250;
const FEED_LIFETIME_MS = 6000;
const FEED_MAX = 5;
const MAX_SAMPLES = 20;
const CONNECT_TIMEOUT_MS = 6000;

type Vec3 = [number, number, number];

const round = (v: number) => Math.round(v * 1000) / 1000;

/** A log as sent over the network (age instead of a timestamp - device clocks differ) */
const logToWire = (l: LooseLogData, now: number) => ({
    id: l.id,
    position: l.position.map(round),
    rotation: l.rotation.map(round),
    value: l.value ?? 1,
    ...(l.velocity ? { velocity: l.velocity.map(round) } : {}),
    ...(l.spin ? { spin: l.spin.map(round) } : {}),
    ...(l.fleeting ? { fleeting: true } : {}),
    ...(l.thrown ? { thrown: true, team: l.team } : {}),
    ...(l.woodOnly ? { woodOnly: true } : {}),
    age: Math.max(0, now - l.createdAt),
});

/** A log received from the network */
export const logFromWire = (w: any, now: number): LooseLogData => {
    const age = Math.max(0, Number(w.age) || 0);
    const landed = age > 3000; // Already at rest on the owner's screen: no launch / pop
    return {
        id: String(w.id),
        position: w.position as Vec3,
        rotation: (w.rotation as Vec3) ?? [0, 0, 0],
        createdAt: now - age,
        value: w.value ?? 1,
        owner: w.owner,
        ...(w.thrown ? { thrown: true, thrownBy: w.thrownBy, team: w.team } : {}),
        ...(w.woodOnly ? { woodOnly: true } : {}),
        ...(w.fleeting ? { fleeting: true } : {}),
        ...(landed ? { settled: true } : (w.velocity ? { velocity: w.velocity as Vec3 } : {})),
        ...(!landed && Array.isArray(w.spin) ? { spin: w.spin as Vec3 } : {}),
    };
};

const foodFromWire = (w: any, now: number): FoodData => ({
    id: String(w.id),
    position: w.position as Vec3,
    rotation: [0, 0, 0],
    createdAt: now,
    type: w.type === 'berry' ? 'berry' : 'apple',
});

class MultiplayerClient {
    private ws: WebSocket | null = null;
    private lastState = 0;
    private lastLogPos = 0;
    private lastClock = 0;
    private treeReports = new Map<string, { h: number; sentAt: number; pending: boolean }>();
    private feedId = 0;
    private connectTimer: ReturnType<typeof setTimeout> | null = null;
    private creating = false; // This connection creates a game (then the invite pops up)

    myId = '';
    team: Team = 'solo';

    /** In a joint game right now */
    get active() {
        return useGameStore.getState().mp.status === 'playing';
    }

    // ------------------------------------------------------------------
    // Connecting
    // ------------------------------------------------------------------
    /** code: the game code to use (empty = a random one) */
    create(name: string, team: Team, code = '') {
        const s = useGameStore.getState();
        this.open({ t: 'create', name, team, code, seed: Math.floor(Math.random() * 2147483646), tod: 0.08, dayDuration: s.dayDuration }, team);
    }

    join(code: string, name: string, team: Team) {
        this.open({ t: 'join', code, name, team }, team);
    }

    private open(hello: Record<string, unknown>, team: Team) {
        this.close();
        this.team = team;
        this.creating = hello.t === 'create';
        this.setMp({ ...MP_OFF, status: 'connecting', team });
        let ws: WebSocket;
        try {
            const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
            ws = new WebSocket(`${proto}://${window.location.host}/ws/chucky`);
        } catch {
            this.fail('Could not open a connection to the game server.');
            return;
        }
        this.ws = ws;
        this.connectTimer = setTimeout(() => {
            if (useGameStore.getState().mp.status === 'connecting') this.fail('The game server did not answer. Is the game running with npm start on this network?');
        }, CONNECT_TIMEOUT_MS);
        ws.onopen = () => ws.send(JSON.stringify(hello));
        ws.onmessage = (e) => {
            let msg: any;
            try {
                msg = JSON.parse(String(e.data));
            } catch {
                return;
            }
            this.handle(msg);
        };
        ws.onclose = () => {
            if (this.ws !== ws) return;
            this.ws = null;
            const status = useGameStore.getState().mp.status;
            if (status === 'connecting') this.fail('Could not connect to the game server.');
            else if (status === 'playing') this.setMp({ status: 'lost' });
        };
    }

    private fail(message: string) {
        this.close();
        this.setMp({ ...MP_OFF, error: message });
    }

    /** Leave the joint game (back to the start screen) */
    leave() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'leave' }));
        this.close();
        this.setMp({ ...MP_OFF });
        useGameStore.setState({ phase: 'START', isGameMenuOpen: false, isBuildMenuOpen: false, isPlacementMode: false, koUntil: 0 });
    }

    clearError() {
        this.setMp({ error: null });
    }

    /** Show or hide the invite QR code */
    showInvite(open: boolean) {
        this.setMp({ invite: open });
    }

    private close() {
        if (this.connectTimer) clearTimeout(this.connectTimer);
        this.connectTimer = null;
        const ws = this.ws;
        this.ws = null;
        if (ws) {
            ws.onclose = null;
            try { ws.close(); } catch { /* ignore */ }
        }
        remotePlayers.clear();
        logCorrections.clear();
        outgoingLogPositions.clear();
        this.treeReports.clear();
    }

    private send(msg: unknown) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    }

    private setMp(patch: Partial<MpState>) {
        useGameStore.setState(state => ({ mp: { ...state.mp, ...patch } }));
    }

    private playerName(id: string) {
        if (id === this.myId) return 'You';
        return useGameStore.getState().mp.players[id]?.name ?? 'Someone';
    }

    private addFeed(text: string) {
        const now = Date.now();
        const item = { id: ++this.feedId, text, at: now };
        useGameStore.setState(state => ({
            mp: { ...state.mp, feed: [...state.mp.feed.filter(f => now - f.at < FEED_LIFETIME_MS), item].slice(-FEED_MAX) },
        }));
    }

    // ------------------------------------------------------------------
    // Incoming
    // ------------------------------------------------------------------
    private handle(msg: any) {
        const now = Date.now();
        const store = useGameStore;
        switch (msg.t) {
            case 'welcome': {
                if (this.connectTimer) clearTimeout(this.connectTimer);
                this.connectTimer = null;
                this.myId = String(msg.you);
                const players: Record<string, MpPlayer> = {};
                remotePlayers.clear();
                for (const p of msg.players || []) {
                    players[p.id] = { id: p.id, name: p.name, team: p.team, score: p.state?.s ?? 0, ko: !!p.state?.ko };
                    if (p.state) this.pushSample(p.id, p.state, now);
                }
                // Same world for everyone: generate it from the room's seed, then apply what changed
                store.getState().startGame(Number(msg.seed));
                store.setState(state => {
                    const treeState = new Map<string, [number, number]>((msg.trees || []).map((t: any) => [String(t[0]), [Number(t[1]), Number(t[2])]]));
                    return {
                        trees: state.trees.map(t => {
                            const ts = treeState.get(t.id);
                            return ts ? { ...t, health: ts[1] ? 0 : Math.min(t.health, ts[0]), isFelled: !!ts[1] } : t;
                        }),
                        looseLogs: (msg.logs || []).map((l: any) => logFromWire(l, now)),
                        food: (msg.food || []).map((f: any) => foodFromWire(f, now)),
                        placedStructures: (msg.structures || []) as PlacedStructure[],
                        timeOfDay: Number(msg.clock?.tod ?? state.timeOfDay),
                        day: Number(msg.clock?.day ?? state.day),
                        mp: { ...state.mp, status: 'playing', code: String(msg.code), myId: this.myId, team: this.team, isHost: !!msg.host, players, error: null, invite: this.creating },
                        runId: state.runId + 1, // Spawn again now the team is known: at its corner of the map
                    };
                });
                try { window.localStorage.setItem('chucky.lastCode', String(msg.code)); } catch { /* ignore */ }
                this.addFeed(`Joined ${msg.code} - ☰ → Players & invite shows a QR code for friends`);
                break;
            }
            case 'error':
                this.fail(String(msg.message || 'Something went wrong.'));
                break;
            case 'host':
                this.setMp({ isHost: true });
                break;
            case 'joined': {
                const p = msg.player;
                store.setState(state => ({ mp: { ...state.mp, players: { ...state.mp.players, [p.id]: { id: p.id, name: p.name, team: p.team, score: 0, ko: false } } } }));
                this.addFeed(`${p.name} joined (${TEAM_INFO[p.team as Team]?.label ?? 'Solo'})`);
                break;
            }
            case 'left': {
                const name = this.playerName(msg.id);
                remotePlayers.delete(msg.id);
                store.setState(state => {
                    const players = { ...state.mp.players };
                    delete players[msg.id];
                    return { mp: { ...state.mp, players } };
                });
                this.addFeed(`${name} left`);
                break;
            }
            case 'state': {
                this.pushSample(msg.id, msg, now);
                // Score / knock-out for the UI: only when they change (positions never touch the store)
                const p = store.getState().mp.players[msg.id];
                if (p && (p.score !== msg.s || p.ko !== !!msg.ko)) {
                    store.setState(state => ({ mp: { ...state.mp, players: { ...state.mp.players, [msg.id]: { ...p, score: msg.s, ko: !!msg.ko } } } }));
                }
                break;
            }
            case 'clock': {
                const s = store.getState();
                const tod = Number(msg.tod);
                const day = Number(msg.day);
                const drift = Math.abs((s.day + s.timeOfDay) - (day + tod));
                if (drift > 0.003) store.setState({ timeOfDay: tod, day });
                break;
            }
            case 'tree':
                store.setState(state => ({
                    trees: state.trees.map(t => (t.id === msg.id && !t.isFelled && msg.h < t.health ? { ...t, health: msg.h } : t)),
                }));
                break;
            case 'felled': {
                const logs = (msg.logs || []).map((l: any) => logFromWire(l, now));
                const food = (msg.food || []).map((f: any) => foodFromWire(f, now));
                store.setState(state => ({
                    trees: state.trees.map(t => (t.id === msg.id ? { ...t, health: 0, isFelled: true } : t)),
                    activeTreeId: state.activeTreeId === msg.id ? null : state.activeTreeId,
                    looseLogs: [...state.looseLogs, ...logs],
                    food: [...state.food, ...food],
                }));
                break;
            }
            case 'fellRejected': {
                // Someone else felled it first - take back the logs/fruit we spawned for it
                const logIds = new Set<string>(msg.logs || []);
                const foodIds = new Set<string>(msg.food || []);
                store.setState(state => ({
                    looseLogs: state.looseLogs.filter(l => !logIds.has(l.id)),
                    food: state.food.filter(f => !foodIds.has(f.id)),
                }));
                break;
            }
            case 'logs': {
                const logs = (msg.logs || []).map((l: any) => logFromWire(l, now));
                store.setState(state => ({ looseLogs: [...state.looseLogs, ...logs] }));
                break;
            }
            case 'logPos':
                for (const u of msg.u || []) logCorrections.set(String(u[0]), u.slice(1).map(Number));
                break;
            case 'taken': {
                if (!msg.ok) {
                    // Someone else got it first - it disappears with their 'gone' message
                    if (msg.kind === 'log') store.setState(state => ({ looseLogs: state.looseLogs.filter(l => l.id !== msg.id) }));
                    else store.setState(state => ({ food: state.food.filter(f => f.id !== msg.id) }));
                    break;
                }
                if (msg.kind === 'log') {
                    store.getState().collectLooseLog(msg.id, true);
                    if (msg.catch) this.addFeed(`Caught a log from a team mate! +${msg.value ?? 1} 🪵`);
                } else {
                    store.getState().collectFood(msg.id);
                }
                break;
            }
            case 'gone':
                logCorrections.delete(msg.id);
                if (msg.kind === 'log') store.setState(state => ({ looseLogs: state.looseLogs.filter(l => l.id !== msg.id) }));
                else store.setState(state => ({ food: state.food.filter(f => f.id !== msg.id) }));
                break;
            case 'placed':
                store.setState(state => ({ placedStructures: [...state.placedStructures.filter(p => p.id !== msg.s.id), msg.s as PlacedStructure] }));
                break;
            case 'demolished': {
                const logs = (msg.logs || []).map((l: any) => logFromWire(l, now));
                store.setState(state => ({
                    placedStructures: state.placedStructures.filter(p => p.id !== msg.id),
                    destroyTargetId: state.destroyTargetId === msg.id ? null : state.destroyTargetId,
                    isDestroying: state.destroyTargetId === msg.id ? false : state.isDestroying,
                    looseLogs: [...state.looseLogs, ...logs],
                }));
                this.addFeed(`${this.playerName(msg.by)} demolished a structure`);
                break;
            }
            case 'feed': {
                // a = the thrower (hit/ko) or the catcher (catch); b = the other player
                const meA = msg.a === this.myId;
                const meB = msg.b === this.myId;
                const a = this.playerName(msg.a);
                const b = this.playerName(msg.b);
                if (msg.kind === 'hit') {
                    this.addFeed(meB ? `${a} bonked you with a log!` : meA ? `You bonked ${b}!` : `${a} bonked ${b} with a log!`);
                } else if (msg.kind === 'ko') {
                    if (!msg.a) this.addFeed(meB ? 'You got knocked out 😵' : `${b} got knocked out 😵`);
                    else this.addFeed(meB ? `${a} knocked you out! 😵` : meA ? `You knocked out ${b}! 😵` : `${a} knocked out ${b}! 😵`);
                } else if (msg.kind === 'catch' && !meA) {
                    this.addFeed(meB ? `${a} caught your log` : `${a} caught ${b}'s log`);
                }
                break;
            }
        }
    }

    private pushSample(id: string, st: any, now: number) {
        if (!Array.isArray(st.p)) return;
        let entry = remotePlayers.get(id);
        if (!entry) {
            entry = { samples: [] };
            remotePlayers.set(id, entry);
        }
        entry.samples.push({ t: now, p: st.p, f: Number(st.f) || 0, sw: !!st.sw, sh: !!st.sh, dv: !!st.dv, ch: !!st.ch, ko: !!st.ko });
        if (entry.samples.length > MAX_SAMPLES) entry.samples.shift();
    }

    // ------------------------------------------------------------------
    // Outgoing (no-ops outside a joint game)
    // ------------------------------------------------------------------

    /** Called every frame by the scene: our state, moved logs, the clock (host) */
    tick(now: number, st: { p: Vec3; f: number; sw: boolean; sh: boolean; dv: boolean; ch: boolean; ko: boolean; s: number; w: number }) {
        if (!this.active) return;
        if (now - this.lastState >= STATE_INTERVAL_MS) {
            this.lastState = now;
            this.send({ t: 'state', ...st, p: st.p.map(round), f: round(st.f) });
        }
        if (now - this.lastLogPos >= LOG_POS_INTERVAL_MS && outgoingLogPositions.size) {
            this.lastLogPos = now;
            const u = [...outgoingLogPositions.entries()].map(([id, v]) => [id, ...v.map(round)]);
            outgoingLogPositions.clear();
            this.send({ t: 'logPos', u });
        }
        const s = useGameStore.getState();
        if (s.mp.isHost && now - this.lastClock >= CLOCK_INTERVAL_MS) {
            this.lastClock = now;
            this.send({ t: 'clock', tod: s.timeOfDay, day: s.day });
        }
        // Trailing tree-health report once chomping a tree stops
        for (const [id, r] of this.treeReports) {
            if (r.pending && now - r.sentAt >= TREE_REPORT_INTERVAL_MS) {
                r.pending = false;
                r.sentAt = now;
                this.send({ t: 'tree', id, h: round(r.h) });
            }
        }
    }

    reportTreeHealth(id: string, h: number) {
        if (!this.active) return;
        const now = Date.now();
        const r = this.treeReports.get(id);
        if (!r || now - r.sentAt >= TREE_REPORT_INTERVAL_MS) {
            this.treeReports.set(id, { h, sentAt: now, pending: false });
            this.send({ t: 'tree', id, h: round(h) });
        } else {
            r.h = h;
            r.pending = true;
        }
    }

    sendFell(id: string, logs: LooseLogData[], food: FoodData[]) {
        if (!this.active) return;
        this.treeReports.delete(id);
        const now = Date.now();
        this.send({ t: 'fell', id, logs: logs.map(l => logToWire(l, now)), food: food.map(f => ({ id: f.id, position: f.position.map(round), type: f.type })) });
    }

    sendLogs(logs: LooseLogData[]) {
        if (!this.active || !logs.length) return;
        const now = Date.now();
        this.send({ t: 'addLogs', logs: logs.map(l => logToWire(l, now)) });
    }

    /** Ask for a log/fruit (first come, first served). The store applies it when granted. */
    take(kind: 'log' | 'food', id: string, isCatch = false) {
        this.send({ t: 'take', kind, id, ...(isCatch ? { catch: true } : {}) });
    }

    sendPlace(s: PlacedStructure) {
        if (this.active) this.send({ t: 'place', s });
    }

    sendDemolish(id: string, logs: LooseLogData[]) {
        if (!this.active) return;
        const now = Date.now();
        this.send({ t: 'demolish', id, logs: logs.map(l => logToWire(l, now)) });
    }

    sendHit(by: string) {
        if (this.active) this.send({ t: 'hit', by });
    }

    sendKnockout(by: string) {
        if (this.active) this.send({ t: 'ko', by });
    }
}

export const multiplayer = new MultiplayerClient();

/** Can this player demolish the structure? Solo games: anything. Joint games: your own, or your team's. */
export const canDemolish = (s: PlacedStructure) => {
    if (!s.ownerId) return true;
    const mp = useGameStore.getState().mp;
    if (mp.status !== 'playing') return true;
    return s.ownerId === mp.myId || (mp.team !== 'solo' && s.team === mp.team);
};
