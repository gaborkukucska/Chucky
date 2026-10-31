// Local persistence for save games, the leaderboard and the player's name.
// Everything lives in the browser's localStorage, so saves and scores are per
// device/browser. All access is wrapped in try/catch: private browsing, blocked
// storage or a full quota must never crash the game.

import { PlacedStructure, CameraMode } from '../types';

export const SAVE_VERSION = 1;
export const SAVE_SLOTS = 3;
const LEADERBOARD_SIZE = 10;
const MAX_NAME_LENGTH = 16;

const slotKey = (slot: number) => `chucky.save.v${SAVE_VERSION}.slot${slot}`;
const LEADERBOARD_KEY = 'chucky.leaderboard.v1';
const NAME_KEY = 'chucky.playerName';

type Vec3 = [number, number, number];

export interface SaveData {
    version: number;
    savedAt: number;
    worldSeed: number;
    day: number;
    timeOfDay: number;
    woodCount: number;
    score: number;
    totalLogsCollected: number;
    health: number;
    maxHealth: number;
    berriesEaten: number;
    cameraMode: CameraMode;
    trees: [number, 0 | 1][];          // [health, isFelled] - index-aligned with the seeded world
    unlockedBlueprints: boolean[];      // index-aligned with the seeded blueprints
    placedStructures: PlacedStructure[];
    looseLogs: { position: Vec3; rotation: Vec3; age: number }[];
    food: { position: Vec3; type: 'apple' | 'berry' }[];
    player: { position: Vec3; facing: number };
    powerups: { treeMs: number; logMs: number; speedMs: number };
    seenPopups: { tree: boolean; log: boolean; speed: boolean };
}

export interface SaveSlotInfo {
    slot: number;
    savedAt: number;
    score: number;
    day: number;
    woodCount: number;
}

export interface LeaderboardEntry {
    name: string;
    score: number;
    logs: number;
    structures: number;
    day: number;
    date: number;
}

const getStorage = (): Storage | null => {
    try {
        const s = window.localStorage;
        const probe = '__chucky_probe__';
        s.setItem(probe, '1');
        s.removeItem(probe);
        return s;
    } catch {
        return null;
    }
};

const readJson = <T,>(key: string): T | null => {
    const s = getStorage();
    if (!s) return null;
    try {
        const raw = s.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch (e) {
        console.warn(`[Chucky] Could not read ${key}:`, e);
        return null;
    }
};

const writeJson = (key: string, value: unknown): boolean => {
    const s = getStorage();
    if (!s) return false;
    try {
        s.setItem(key, JSON.stringify(value));
        return true;
    } catch (e) {
        console.warn(`[Chucky] Could not write ${key}:`, e);
        return false;
    }
};

export const sanitizeName = (name: string) =>
    (name || '').replace(/[^\p{L}\p{N} _\-.!]/gu, '').trim().slice(0, MAX_NAME_LENGTH) || 'Chucky';

export const persistence = {
    isAvailable: (): boolean => getStorage() !== null,

    // --- Save slots (1-based) ---
    listSlots: (): (SaveSlotInfo | null)[] => {
        const result: (SaveSlotInfo | null)[] = [];
        for (let slot = 1; slot <= SAVE_SLOTS; slot++) {
            const data = readJson<SaveData>(slotKey(slot));
            result.push(data && data.version === SAVE_VERSION
                ? { slot, savedAt: data.savedAt, score: data.score, day: data.day, woodCount: data.woodCount }
                : null);
        }
        return result;
    },

    readSlot: (slot: number): SaveData | null => {
        const data = readJson<SaveData>(slotKey(slot));
        return data && data.version === SAVE_VERSION ? data : null;
    },

    writeSlot: (slot: number, data: SaveData): boolean => writeJson(slotKey(slot), data),

    deleteSlot: (slot: number) => {
        const s = getStorage();
        try { s?.removeItem(slotKey(slot)); } catch { /* ignore */ }
    },

    // --- Leaderboard ---
    getLeaderboard: (): LeaderboardEntry[] => {
        const list = readJson<LeaderboardEntry[]>(LEADERBOARD_KEY);
        return Array.isArray(list) ? list : [];
    },

    /** Adds an entry, keeps the top 10. Returns the 1-based rank, or -1 if it didn't make the board. */
    addLeaderboardEntry: (entry: LeaderboardEntry): number => {
        const clean: LeaderboardEntry = { ...entry, name: sanitizeName(entry.name) };
        const list = [...persistence.getLeaderboard(), clean]
            .sort((a, b) => b.score - a.score || a.date - b.date)
            .slice(0, LEADERBOARD_SIZE);
        writeJson(LEADERBOARD_KEY, list);
        const idx = list.indexOf(clean);
        return idx === -1 ? -1 : idx + 1;
    },

    clearLeaderboard: () => {
        const s = getStorage();
        try { s?.removeItem(LEADERBOARD_KEY); } catch { /* ignore */ }
    },

    // --- Player name ---
    getPlayerName: (): string => {
        const s = getStorage();
        try { return s?.getItem(NAME_KEY) || ''; } catch { return ''; }
    },

    setPlayerName: (name: string) => {
        const s = getStorage();
        try { s?.setItem(NAME_KEY, sanitizeName(name)); } catch { /* ignore */ }
    },
};
