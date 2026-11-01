// Chucky's fact nuggets: tips and beaver facts in a speech bubble (a solo game pauses
// while it's shown). The text lives in public/chucky-facts.json - edit it and reload the
// game, no rebuild needed. See the "_readme" in that file for the format.

import { useGameStore, isNightTime } from '../store';

export interface FactCondition {
    logs?: number;      // Logs collected
    trees?: number;     // Trees felled
    score?: number;
    day?: number;
    built?: number;     // Structures this player built
    throws?: number;    // Logs thrown
    chased?: number;    // Wolves/bears chased off
    swim?: number;      // Times you've gone into the water
    night?: number;     // Nights seen
    bitten?: number;    // Piranha bites
}

export interface Fact {
    id: string;
    text: string;
    when?: FactCondition;
}

const FACTS_URL = '/chucky-facts.json';
const SEEN_KEY = 'chucky.facts.seen';
const INTRO_KEY = 'chucky.facts.introDone';
const ENABLED_KEY = 'chucky.facts.enabled';
const MIN_GAP_MS = 40 * 1000;          // At least this long between two facts during play
const UNTIMED_EVERY_MS = 150 * 1000;   // Facts without "when" come up one by one this often
const START_DELAY_MS = 4000;           // Let a new game settle before the first bubble
const CONDITION_KEYS: (keyof FactCondition)[] = ['logs', 'trees', 'score', 'day', 'built', 'throws', 'chased', 'swim', 'night', 'bitten'];

// Used until the JSON has loaded (or if it can't be loaded)
const FALLBACK_INTRO: Fact[] = [
    { id: 'intro-beaver', text: 'By the way, I\'m a beaver! Woodchucks don\'t actually "chuck wood" LOL! My first fact nugget for you!' },
];

const read = (key: string) => {
    try { return window.localStorage.getItem(key); } catch { return null; }
};
const write = (key: string, value: string) => {
    try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
};

const cleanList = (raw: unknown, where: string): Fact[] => {
    if (!Array.isArray(raw)) return [];
    const out: Fact[] = [];
    const ids = new Set<string>();
    for (const item of raw) {
        if (!item || typeof item.id !== 'string' || typeof item.text !== 'string' || !item.text.trim()) {
            console.warn(`[Chucky facts] Skipped an entry in "${where}" without an id and text:`, item);
            continue;
        }
        if (ids.has(item.id)) {
            console.warn(`[Chucky facts] Duplicate id "${item.id}" in "${where}" - only the first is used.`);
            continue;
        }
        let when: FactCondition | undefined;
        if (item.when !== undefined) {
            if (!item.when || typeof item.when !== 'object') {
                console.warn(`[Chucky facts] "${item.id}": "when" must be an object like { "logs": 10 } - skipped.`);
                continue;
            }
            const unknown = Object.keys(item.when).filter(k => !(CONDITION_KEYS as string[]).includes(k));
            if (unknown.length) {
                console.warn(`[Chucky facts] "${item.id}": unknown "when" key(s) ${unknown.join(', ')} - skipped. Use: ${CONDITION_KEYS.join(', ')}.`);
                continue;
            }
            when = {};
            for (const k of CONDITION_KEYS) {
                if (item.when[k] !== undefined) when[k] = Number(item.when[k]) || 0;
            }
        }
        ids.add(item.id);
        out.push({ id: item.id, text: item.text.trim(), ...(when ? { when } : {}) });
    }
    return out;
};

class FactsService {
    intro: Fact[] = FALLBACK_INTRO;
    facts: Fact[] = [];
    private loading: Promise<void> | null = null;
    private seen = new Set<string>();
    private runId = -1;
    private runStart = 0;
    private lastShown = 0;
    private lastUntimed = 0;
    private swims = 0;        // Times Chucky went into the water this game
    private nights = 0;       // Nights seen this game
    private wasInWater = false;
    private wasNight = false;

    constructor() {
        try {
            const saved = JSON.parse(read(SEEN_KEY) || '[]');
            if (Array.isArray(saved)) this.seen = new Set(saved.filter(x => typeof x === 'string'));
        } catch { /* ignore */ }
    }

    /** Load public/chucky-facts.json (once; the game keeps the built-in intro if it fails) */
    load() {
        if (!this.loading) {
            this.loading = fetch(FACTS_URL, { cache: 'no-cache' })
                .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
                .then((data) => {
                    const intro = cleanList(data?.intro, 'intro');
                    if (intro.length) this.intro = intro;
                    this.facts = cleanList(data?.facts, 'facts');
                })
                .catch((e) => console.warn('[Chucky facts] Could not load', FACTS_URL, '- using the built-in intro only.', e));
        }
        return this.loading;
    }

    get enabled() {
        return read(ENABLED_KEY) !== '0';
    }

    setEnabled(on: boolean) {
        write(ENABLED_KEY, on ? '1' : '0');
        if (!on) useGameStore.getState().closeChucky();
    }

    markSeen(id: string) {
        if (this.seen.has(id)) return;
        this.seen.add(id);
        write(SEEN_KEY, JSON.stringify([...this.seen]));
    }

    finishIntro() {
        write(INTRO_KEY, '1');
    }

    /** Settings: "Hear all the facts again" (the intro too, next game) */
    resetSeen() {
        this.seen.clear();
        write(SEEN_KEY, '[]');
        write(INTRO_KEY, '');
    }

    /** Menu: "Chucky's tips" */
    replayIntro() {
        useGameStore.getState().showChucky(this.intro, 'intro');
    }

    /** Called about twice a second by the scene: shows the intro / the next fact when it's due */
    tick(now: number) {
        const s = useGameStore.getState();
        if (s.phase !== 'PLAYING') return;

        if (s.runId !== this.runId) {
            // New game (or a joined joint game)
            this.runId = s.runId;
            this.runStart = now;
            this.lastShown = now;
            this.lastUntimed = now;
            this.wasInWater = s.isInWater;
            this.wasNight = isNightTime(s.timeOfDay);
            this.swims = this.wasInWater ? 1 : 0;
            this.nights = this.wasNight ? 1 : 0;
        }
        // Count each time Chucky goes into the water, and each new night
        if (s.isInWater && !this.wasInWater) this.swims++;
        this.wasInWater = s.isInWater;
        const night = isNightTime(s.timeOfDay);
        if (night && !this.wasNight) this.nights++;
        this.wasNight = night;

        if (!this.enabled || now - this.runStart < START_DELAY_MS) return;
        // Wait for a quiet moment: no bubble, popup or menu showing, not knocked out
        if (s.chucky || s.notification || s.isGameMenuOpen || s.isBuildMenuOpen || s.koUntil > 0) return;

        if (read(INTRO_KEY) !== '1') {
            this.lastShown = now;
            s.showChucky(this.intro, 'intro');
            return;
        }
        if (now - this.lastShown < MIN_GAP_MS) return;

        const myId = s.mp.myId;
        const progress: Required<FactCondition> = {
            logs: s.totalLogsCollected,
            trees: s.treesFelled,
            score: s.score,
            day: s.day,
            built: s.placedStructures.filter(p => !p.ownerId || p.ownerId === myId).length,
            throws: s.throwsMade,
            chased: s.mobsChased,
            swim: this.swims,
            night: this.nights,
            bitten: s.piranhaBites,
        };

        let next = this.facts.find(f => f.when && !this.seen.has(f.id)
            && CONDITION_KEYS.every(k => f.when![k] === undefined || progress[k] >= (f.when![k] as number)));
        if (!next && now - this.lastUntimed >= UNTIMED_EVERY_MS) {
            next = this.facts.find(f => !f.when && !this.seen.has(f.id));
            if (next) this.lastUntimed = now;
        }
        if (next) {
            this.lastShown = now;
            s.showChucky([next], 'fact');
        }
    }
}

export const facts = new FactsService();
