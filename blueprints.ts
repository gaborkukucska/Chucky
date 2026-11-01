// Blueprints: beaver-style structures built from logs (and mud, which is free).
//
// Every world makes the same 10 blueprints, with a little seeded wobble so no two worlds
// look exactly alike. A blueprint's cost is exactly its number of logs.
//
// Local frame of a structure: +Y up, y = 0 is the ground (or river bed) under its centre,
// -Z points back towards Chucky when it's placed and +Z away from him. Dams run along X
// (a wall in front of Chucky) and curve towards +Z, so face upstream to build one across
// the river. Lodges have their underwater entrance tunnels at the bottom: built on the
// river bed, the tunnels are under water and the dome rises out of it.
//
// A structure log is 3 m long and 0.8 m thick at scale 1; shorter "sticks" use a smaller
// scale (both length and thickness). Mud blobs are squashed spheres for looks only:
// collisions come from the logs.

import * as THREE from 'three';
import type { Blueprint, BlueprintLog, BlueprintMud } from './types';

// Score needed to unlock each blueprint (index 0 = unlocked by collecting 3 logs)
export const BLUEPRINT_THRESHOLDS = [0, 150, 300, 500, 750, 1050, 1400, 1800, 2250, 2750];

type V3 = [number, number, number];

const LOG_LENGTH = 3;   // At scale 1 (matches STRUCTURE_LOG_LENGTH in WorldObjects.tsx)
const LOG_THICK = 0.8;
const LAYER = 0.62;     // Height of one layer of logs (they settle into each other a bit)

const mulberry32 = (seed: number) => () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _d = new THREE.Vector3();

/** Collects logs and mud for one structure */
class Builder {
    logs: BlueprintLog[] = [];   // The structure itself
    extras: BlueprintLog[] = []; // Decoration (braces, poking sticks): the first to go when trimming
    mud: BlueprintMud[] = [];
    extra = false;               // While true, log() adds to extras
    private counted = 0;
    // dry = only count the logs (sizing a design); the random numbers used stay the same
    constructor(public rand: () => number, private dry = false) {}

    get count() {
        return this.dry ? this.counted : this.logs.length + this.extras.length;
    }

    /** Random number in [-a, a] */
    j(a: number) {
        return (this.rand() * 2 - 1) * a;
    }

    /** A log centred at p, lying along direction d, at scale s */
    log(p: V3, d: V3, s = 1) {
        if (this.dry) {
            this.counted++;
            return;
        }
        _d.set(d[0], d[1], d[2]).normalize();
        _q.setFromUnitVectors(UP, _d); // Logs are cylinders along their local Y
        _e.setFromQuaternion(_q);
        (this.extra ? this.extras : this.logs).push({
            position: [r3(p[0]), r3(p[1]), r3(p[2])],
            rotation: [r3(_e.x), r3(_e.y), r3(_e.z)],
            ...(Math.abs(s - 1) > 0.001 ? { scale: r3(s) } : {}),
        });
    }

    /** A horizontal-ish log at p along heading a (0 = +Z, PI/2 = +X), tilted by pitch */
    logAt(p: V3, a: number, pitch: number, s = 1) {
        this.log(p, [Math.sin(a) * Math.cos(pitch), Math.sin(pitch), Math.cos(a) * Math.cos(pitch)], s);
    }

    /** A mud blob at p: size (x, y, z) with its local Y along normal n */
    blob(p: V3, size: V3, n: V3 = [0, 1, 0], yaw = 0) {
        if (this.dry) return;
        _d.set(n[0], n[1], n[2]).normalize();
        _q.setFromUnitVectors(UP, _d);
        _q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
        _e.setFromQuaternion(_q);
        this.mud.push({
            position: [r3(p[0]), r3(p[1]), r3(p[2])],
            rotation: [r3(_e.x), r3(_e.y), r3(_e.z)],
            scale: [r3(size[0]), r3(size[1]), r3(size[2])],
        });
    }
}

// =====================================================================
// Parts
// =====================================================================

/** Winter food cache: a heap of branches */
const foodCache = (b: Builder, cx: number, cz: number, radius: number, count: number) => {
    for (let i = 0; i < count; i++) {
        const r = radius * Math.sqrt((i + 0.5) / count);
        const a = i * 2.39996 + b.j(0.3); // Golden angle: evenly spread
        const y = 0.25 + (radius - r) * 0.45 + b.j(0.1);
        b.logAt([cx + Math.sin(a) * r, y, cz + Math.cos(a) * r], b.j(Math.PI), b.j(0.45), 0.5 + b.rand() * 0.3);
    }
};

interface DamOptions {
    length: number;     // m along X
    height: number;     // m
    curve?: number;     // m the middle bulges towards +Z (upstream)
    spillway?: boolean; // A lower notch in the middle for the overflow
    z?: number;         // Shift along Z
    braces?: boolean;   // Sticks leaning on the downstream face
}

/** A beaver dam: logs laid along the dam, thicker at the bottom, mud on the upstream face */
const dam = (b: Builder, o: DamOptions) => {
    const { length: L, height: H, curve = 0, spillway = false, z: z0 = 0, braces = true } = o;
    const layers = Math.max(1, Math.round(H / LAYER));
    const baseThick = Math.max(1.6, H * 1.15);
    const topThick = Math.min(baseThick, 1.5);
    const centre = (u: number) => z0 + curve * (1 - (2 * u / L) ** 2);
    const tangent = (u: number) => Math.atan2(1, -curve * 8 * u / (L * L)); // Heading along the dam
    const notch = spillway ? Math.min(3, L * 0.12) : 0;

    // Body: layer by layer from the bottom (trimming the count takes logs off the top)
    for (let i = 0; i < layers; i++) {
        const y = 0.35 + i * LAYER;
        const f = layers > 1 ? i / (layers - 1) : 0;
        const thick = baseThick + (topThick - baseThick) * f;
        const rows = Math.max(1, Math.round(thick / 0.78));
        const lowered = spillway && i >= layers - 2; // The spillway notch is 2 layers deep
        for (let r = 0; r < rows; r++) {
            const v = (r - (rows - 1) / 2) * (thick / rows) + b.j(0.12);
            let u = -L / 2 + ((i + r) % 2) * 0.9 + b.j(0.3);
            while (u < L / 2) {
                const s = 0.7 + b.rand() * 0.3;
                const step = LOG_LENGTH * s * 0.82;
                const mid = Math.min(L / 2, u + step / 2);
                if (!(lowered && Math.abs(mid) < notch)) {
                    const a = tangent(mid);
                    // Normal (towards +Z / upstream) at this point
                    const nx = -Math.cos(a), nz = Math.sin(a);
                    b.logAt([mid + nx * v, y + b.j(0.08), centre(mid) + nz * v], a + b.j(0.3), b.j(0.12), s);
                }
                u += step;
            }
        }
    }
    // Braces: sticks leaning against the downstream face (-Z side)
    if (braces) {
        b.extra = true;
        for (let u = -L / 2 + 1; u < L / 2 - 0.5; u += 2.8) {
            const a = tangent(u);
            const nx = -Math.cos(a), nz = Math.sin(a);
            const off = baseThick / 2 + 0.4;
            const lean = 0.75 + b.j(0.15); // ~43 degrees
            const yb = Math.min(H * 0.4, 1.3);
            b.log([u - nx * off, yb, centre(u) - nz * off], [nx * Math.cos(lean), Math.sin(lean), nz * Math.cos(lean)], 0.65 + b.rand() * 0.25);
        }
        b.extra = false;
    }
    // Mud: plastered over the upstream face and along the top
    for (let u = -L / 2 + 0.6; u < L / 2; u += 1.5) {
        const a = tangent(u);
        const nx = -Math.cos(a), nz = Math.sin(a);
        for (let k = 0; k < Math.max(1, layers - 1); k += 2) {
            const y = 0.4 + k * LAYER;
            const f = layers > 1 ? k / (layers - 1) : 0;
            const off = (baseThick + (topThick - baseThick) * f) / 2 + 0.05;
            b.blob([u + nx * off, y, centre(u) + nz * off], [1.0 + b.rand() * 0.4, 0.45, 0.9 + b.rand() * 0.3], [nx, 0.5, nz], b.j(0.5));
        }
        const lowered = spillway && Math.abs(u) < notch;
        const topY = 0.35 + (layers - (lowered ? 3 : 1)) * LAYER + 0.3;
        if (topY > 0.3) b.blob([u, topY, centre(u)], [0.9, 0.3, topThick * 0.5], [0, 1, 0], Math.PI / 2 - a);
    }
};

interface LodgeOptions {
    radius: number;      // m
    height: number;      // m
    shells: number;      // Wall thickness in rings of logs
    entrances: number[]; // Headings of the underwater entrance tunnels (0 = +Z)
    vent?: boolean;      // Air hole at the top
    cx?: number;
    cz?: number;
}

/** A beaver lodge: a domed heap of sticks and mud with a hollow chamber, an air vent on top
 *  and tunnels at the bottom (under water when it's built in the river) */
const lodge = (b: Builder, o: LodgeOptions) => {
    const { radius: R, height: H, shells, entrances, vent = true, cx = 0, cz = 0 } = o;
    const tr = Math.min(0.95, H * 0.25);        // Tunnel radius
    const m = Math.min(1, Math.max(0.45, R / 5)); // Mud blob size: smaller on small lodges
    const hc = tr + 0.05;                       // Height of the tunnel's middle where it leaves the dome
    const tunnelH = hc + tr * 0.9;              // The dome wall is open below this...
    const tunnelHalfW = tr;                     // ...this wide either side of the tunnel
    const top = vent ? H - 0.55 : H - 0.15;
    const angDist = (a: number, c: number) => Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c)));
    const inEntrance = (a: number, r: number, y: number) =>
        y < tunnelH && entrances.some(e => angDist(a, e) * r < tunnelHalfW + 0.3);

    // Walls: rings of sticks following the dome, outer shell first
    for (let sh = 0; sh < shells; sh++) {
        const Rs = R - sh * 0.75;
        const Hs = H - sh * 0.6;
        if (Rs < 1.2 || Hs < 1) break;
        let ring = 0;
        for (let y = 0.35; y < Math.min(top, Hs - 0.2); y += 0.55, ring++) {
            const r = Rs * Math.sqrt(Math.max(0, 1 - (y / Hs) ** 2));
            if (r < 0.7) break;
            // Slope of the dome here: sticks lean with it
            const slope = Math.atan2(Hs * Hs * r, Rs * Rs * Math.max(0.05, y)) - Math.PI / 2;
            const s = Math.min(1, Math.max(0.45, r * 0.32)) * (0.85 + b.rand() * 0.15);
            const n = Math.max(3, Math.round((2 * Math.PI * r) / (LOG_LENGTH * s * 0.78)));
            const off = (ring % 2) * Math.PI / n + b.j(0.2);
            for (let k = 0; k < n; k++) {
                const a = off + (k / n) * Math.PI * 2;
                if (inEntrance(a, r, y)) continue;
                const pos: V3 = [cx + Math.sin(a) * r, y + b.j(0.06), cz + Math.cos(a) * r];
                // Along the ring (heading a + 90 deg), tilted a little up or down and with the slope
                b.logAt(pos, a + Math.PI / 2 + b.j(0.35), b.j(0.25) + slope * 0.3 * Math.sign(b.j(1)), s);
            }
        }
    }

    // Entrance tunnels: an arch of sticks laid along the tunnel, sloping down away from the
    // dome (into the water), with mud on top. Seen from outside: a round, dark opening.
    for (const e of entrances) {
        const ex = Math.sin(e), ez = Math.cos(e);   // Outwards
        const px = Math.cos(e), pz = -Math.sin(e);  // Sideways
        const len = Math.min(3.2, R * 0.75);
        const drop = 0.12;                          // Slope down, outwards
        const dir: V3 = [ex, -drop, ez];
        // Inner arch (5 sticks around the top half), then an outer layer nearer the dome
        // Sticks laid end to end along the tunnel, thinner on small lodges
        const stick = Math.min(1, Math.max(0.4, tr * 0.75));
        const arch = (radius: number, angles: number[], length: number, start: number) => {
            const pieces = Math.max(1, Math.round(length / (LOG_LENGTH * stick * 0.9)));
            const piece = length / pieces;
            for (const th of angles) {
                for (let k = 0; k < pieces; k++) {
                    const d = start + piece * (k + 0.5);
                    const side = Math.sin(th) * radius, up = Math.cos(th) * radius;
                    const y = Math.max(0.2, hc + up - drop * (d - R));
                    b.log([cx + ex * d + px * side, y + b.j(0.05), cz + ez * d + pz * side], [dir[0] + b.j(0.06), dir[1], dir[2] + b.j(0.06)], Math.min(stick, piece / LOG_LENGTH + 0.05));
                }
            }
        };
        arch(tr + 0.4 * stick, [-1.45, -0.75, 0, 0.75, 1.45], len, R - 0.5);
        arch(tr + 1.1 * stick, [-1.1, -0.4, 0.4, 1.1], len * 0.6, R - 0.6);
        // Mud along the top of the tunnel
        for (let d = R; d < R + len; d += 1.1 * m) {
            b.blob([cx + ex * d, hc + tr + 0.8 * stick - drop * (d - R), cz + ez * d], [1.1 * m, 0.4 * m, 0.9 * m], [0, 1, 0], e);
        }
    }

    // Vent: a few loose sticks across the hole at the top
    b.extra = true;
    if (vent) {
        for (let k = 0; k < 3; k++) {
            b.logAt([cx + b.j(0.3), H - 0.3, cz + b.j(0.3)], (k / 3) * Math.PI + b.j(0.3), b.j(0.15), 0.45);
        }
    }

    // Extra sticks poking out of the outside, along the slope (that classic messy look)
    const pokers = Math.round(R * R * 0.9);
    for (let i = 0; i < pokers; i++) {
        const a = i * 2.39996 + b.j(0.2);
        const y = 0.5 + ((i * 0.618034) % 1) * (H - 1.4);
        const r = R * Math.sqrt(Math.max(0, 1 - (y / H) ** 2)) + 0.1;
        if (inEntrance(a, r, y + 0.4)) continue;
        const climb = 0.5 + b.j(0.3);
        b.log([cx + Math.sin(a) * r, y + 0.2, cz + Math.cos(a) * r], [-Math.sin(a) * Math.cos(climb), Math.sin(climb), -Math.cos(a) * Math.cos(climb)], 0.5 + b.rand() * 0.25);
    }
    b.extra = false;

    // Mud: plastered over the dome, leaving the vent and the entrances open
    const area = 2 * Math.PI * R * H;
    const blobs = Math.round(area / (2.4 * m * m));
    for (let i = 0; i < blobs; i++) {
        const a = i * 2.39996;
        const y = 0.4 + ((i * 0.618034 + 0.31) % 1) * (H - 0.9);
        const r = R * Math.sqrt(Math.max(0, 1 - (y / H) ** 2));
        if (inEntrance(a, r, y) || r < 0.9) continue;
        const nx = Math.sin(a) * (y < H ? r / R : 0), ny = y / H, nz = Math.cos(a) * (r / R);
        b.blob([cx + Math.sin(a) * (r + 0.3), y, cz + Math.cos(a) * (r + 0.3)], [(1.1 + b.rand() * 0.4) * m, 0.4 * m, (1.0 + b.rand() * 0.4) * m], [nx, ny + 0.2, nz], b.j(Math.PI));
    }
};

// =====================================================================
// The 10 blueprints
// =====================================================================
interface Design {
    name: string;
    icon: string;
    description: string;
    cost: number;
    /** Builds the structure at size k (bigger k = more logs) */
    build: (b: Builder, k: number) => void;
}

const DESIGNS: Design[] = [
    {
        name: 'Food Cache', icon: '🌿', cost: 7,
        description: 'A heap of branches to munch through the winter.',
        build: (b, k) => foodCache(b, 0, 0, 1 + k, Math.round(4 + k * 4)),
    },
    {
        name: 'Starter Dam', icon: '🌊', cost: 15,
        description: 'A low line of logs and mud. Every great dam starts like this.',
        build: (b, k) => dam(b, { length: 4 + k * 4, height: 1.2, braces: false }),
    },
    {
        name: 'Bank Den', icon: '🕳️', cost: 30,
        description: 'A mud-covered den with an underwater entrance tunnel.',
        build: (b, k) => lodge(b, { radius: 1.8 + k, height: 1.4 + k * 0.5, shells: 1, entrances: [Math.PI], vent: false }),
    },
    {
        name: 'Dam Wall', icon: '🧱', cost: 60,
        description: 'A straight dam, thick at the bottom and braced behind.',
        build: (b, k) => dam(b, { length: 6 + k * 5, height: 2.4 }),
    },
    {
        name: 'Little Lodge', icon: '🛖', cost: 120,
        description: 'A domed lodge with a hollow room inside, an air vent and an underwater door.',
        build: (b, k) => lodge(b, { radius: 2.6 + k, height: 2.4 + k * 0.85, shells: 2, entrances: [Math.PI] }),
    },
    {
        name: 'Curved Dam', icon: '🌙', cost: 240,
        description: 'Curved upstream like real beaver dams, so it holds back more water.',
        build: (b, k) => dam(b, { length: 10 + k * 6, height: 4.2, curve: 2 }),
    },
    {
        name: 'Beaver Lodge', icon: '🏠', cost: 480,
        description: 'A big lodge with two underwater entrances and its winter food cache.',
        build: (b, k) => {
            const R = 4 + k;
            lodge(b, { radius: R, height: R * 0.95, shells: 2, entrances: [Math.PI * 0.75, Math.PI * 1.25] });
            foodCache(b, R + 2.2, R * 0.4, 1.8, 14);
        },
    },
    {
        name: 'Spillway Dam', icon: '💧', cost: 960,
        description: 'A tall curved dam with a spillway notch so floods pour over the top, not through it.',
        build: (b, k) => dam(b, { length: 14 + k * 8, height: 6.2, curve: 3.5, spillway: true }),
    },
    {
        name: 'Family Lodge', icon: '🏡', cost: 1920,
        description: 'A huge lodge for the whole colony: thick walls, three underwater entrances, two food caches.',
        build: (b, k) => {
            const R = 6 + k;
            lodge(b, { radius: R, height: R * 0.85, shells: 7, entrances: [Math.PI, Math.PI * 0.4, Math.PI * 1.6] });
            foodCache(b, R + 2.6, R * 0.3, 2.2, 22);
            foodCache(b, -R - 2.4, R * 0.5, 2, 18);
        },
    },
    {
        name: 'Beaver Kingdom', icon: '👑', cost: 3840,
        description: 'A mighty curved dam and a lower dam below it, with a lodge and food caches in the pond.',
        build: (b, k) => {
            // Main dam, a lodge in the pond behind it (+Z), and a lower dam downstream (-Z)
            const L = 30 + k * 4;
            const H = 7.6 + k * 0.3;
            dam(b, { length: L, height: H, curve: L * 0.12, spillway: true });
            const R = 5.5 + k * 0.5;
            const lz = L * 0.12 + H * 0.6 + R + 3;
            lodge(b, { radius: R, height: R * 0.95, shells: 3, entrances: [Math.PI * 0.8, Math.PI * 1.2], cz: lz });
            foodCache(b, R + 2.8, lz, 2.2, 18);
            foodCache(b, -R - 2.6, lz + 1, 2, 14);
            dam(b, { length: L * 0.6, height: 3.2, curve: L * 0.06, z: -H * 0.6 - 9 });
        },
    },
];

/** Smallest size k whose design has at least `cost` logs; then trim to exactly `cost` */
const fit = (design: Design, seed: number) => {
    const make = (k: number, dry: boolean) => {
        const b = new Builder(mulberry32(seed), dry);
        design.build(b, k);
        return b;
    };
    let lo = 0;
    let hi = 1;
    while (make(hi, true).count < design.cost && hi < 64) hi *= 2;
    for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        if (make(mid, true).count >= design.cost) hi = mid;
        else lo = mid;
    }
    const b = make(hi, false);
    // Exactly `cost` logs: decoration goes first, then logs off the end (the top layer)
    const logs = b.logs.length >= design.cost
        ? b.logs.slice(0, design.cost)
        : [...b.logs, ...b.extras.slice(0, design.cost - b.logs.length)];
    return { logs, mud: b.mud };
};

export const generateBlueprints = (rand: () => number): Blueprint[] =>
    DESIGNS.map((design, i) => {
        const built = fit(design, Math.floor(rand() * 2147483647));
        return {
            id: `bp-${i}`,
            name: design.name,
            icon: design.icon,
            description: design.description,
            cost: design.cost,
            logs: built.logs,
            mud: built.mud,
            unlocked: false, // All locked initially
            unlockScore: i === 0 ? 0 : BLUEPRINT_THRESHOLDS[i], // 0 is special: 3 logs collected
        };
    });
