// The living river: structures built across the river hold the water back.
//
// The river flows south (towards +z). A structure (or a row of them) that blocks enough of the
// river's width raises the water behind it, on its upstream (north) side, into a pond, and the
// river below it runs lower for a while. When a pond rises above the banks, it spills over the
// low ground beside the river: those flooded meadows are WETLANDS, where magpies come to nest
// (components/Magpies.tsx).
//
// The water's height only depends on how far along the river you are (the pond is flat), plus a
// limit on how far it can spread sideways from the river. So it's kept as one height per metre
// of river (`shown`), which eases towards the height the dams ask for (`target`): a new dam
// fills its pond over a few seconds, and a broken one drains.
//
// Everything comes from the placed structures, which joint games already share, so every player
// sees the same river.

import * as THREE from 'three';
import type { Blueprint, PlacedStructure } from '../types';
// Only functions from the store: it imports this file too, so its constants aren't ready yet
// when this one loads
import { calculateTerrainHeight, getRiverX, getRiverWidth } from '../store';

export const BASE_WATER = -1.5;           // The river's normal water level
const MAP_SIZE = 300;                     // Must match MAP_SIZE in store.ts

// --- Tuning ---
const MAX_RISE = 2.8;                     // m - the most a dam can raise the water (one that fills the river's depth)
const POND_LENGTH = { base: 26, perMetre: 16 }; // m upstream: 26 m + 16 m per metre of rise
const MAX_DROP = 1.5;                     // m - how much lower the river runs below a full dam
const DROP_LENGTH = 50;                   // m downstream before the river is back to normal
const FLOOD_REACH = 45;                   // m beside the river the water can spread
const GROUP_GAP = 5;                      // m - structures closer than this (along the river) act as one dam
const FULL_BLOCK = 0.95;                  // Share of the river's width that counts as fully blocked
const MIN_BLOCK = 0.3;                    // Less than this and the water just flows round
const RISE_SPEED = 0.45;                  // m/s - how fast a pond fills
const FALL_SPEED = 0.7;                   // m/s - how fast it drains
const WETLAND_MIN_DEPTH = 0.08;           // m of water over land that was dry, for it to count
const WETLAND_CELL = 2;                   // m - wetland sampling grid
const STRUCTURE_LOG_RADIUS = 0.4;
const STRUCTURE_LOG_HALF_LENGTH = 1.5;

const HALF = MAP_SIZE / 2;
const N = MAP_SIZE + 1;                   // One height per metre of z, from -HALF to +HALF

export interface Dam {
    z0: number;          // North (upstream) edge
    z1: number;          // South (downstream) edge
    x: number;           // Middle, across the river
    block: number;       // 0..1 share of the river's width blocked
    rise: number;        // m the pond rises (when full)
    drop: number;        // m the river drops below it
}

export interface Wetland {
    x: number;
    z: number;
    area: number;        // m²
}

export const hydrology = {
    target: new Float32Array(N),   // m above/below BASE_WATER the dams ask for
    shown: new Float32Array(N),    // ... and what the water is at right now (eases to target)
    active: false,                 // Any water away from the normal level (fast path when not)
    settled: true,                 // shown == target
    version: 0,                    // Bumps when the water moves (water mesh, minimap)
    dams: [] as Dam[],
    wetlands: [] as Wetland[],     // Flooded meadows, biggest first
    wetlandArea: 0,                // m², all together
    wetlandVersion: 0,
};

let lastStructures: PlacedStructure[] | null = null;
let lastWorld = '';
let lastBlueprints: Blueprint[] | null = null;

const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
};

// --- Which structures block the river, and how much ---
const _q = new THREE.Quaternion();
const _lq = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Vector3();
const _a = new THREE.Vector3();

interface RiverLog { z: number; nMin: number; nMax: number; top: number; zMin: number; zMax: number }

// Every log of every structure that stands in the river, as an interval across the river
// (n = x minus the river's middle at that z) and its top height
const riverLogs = (structures: PlacedStructure[], blueprints: Blueprint[]): RiverLog[] => {
    const out: RiverLog[] = [];
    const byId = new Map(blueprints.map(b => [b.id, b]));
    for (const s of structures) {
        const bp = byId.get(s.blueprintId);
        if (!bp) continue;
        _q.setFromEuler(_e.set(s.rotation[0], s.rotation[1], s.rotation[2]));
        for (const log of bp.logs) {
            _c.set(log.position[0], log.position[1], log.position[2]).applyQuaternion(_q);
            const cx = s.position[0] + _c.x, cz = s.position[2] + _c.z;
            if (calculateTerrainHeight(cx, cz) > BASE_WATER - 0.3) continue; // Not in the river
            const sc = log.scale ?? 1;
            const rad = STRUCTURE_LOG_RADIUS * sc;
            _lq.setFromEuler(_e.set(log.rotation[0], log.rotation[1], log.rotation[2]));
            _a.set(0, STRUCTURE_LOG_HALF_LENGTH * sc, 0).applyQuaternion(_lq).applyQuaternion(_q);
            const x1 = cx - _a.x, z1 = cz - _a.z, x2 = cx + _a.x, z2 = cz + _a.z;
            const n1 = x1 - getRiverX(z1), n2 = x2 - getRiverX(z2), nc = cx - getRiverX(cz);
            out.push({
                z: cz,
                nMin: Math.min(n1, n2, nc) - rad,
                nMax: Math.max(n1, n2, nc) + rad,
                top: s.position[1] + _c.y + Math.abs(_a.y) + rad,
                zMin: Math.min(z1, z2) - rad,
                zMax: Math.max(z1, z2) + rad,
            });
        }
    }
    return out.sort((a, b) => a.z - b.z);
};

// Logs close together along the river make one dam; how much of the width it blocks is the
// union of their intervals
const findDams = (logs: RiverLog[]): Dam[] => {
    const dams: Dam[] = [];
    let i = 0;
    while (i < logs.length) {
        const group = [logs[i]];
        let j = i + 1;
        while (j < logs.length && logs[j].z - group[group.length - 1].z < GROUP_GAP) group.push(logs[j++]);
        i = j;

        const zMid = group.reduce((a, l) => a + l.z, 0) / group.length;
        const w = getRiverWidth(zMid);
        const spans = group.map(l => [Math.max(-w, l.nMin), Math.min(w, l.nMax)] as [number, number])
            .filter(([a, b]) => b > a)
            .sort((a, b) => a[0] - b[0]);
        let covered = 0, end = -Infinity;
        for (const [a, b] of spans) {
            if (b <= end) continue;
            covered += b - Math.max(a, end);
            end = b;
        }
        const block = Math.min(1, covered / (2 * w * FULL_BLOCK));
        // How much of the river's depth it fills: even a dam under water holds some back, one
        // that reaches the surface holds back the most
        const top = Math.max(...group.map(l => l.top));
        const bed = calculateTerrainHeight(getRiverX(zMid), zMid);
        const fill = (top - bed) / Math.max(1, BASE_WATER - bed);
        const strength = smooth(MIN_BLOCK, 1, block);
        const rise = MAX_RISE * strength * smooth(0.15, 1.05, fill);
        if (rise < 0.05) continue;
        dams.push({
            z0: Math.min(...group.map(l => l.zMin)),
            z1: Math.max(...group.map(l => l.zMax)),
            x: getRiverX(zMid),
            block,
            rise,
            drop: MAX_DROP * strength * Math.sqrt(rise / MAX_RISE),
        });
    }
    return dams;
};

const index = (z: number) => Math.max(0, Math.min(N - 1, Math.round(z + HALF)));

const buildTarget = (dams: Dam[]) => {
    const t = hydrology.target;
    const rise = new Float32Array(N);
    const drop = new Float32Array(N);
    for (const d of dams) {
        // Pond: upstream (north, -z) of the dam, tapering out where the river bed would rise
        const len = POND_LENGTH.base + POND_LENGTH.perMetre * d.rise;
        for (let k = index(d.z0 - len); k <= index(d.z1); k++) {
            const z = k - HALF;
            const r = z >= d.z0 ? d.rise : d.rise * smooth(d.z0 - len, d.z0 - len * 0.45, z);
            rise[k] = Math.max(rise[k], r);
        }
        // Below the dam the river runs low, then recovers
        for (let k = index(d.z1); k <= index(d.z1 + DROP_LENGTH); k++) {
            const z = k - HALF;
            const dr = d.drop * (1 - smooth(d.z1 + DROP_LENGTH * 0.35, d.z1 + DROP_LENGTH, z));
            drop[k] = Math.max(drop[k], dr);
        }
    }
    // A pond wins over a lowered stretch (a dam just below another one's pond)
    for (let k = 0; k < N; k++) t[k] = rise[k] > 0.01 ? rise[k] : -drop[k];
};

/**
 * Call every frame (components/Water.tsx). Works out the dams again when the structures change,
 * and eases the water towards where they want it. `world` names the map: when it changes, the
 * water jumps straight to its level instead of filling.
 */
export const updateHydrology = (structures: PlacedStructure[], blueprints: Blueprint[], delta: number, world = '') => {
    // Another map (new game, loaded save, joined room): the river is as its dams make it, at once
    const instant = world !== lastWorld;
    lastWorld = world;
    if (instant || structures !== lastStructures || blueprints !== lastBlueprints) {
        // A whole new list (new game, loaded save, joined a room) appears at once; a single new
        // structure fills up
        let replaced = !lastStructures;
        if (lastStructures) {
            const before = new Set(lastStructures.map(st => st.id));
            const added = structures.filter(st => !before.has(st.id)).length;
            const removed = lastStructures.length - (structures.length - added);
            replaced = added + removed > 2;
        }
        lastStructures = structures;
        lastBlueprints = blueprints;
        hydrology.dams = findDams(riverLogs(structures, blueprints));
        buildTarget(hydrology.dams);
        hydrology.settled = false;
        if (replaced || instant) {
            hydrology.shown.set(hydrology.target);
        }
    }
    if (hydrology.settled) return;

    const { target, shown } = hydrology;
    let moving = false, any = false;
    const up = RISE_SPEED * delta, down = FALL_SPEED * delta;
    for (let k = 0; k < N; k++) {
        const d = target[k] - shown[k];
        if (d !== 0) {
            shown[k] = d > 0 ? Math.min(target[k], shown[k] + up) : Math.max(target[k], shown[k] - down);
            moving = true;
        }
        if (shown[k] !== 0) any = true;
    }
    hydrology.active = any;
    hydrology.version++;
    if (!moving) {
        hydrology.settled = true;
        findWetlands();
    }
};

// How far beside the river (beyond its edge) the raised water reaches, 0..1
const reach = (x: number, z: number) => {
    const out = Math.abs(x - getRiverX(z)) - getRiverWidth(z);
    return out <= 0 ? 1 : 1 - smooth(FLOOD_REACH * 0.7, FLOOD_REACH, out);
};

/** The water's surface height at (x, z). Use this rather than a fixed water level. */
export const getWaterLevel = (x: number, z: number): number => {
    if (!hydrology.active) return BASE_WATER;
    const fz = Math.max(0, Math.min(N - 1.001, z + HALF));
    const k = Math.floor(fz), f = fz - k;
    const off = hydrology.shown[k] * (1 - f) + hydrology.shown[k + 1] * f;
    if (off === 0) return BASE_WATER;
    // Raised water only spreads so far from the river; a lowered river is lower everywhere in it
    return BASE_WATER + (off > 0 ? off * reach(x, z) : off);
};

/** Is (x, z) under water? (ground below the water's surface) */
export const isUnderWater = (x: number, z: number, margin = 0) =>
    calculateTerrainHeight(x, z) < getWaterLevel(x, z) - margin;

/** How fast the river flows here, 0..1 of normal: ponds are almost still, flooded land is */
export const getFlowFactor = (x: number, z: number): number => {
    if (!hydrology.active) return 1;
    const off = getWaterLevel(x, z) - BASE_WATER;
    if (off <= 0) return 1;
    const inChannel = Math.abs(x - getRiverX(z)) < getRiverWidth(z);
    return inChannel ? Math.max(0.1, 1 - off / 1.2) : 0;
};

// --- Wetlands: land that was dry and is now under water ---
const findWetlands = () => {
    const cells: [number, number][] = [];
    if (hydrology.active) {
        for (let k = 0; k < N; k += WETLAND_CELL) {
            if (hydrology.shown[k] <= WETLAND_MIN_DEPTH) continue;
            const z = k - HALF;
            const rx = getRiverX(z), w = getRiverWidth(z);
            for (let x = rx - w - FLOOD_REACH; x <= rx + w + FLOOD_REACH; x += WETLAND_CELL) {
                if (Math.abs(x) > HALF - 2) continue;
                const h = calculateTerrainHeight(x, z);
                if (h >= BASE_WATER + 0.05 && h < getWaterLevel(x, z) - WETLAND_MIN_DEPTH) cells.push([x, z]);
            }
        }
    }
    // Group neighbouring cells into wetlands (flood fill on the grid)
    const key = (x: number, z: number) => `${Math.round(x / WETLAND_CELL)},${Math.round(z / WETLAND_CELL)}`;
    const cellSet = new Map(cells.map(c => [key(c[0], c[1]), c]));
    const seen = new Set<string>();
    const wetlands: Wetland[] = [];
    for (const [k0, c0] of cellSet) {
        if (seen.has(k0)) continue;
        const stack = [c0];
        seen.add(k0);
        let sx = 0, sz = 0, n = 0;
        while (stack.length) {
            const [x, z] = stack.pop()!;
            sx += x; sz += z; n++;
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nk = key(x + dx * WETLAND_CELL, z + dz * WETLAND_CELL);
                const nc = cellSet.get(nk);
                if (nc && !seen.has(nk)) { seen.add(nk); stack.push(nc); }
            }
        }
        const area = n * WETLAND_CELL * WETLAND_CELL;
        if (area >= 40) wetlands.push({ x: sx / n, z: sz / n, area });
    }
    wetlands.sort((a, b) => b.area - a.area);
    hydrology.wetlands = wetlands;
    hydrology.wetlandArea = wetlands.reduce((a, w) => a + w.area, 0);
    hydrology.wetlandVersion++;
};

/** Start again with a calm river (new game) */
export const resetHydrology = () => {
    lastStructures = null;
    lastBlueprints = null;
    hydrology.target.fill(0);
    hydrology.shown.fill(0);
    hydrology.active = false;
    hydrology.settled = true;
    hydrology.dams = [];
    hydrology.wetlands = [];
    hydrology.wetlandArea = 0;
    hydrology.version++;
    hydrology.wetlandVersion++;
};

// Dev servers only: the river from the browser console (and play-tests)
// (wrapped: the store's functions aren't ready while this file loads)
if (import.meta.env.DEV) (window as any).__chuckyRiver = {
    magpieCount: () => magpieCount(),
    hydrology, getWaterLevel,
    getRiverX: (z: number) => getRiverX(z),
    getRiverWidth: (z: number) => getRiverWidth(z),
    calculateTerrainHeight: (x: number, z: number) => calculateTerrainHeight(x, z),
};

// --- Magpies: they nest by wetlands (components/Magpies.tsx) ---
const MAGPIES_MIN_AREA = 40;      // m² of wetland before the first magpies come
const MAGPIES_PER_AREA = 140;     // m² more per extra magpie
const MAGPIES_MAX = 8;
/** How many magpies live at the wetlands (0 = none yet) */
export const magpieCount = () =>
    hydrology.wetlandArea < MAGPIES_MIN_AREA ? 0 : Math.min(MAGPIES_MAX, 2 + Math.floor((hydrology.wetlandArea - MAGPIES_MIN_AREA) / MAGPIES_PER_AREA));
