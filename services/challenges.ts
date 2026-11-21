// Chucky's Challenges: three small goals at a time ("Chomp down 5 trees", "Build in the river").
// Finishing one gives bonus points and a new challenge takes its place, a little harder each
// time. Every CHALLENGE_STREAK-th finished challenge also gives a random magic.
//
// A challenge counts one of the game's tallies (see ChallengeStat) from where it stood when
// the challenge was handed out (`base`), so earlier progress never counts.

export type ChallengeStat =
    | 'trees' | 'logs' | 'builds' | 'riverBuilds' | 'chased' | 'fruit'
    | 'throws' | 'combo4' | 'nights' | 'piranhas' | 'magic' | 'rainbows';

// Tallies kept only for challenges (the others already exist in the store)
export type ChallengeTallies = Record<'builds' | 'riverBuilds' | 'fruit' | 'combo4' | 'nights' | 'piranhas' | 'rainbows', number>;
export const NO_TALLIES: ChallengeTallies = { builds: 0, riverBuilds: 0, fruit: 0, combo4: 0, nights: 0, piranhas: 0, rainbows: 0 };

export interface Challenge {
    id: string;
    stat: ChallengeStat;
    target: number;
    base: number;     // The tally when the challenge was handed out
    reward: number;   // Points
}

export const CHALLENGE_SLOTS = 3;
export const CHALLENGE_STREAK = 3;  // Every 3rd finished challenge also gives a magic

export interface ChallengeContext {
    isNight: boolean;
    timeOfDay: number;
    canBuild: boolean;     // The first blueprint is unlocked
    hasPiranha: boolean;
}

interface Template {
    stat: ChallengeStat;
    icon: string;
    text: (n: number) => string;
    target: (tier: number) => number;
    weight: number;
    when?: (c: ChallengeContext) => boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const TEMPLATES: Template[] = [
    { stat: 'trees', icon: '🌲', weight: 10, text: n => `Chomp down ${plural(n, 'tree', 'trees')}`, target: t => Math.min(15, 3 + t * 2) },
    { stat: 'logs', icon: '🪵', weight: 10, text: n => `Collect ${n} logs`, target: t => Math.min(90, 12 + t * 8) },
    { stat: 'fruit', icon: '🍎', weight: 6, text: n => `Eat ${plural(n, 'apple or berry', 'apples or berries')}`, target: t => Math.min(6, 2 + Math.floor(t / 2)) },
    { stat: 'throws', icon: '🎯', weight: 5, text: n => `Throw ${n} logs`, target: t => Math.min(25, 5 + t * 3) },
    { stat: 'combo4', icon: '🔥', weight: 5, text: () => 'Reach a 4× combo', target: () => 1 },
    { stat: 'builds', icon: '🏗️', weight: 8, text: n => `Build ${plural(n, 'structure', 'structures')}`, target: t => 1 + Math.floor(t / 4), when: c => c.canBuild },
    { stat: 'riverBuilds', icon: '🌊', weight: 6, text: () => 'Build something in the river', target: () => 1, when: c => c.canBuild },
    { stat: 'chased', icon: '🐺', weight: 8, text: n => `Chase off ${plural(n, 'wolf or bear', 'wolves or bears')}`, target: t => 1 + Math.floor(t / 4), when: c => c.isNight || c.timeOfDay > 0.4 },
    { stat: 'nights', icon: '🌅', weight: 7, text: () => 'Make it through the night', target: () => 1, when: c => c.isNight },
    { stat: 'piranhas', icon: '🐟', weight: 4, text: () => 'Chase off the piranha', target: () => 1, when: c => c.hasPiranha },
    { stat: 'magic', icon: '✨', weight: 3, text: () => 'Find a magic item', target: () => 1, when: c => c.isNight },
];

const TEMPLATE_BY_STAT = Object.fromEntries(TEMPLATES.map(t => [t.stat, t])) as Record<ChallengeStat, Template>;

export const challengeText = (c: Challenge) => TEMPLATE_BY_STAT[c.stat]?.text(c.target) ?? c.stat;
export const challengeIcon = (c: Challenge) => TEMPLATE_BY_STAT[c.stat]?.icon ?? '🎯';

/** A new challenge, not one of the stats already in play. tier = challenges finished so far. */
export const pickChallenge = (
    tier: number,
    ctx: ChallengeContext,
    exclude: ChallengeStat[],
    statValue: (stat: ChallengeStat) => number,
): Challenge => {
    const options = TEMPLATES.filter(t => !exclude.includes(t.stat) && (!t.when || t.when(ctx)));
    const pool = options.length ? options : TEMPLATES.filter(t => !t.when);
    let r = Math.random() * pool.reduce((a, t) => a + t.weight, 0);
    let pick = pool[0];
    for (const t of pool) {
        r -= t.weight;
        if (r <= 0) { pick = t; break; }
    }
    return {
        id: `ch-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        stat: pick.stat,
        target: pick.target(tier),
        base: statValue(pick.stat),
        reward: Math.round((30 + tier * 12) / 5) * 5,
    };
};
