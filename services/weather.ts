// Weather: clear skies, clouds, rain, thunderstorms and rainbows.
//
// Nothing here is random at run time: the weather is worked out from the world seed, the day
// and the time of day. Joint games already share all three, so every player gets the same rain,
// the same lightning strikes and the same rainbow with no extra network messages.
//
// A day is split into WEATHER_SLOTS stretches. Each stretch has one kind of weather; the
// amounts (rain, cloud cover) blend into the next stretch around the change-over.

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm';

export const WEATHER_SLOTS = 3;           // Weather stretches per day (100 s each in a 300 s day)
const BLEND = 0.15;                       // Fraction of a stretch spent blending at each end
const WEIGHTS: [WeatherKind, number][] = [['clear', 42], ['cloudy', 25], ['rain', 21], ['storm', 12]];
const RAIN: Record<WeatherKind, number> = { clear: 0, cloudy: 0, rain: 0.65, storm: 1 };
const CLOUD: Record<WeatherKind, number> = { clear: 0.1, cloudy: 0.6, rain: 0.85, storm: 1 };
const STORM: Record<WeatherKind, number> = { clear: 0, cloudy: 0, rain: 0, storm: 1 };

export const LIGHTNING_BUCKET_S = 3.5;    // At most one strike per bucket of game seconds ...
const LIGHTNING_CHANCE = 0.45;            // ... with this chance, during a storm
const MAP_HALF = 140;

export interface Weather {
    kind: WeatherKind;      // This stretch's weather
    rain: number;           // 0..1 how hard it rains
    cloud: number;          // 0..1 cloud cover (darker light, greyer sky)
    storm: number;          // 0..1 thunderstorm (lightning)
    rainbow: number;        // 0..1 a rainbow after the rain (day time only)
    slotKey: string;        // `${day}-${slot}`: identifies this stretch (the rainbow treasure)
}

// Small integer hash -> [0, 1)
export const hash01 = (...n: number[]) => {
    let h = 0x9e3779b9;
    for (const v of n) {
        h = Math.imul(h ^ (Math.floor(v) | 0), 0x85ebca6b);
        h ^= h >>> 13;
        h = Math.imul(h, 0xc2b2ae35);
        h ^= h >>> 16;
    }
    return (h >>> 0) / 4294967296;
};

export const weatherKind = (seed: number, day: number, slot: number): WeatherKind => {
    // Normalise (slot -1 = the last stretch of the day before, etc.)
    while (slot < 0) { slot += WEATHER_SLOTS; day -= 1; }
    while (slot >= WEATHER_SLOTS) { slot -= WEATHER_SLOTS; day += 1; }
    if (day < 1 || (day === 1 && slot === 0)) return 'clear'; // A sunny first morning to learn the ropes
    const r = hash01(seed, day, slot, 17) * 100;
    let acc = 0;
    for (const [kind, w] of WEIGHTS) {
        acc += w;
        if (r < acc) return kind;
    }
    return 'clear';
};

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
};

export const isDaytime = (timeOfDay: number) => timeOfDay > 0.02 && timeOfDay < 0.48;

export const getWeather = (seed: number, day: number, timeOfDay: number): Weather => {
    const pos = timeOfDay * WEATHER_SLOTS;
    const slot = Math.min(WEATHER_SLOTS - 1, Math.floor(pos));
    const f = pos - slot;
    const cur = weatherKind(seed, day, slot);
    const prev = weatherKind(seed, day, slot - 1);
    const next = weatherKind(seed, day, slot + 1);

    const blend = (table: Record<WeatherKind, number>) => {
        if (f < BLEND) return mix(table[prev], table[cur], 0.5 + 0.5 * smooth(0, BLEND, f));
        if (f > 1 - BLEND) return mix(table[cur], table[next], 0.5 * smooth(1 - BLEND, 1, f));
        return table[cur];
    };

    // A rainbow when the sun comes out after rain (fades in, then out again)
    let rainbow = 0;
    if ((cur === 'clear' || cur === 'cloudy') && (prev === 'rain' || prev === 'storm') && isDaytime(timeOfDay)) {
        rainbow = smooth(0.08, 0.22, f) * (1 - smooth(0.7, 0.9, f));
    }

    return {
        kind: cur,
        rain: blend(RAIN),
        cloud: blend(CLOUD),
        storm: blend(STORM),
        rainbow,
        slotKey: `${day}-${slot}`,
    };
};

// Where this stretch's rainbow ends: a seeded spot on the map. The caller moves it onto
// dry land (store.findDryLand), so the treasure is never in the river.
// `attempt` gives other spots to try (e.g. when one is in thick forest).
export const rainbowSpot = (seed: number, slotKey: string, attempt = 0): [number, number] => {
    const [d, s] = slotKey.split('-').map(Number);
    return [
        (hash01(seed, d, s, 101, attempt) * 2 - 1) * MAP_HALF * 0.8,
        (hash01(seed, d, s, 202, attempt) * 2 - 1) * MAP_HALF * 0.8,
    ];
};

// Lightning: the strike (if any) in the bucket that contains game-time `t` seconds.
// Same seed + same clock = the same strike, at the same spot, for every player.
export interface Strike { at: number; x: number; z: number; id: number }
export const lightningIn = (seed: number, bucket: number): Strike | null => {
    if (hash01(seed, bucket, 31) > LIGHTNING_CHANCE) return null;
    return {
        id: bucket,
        at: (bucket + hash01(seed, bucket, 37)) * LIGHTNING_BUCKET_S,
        x: (hash01(seed, bucket, 41) * 2 - 1) * MAP_HALF,
        z: (hash01(seed, bucket, 43) * 2 - 1) * MAP_HALF,
    };
};

export const WEATHER_INFO: Record<WeatherKind, { icon: string; label: string }> = {
    clear: { icon: '☀️', label: 'Clear' },
    cloudy: { icon: '⛅', label: 'Cloudy' },
    rain: { icon: '🌧️', label: 'Rain' },
    storm: { icon: '⛈️', label: 'Storm' },
};
