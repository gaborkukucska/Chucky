// Shared leaderboard API, served by the Vite dev/preview server.
//
// Every device that opens the game from this server (laptop, phones on the LAN)
// reads and writes the same board. Entries are stored in data/leaderboard.json
// in the project folder. The game falls back to a per-device leaderboard if this
// API isn't reachable (e.g. the built game hosted somewhere without it).
//
//   GET  /api/leaderboard          -> { entries: LeaderboardEntry[] }  (top 20)
//   POST /api/leaderboard  {entry} -> { rank: number, entries: [...] } (upsert by id)

import fs from 'fs';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Plugin } from 'vite';

interface Entry {
    id: string;
    name: string;
    score: number;
    logs: number;
    structures: number;
    day: number;
    date: number;
}

const MAX_STORED = 100;      // Kept on disk
const MAX_RETURNED = 20;     // Sent to clients
const MAX_BODY_BYTES = 4096;
const MAX_NAME_LENGTH = 16;

const dataFile = () => path.resolve(process.cwd(), 'data', 'leaderboard.json');

let cache: Entry[] | null = null;

const load = (): Entry[] => {
    if (cache) return cache;
    try {
        const parsed = JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
        cache = Array.isArray(parsed) ? parsed.map(clean).filter((e): e is Entry => e !== null) : [];
    } catch {
        cache = [];
    }
    return cache;
};

const persist = (list: Entry[]) => {
    cache = list;
    try {
        const file = dataFile();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(list, null, 1));
        fs.renameSync(tmp, file); // Atomic replace - never leaves a half-written file
    } catch (e) {
        console.warn('[Chucky leaderboard] Could not write', dataFile(), e);
    }
};

const int = (v: unknown, max: number) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
};

function clean(raw: any): Entry | null {
    if (!raw || typeof raw !== 'object') return null;
    const id = typeof raw.id === 'string' ? raw.id.replace(/[^\w\-.:]/g, '').slice(0, 64) : '';
    if (!id) return null;
    const name = (typeof raw.name === 'string' ? raw.name : '')
        .replace(/[^\p{L}\p{N} _\-.!]/gu, '')
        .trim()
        .slice(0, MAX_NAME_LENGTH) || 'Chucky';
    return {
        id,
        name,
        score: int(raw.score, 1e9),
        logs: int(raw.logs, 1e9),
        structures: int(raw.structures, 1e6),
        day: Math.max(1, int(raw.day, 1e6)),
        date: int(raw.date, 8.64e15) || Date.now(),
    };
}

const sortEntries = (list: Entry[]) => list.sort((a, b) => b.score - a.score || a.date - b.date);

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage) => new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            reject(new Error('Body too large'));
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
});

const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = (req.url || '').split('?')[0];
    if (url !== '/api/leaderboard') return next();

    if (req.method === 'GET') {
        sendJson(res, 200, { entries: load().slice(0, MAX_RETURNED) });
        return;
    }

    if (req.method === 'POST') {
        readBody(req)
            .then((body) => {
                const entry = clean(JSON.parse(body));
                if (!entry) return sendJson(res, 400, { error: 'Invalid entry' });
                const list = sortEntries([...load().filter(e => e.id !== entry.id), entry]);
                const rank = list.findIndex(e => e.id === entry.id) + 1;
                persist(list.slice(0, MAX_STORED));
                sendJson(res, 200, { rank: rank <= MAX_STORED ? rank : -1, entries: list.slice(0, MAX_RETURNED) });
            })
            .catch(() => sendJson(res, 400, { error: 'Bad request' }));
        return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
};

export const leaderboardApi = (): Plugin => ({
    name: 'chucky-leaderboard-api',
    configureServer(server) {
        server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
        server.middlewares.use(handler);
    },
});
