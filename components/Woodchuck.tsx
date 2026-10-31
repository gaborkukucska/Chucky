import React, { useEffect, useRef, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useSphere } from '@react-three/cannon';
import { Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore, getRiverX, getRiverWidth, calculateTerrainHeight, isNightTime } from '../store';
import { currentWoodchuckPos, playerState } from '../globals';
import { audioService } from '../services/audio';
import { PreviewStructureOverlay } from './WorldObjects';
import { TreeData, PlacedStructure, Blueprint } from '../types';

// =====================================================================
// Tuning - everything that affects how Chucky feels lives here
// =====================================================================
const WATER_LEVEL = -1.5;
const PLAYER_RADIUS = 0.6;

// Movement (units per second). Joystick is analog: half a push = half speed.
const WALK_SPEED = 10;
const SWIM_SPEED = 7;
const SPEED_POWERUP_MULTIPLIER = 1.6; // Zoomies (eat 3 berries)
const ACCELERATION = 8;      // 1/s - how quickly Chucky reaches the target speed
const DECELERATION = 12;     // 1/s - how quickly Chucky stops when input is released
const RIVER_DRIFT = 0.35;    // Fraction of the river flow applied while swimming
const TURN_RATE = 10;        // 1/s - how quickly the model turns to face the movement direction
const VERTICAL_SMOOTHING = 15; // 1/s - terrain following / bobbing smoothing
const MAP_LIMIT = 145;
const MAX_FRAME_DELTA = 0.1;   // Clamp long frames (tab switch, GC hitch) to avoid teleporting

// Diving (hold the dive button / Space while in the river)
const SURFACE_Y = WATER_LEVEL + 0.2;  // Where Chucky floats
const DIVE_SPEED = 4;                 // Units per second down
const SURFACE_SPEED = 5;              // Units per second back up
const BREATH_SECONDS = 10;            // Time underwater on a full breath
const BREATH_REFILL_SECONDS = 3;      // Empty -> full at the surface
const BREATH_RECOVER_TO_DIVE = 0.35;  // After running out, breath needed before diving again
const DROWN_DPS = 8;                  // Damage per second while out of breath underwater

// Chomping
const CHOMP_DPS = 100;           // Tree HP per second (small 100, medium 200, large 300)
const CHOMP_REACH = 0.7;         // Extra reach beyond touching the trunk
const MEGA_CHOMP_RADIUS = 12;    // Mega Chomp powerup: chomp every tree in this radius
const CHOP_SOUND_INTERVAL = 0.25;
const MAGNET_VISUAL_RADIUS = 30; // Log Magnet territory sphere (visual only)

// Building / destroying
const PLACEMENT_GAP = 1;            // Space between Chucky and the edge of the structure being placed
const PLACEMENT_MIN_DISTANCE = 3;
const MIN_STRUCTURE_SPACING = 0.5;  // Two structures may overlap by up to half their combined radii
const STRUCTURE_LOG_RADIUS = 0.4;
const STRUCTURE_LOG_HALF_LENGTH = 1.5;
const DESTROY_RANGE = 1.5;       // Distance from the nearest structure log to offer DESTROY
const DESTROY_RELEASE_RANGE = 5; // Drop the target when this far from it

// Misc
const STORE_SYNC_INTERVAL = 0.1; // Seconds between woodchuckPosition writes to the store
const GHOST_LIGHT_DURATION = 30000;

// =====================================================================
// Helpers
// =====================================================================

const moveTowards = (current: number, target: number, maxStep: number) =>
    Math.abs(target - current) <= maxStep ? target : current + Math.sign(target - current) * maxStep;

// Must match the Tree visuals in WorldObjects.tsx (trunk base = 0.5 * scale * 1.5)
const treeScale = (t: TreeData) => (t.size === 'small' ? 0.8 : t.size === 'large' ? 1.5 : 1.1);
const trunkBaseRadius = (t: TreeData) => 0.5 * treeScale(t) * 1.5;

// Spawn on the west bank, a little way back from the water, facing the river
const getSpawnPoint = (): [number, number, number] => {
    const z = 20;
    const x = getRiverX(z) - getRiverWidth(z) - 12;
    return [x, calculateTerrainHeight(x, z) + PLAYER_RADIUS, z];
};
const SPAWN_FACING = Math.PI / 2; // +X, towards the river

// Each placed structure is turned into XZ line segments (one per log) for the
// kinematic collision + destroy proximity. Built once per structure and cached.
interface StructureCollider {
    cx: number;
    cz: number;
    boundR: number;
    topY: number;       // Highest point - Chucky can swim/walk over lower (e.g. sunken) structures
    segs: Float32Array; // x1, z1, x2, z2 per log
}

const _q = new THREE.Quaternion();
const _lq = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Vector3();
const _axis = new THREE.Vector3();

const buildCollider = (s: PlacedStructure, bp: Blueprint): StructureCollider => {
    _q.setFromEuler(_e.set(s.rotation[0], s.rotation[1], s.rotation[2]));
    const segs = new Float32Array(bp.logs.length * 4);
    let boundR = 0;
    let topY = -Infinity;
    bp.logs.forEach((log, i) => {
        _c.set(log.position[0], log.position[1], log.position[2]).applyQuaternion(_q);
        _lq.setFromEuler(_e.set(log.rotation[0], log.rotation[1], log.rotation[2]));
        _axis.set(0, STRUCTURE_LOG_HALF_LENGTH, 0).applyQuaternion(_lq).applyQuaternion(_q);
        const cx = s.position[0] + _c.x;
        const cz = s.position[2] + _c.z;
        segs[i * 4] = cx - _axis.x;
        segs[i * 4 + 1] = cz - _axis.z;
        segs[i * 4 + 2] = cx + _axis.x;
        segs[i * 4 + 3] = cz + _axis.z;
        boundR = Math.max(boundR, Math.hypot(_c.x, _c.z) + STRUCTURE_LOG_HALF_LENGTH + STRUCTURE_LOG_RADIUS);
        topY = Math.max(topY, s.position[1] + _c.y + Math.abs(_axis.y) + STRUCTURE_LOG_RADIUS);
    });
    return { cx: s.position[0], cz: s.position[2], boundR, topY, segs };
};

// Horizontal radius of a blueprint around its origin (placement distance + spacing check)
const footprintCache = new WeakMap<Blueprint, number>();
const blueprintFootprint = (bp: Blueprint) => {
    let r = footprintCache.get(bp);
    if (r === undefined) {
        r = 0;
        for (const log of bp.logs) {
            r = Math.max(r, Math.hypot(log.position[0], log.position[2]) + STRUCTURE_LOG_HALF_LENGTH + STRUCTURE_LOG_RADIUS);
        }
        footprintCache.set(bp, r);
    }
    return r;
};

// Closest point on segment (x1,z1)-(x2,z2) to (px,pz). Writes into out[0..1], returns distance.
const closestOnSegment = (px: number, pz: number, x1: number, z1: number, x2: number, z2: number, out: number[]) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq > 1e-6 ? ((px - x1) * dx + (pz - z1) * dz) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    out[0] = x1 + dx * t;
    out[1] = z1 + dz * t;
    return Math.hypot(px - out[0], pz - out[1]);
};

// =====================================================================
// Component
// =====================================================================
export const Woodchuck = () => {
    // Render-level subscriptions (visual state only). Everything the frame loop
    // needs is read with useGameStore.getState() so the component does not
    // re-render on every store change.
    const isTreePowerupActive = useGameStore(state => state.isTreePowerupActive);
    const isLogPowerupActive = useGameStore(state => state.isLogPowerupActive);
    const isPlacementMode = useGameStore(state => state.isPlacementMode);
    const placementValid = useGameStore(state => state.placementValid);
    const runId = useGameStore(state => state.runId);
    const isNight = useGameStore(state => isNightTime(state.timeOfDay));
    const lastChompTime = useGameStore(state => state.lastChompTime);
    const isSpeedPowerupActive = useGameStore(state => state.isSpeedPowerupActive);

    // Kinematic body: we drive it, it pushes logs/food/mobs. It does not
    // collide with static bodies, so trees/boulders/structures are resolved manually.
    const [ref, api] = useSphere(() => ({
        type: 'Kinematic',
        mass: 100,
        position: getSpawnPoint(),
        args: [PLAYER_RADIUS],
        fixedRotation: true,
        userData: { tag: 'player' },
    }));

    // Refs
    const internalPos = useRef<[number, number, number]>(getSpawnPoint());
    const velocity = useRef({ x: 0, z: 0 });
    const currentRotationY = useRef(SPAWN_FACING);
    const visualOffsetY = useRef(0.4);
    const lastChopSound = useRef(0);
    const storeSyncTimer = useRef(0);
    const isChomping = useRef(false);
    const colliders = useRef(new Map<string, StructureCollider>());
    const closest = useRef([0, 0]);
    const breath = useRef(1);
    const breathLockout = useRef(false); // Ran out of air: must recover before diving again
    const isDiving = useRef(false);

    const visualRef = useRef<THREE.Group>(null);
    const bodyRef = useRef<THREE.Group>(null);
    const headRef = useRef<THREE.Group>(null);
    const auraRef = useRef<THREE.Group>(null);
    const ghostRef = useRef<THREE.Group>(null);
    const ghostLightRef = useRef<THREE.PointLight>(null);
    const previewRef = useRef<THREE.Group>(null);

    // Reusable vectors to avoid GC
    const moveDir = useMemo(() => new THREE.Vector3(), []);
    const forward = useMemo(() => new THREE.Vector3(), []);
    const right = useMemo(() => new THREE.Vector3(), []);

    // Ghost light: active at night for 30s after felling a tree.
    // Re-evaluated in the frame loop so it also switches OFF after 30s.
    const [ghostActive, setGhostActive] = useState(false);
    const ghostActiveRef = useRef(false);

    // Bubbles while underwater (state only flips on change)
    const [underwater, setUnderwater] = useState(false);
    const underwaterRef = useRef(false);

    // Respawn on mount and on every new/loaded run (startGame / loadGame bump runId).
    // A loaded save provides spawnPoint + spawnFacing; otherwise the default river-bank spawn.
    useEffect(() => {
        const st = useGameStore.getState();
        const spawn: [number, number, number] = st.spawnPoint ? [...st.spawnPoint] as [number, number, number] : getSpawnPoint();
        const facing = st.spawnPoint ? st.spawnFacing : SPAWN_FACING;
        internalPos.current = spawn;
        velocity.current = { x: 0, z: 0 };
        currentRotationY.current = facing;
        playerState.facing = facing;
        breath.current = 1;
        breathLockout.current = false;
        isDiving.current = false;
        currentWoodchuckPos.set(spawn[0], spawn[1], spawn[2]);
        useGameStore.setState({ woodchuckPosition: spawn });
        api.position.set(spawn[0], spawn[1], spawn[2]);
        api.velocity.set(0, 0, 0);
        colliders.current.clear();
    }, [runId, api]);

    useEffect(() => {
        // @ts-ignore - debugging handle
        window.woodchuckApi = api;
    }, [api]);

    useFrame((state, rawDelta) => {
        const s = useGameStore.getState();
        const delta = Math.min(rawDelta, MAX_FRAME_DELTA);
        const time = state.clock.elapsedTime;

        // --- Ghost light state (runs even while paused so it stays correct) ---
        const ghostShouldBeActive = isNight && Date.now() - lastChompTime < GHOST_LIGHT_DURATION;
        if (ghostShouldBeActive !== ghostActiveRef.current) {
            ghostActiveRef.current = ghostShouldBeActive;
            setGhostActive(ghostShouldBeActive);
        }

        if (s.isPaused || s.phase !== 'PLAYING') {
            api.velocity.set(0, 0, 0);
            isChomping.current = false;
            return;
        }

        let [x, y, z] = internalPos.current;

        // Fallback: if somehow below the world, respawn
        if (y < -20) {
            const spawn = getSpawnPoint();
            internalPos.current = spawn;
            velocity.current = { x: 0, z: 0 };
            api.position.set(spawn[0], spawn[1], spawn[2]);
            api.velocity.set(0, 0, 0);
            return;
        }

        // @ts-ignore
        const input = window.woodchuckInput || { x: 0, y: 0, isBuilding: false };
        const inputMag = Math.min(1, Math.hypot(input.x, input.y));
        const isMoving = inputMag > 0.1;

        // --- Camera-relative input direction ---
        forward.set(0, 0, -1).applyQuaternion(state.camera.quaternion);
        right.set(1, 0, 0).applyQuaternion(state.camera.quaternion);
        forward.y = 0;
        right.y = 0;
        forward.normalize();
        right.normalize();
        moveDir.set(0, 0, 0).addScaledVector(right, input.x).addScaledVector(forward, -input.y);
        if (moveDir.lengthSq() > 0) moveDir.normalize();

        // --- Facing (frame-rate independent) ---
        if (isMoving) {
            const targetAngle = Math.atan2(moveDir.x, moveDir.z);
            let diff = targetAngle - currentRotationY.current;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            currentRotationY.current += diff * (1 - Math.exp(-TURN_RATE * delta));
        }
        playerState.facing = currentRotationY.current;

        // --- State ---
        const terrainHere = calculateTerrainHeight(x, z);
        const inWater = terrainHere < WATER_LEVEL;
        const touchingGround = (y - terrainHere) < (PLAYER_RADIUS + 0.2);
        const isUnderwater = inWater && y < WATER_LEVEL - 0.2;
        // On the river bed while diving still counts as swimming (swim pose, swim speed, drift)
        const isSwimming = inWater && (!touchingGround || isUnderwater);

        // --- Breath ---
        if (isUnderwater) {
            breath.current = Math.max(0, breath.current - delta / BREATH_SECONDS);
            if (breath.current === 0) {
                breathLockout.current = true;
                s.takeDamage(DROWN_DPS * delta);
            }
        } else {
            breath.current = Math.min(1, breath.current + delta / BREATH_REFILL_SECONDS);
        }
        if (breathLockout.current && breath.current >= BREATH_RECOVER_TO_DIVE) breathLockout.current = false;

        // Diving: hold the dive button / Space while in the river (and not out of breath)
        isDiving.current = inWater && !!input.dive && !breathLockout.current;

        // --- Smoothed, analog velocity ---
        const speedBoost = s.isSpeedPowerupActive ? SPEED_POWERUP_MULTIPLIER : 1;
        const maxSpeed = (isSwimming ? SWIM_SPEED : WALK_SPEED) * speedBoost;
        const targetVx = isMoving ? moveDir.x * maxSpeed * inputMag : 0;
        const targetVz = isMoving ? moveDir.z * maxSpeed * inputMag : 0;
        const rate = isMoving ? ACCELERATION : DECELERATION;
        const blend = 1 - Math.exp(-rate * delta);
        velocity.current.x += (targetVx - velocity.current.x) * blend;
        velocity.current.z += (targetVz - velocity.current.z) * blend;

        let nextX = x + velocity.current.x * delta;
        let nextZ = z + velocity.current.z * delta;

        if (isSwimming) {
            // Drift with the river
            const flowSpeed = 80 / Math.max(1, getRiverWidth(z));
            nextZ += flowSpeed * RIVER_DRIFT * delta;
        }

        // --- Manual collision (kinematic body ignores static bodies) ---
        // Map bounds
        nextX = Math.max(-MAP_LIMIT, Math.min(MAP_LIMIT, nextX));
        nextZ = Math.max(-MAP_LIMIT, Math.min(MAP_LIMIT, nextZ));

        const pushOut = (objX: number, objZ: number, minDist: number) => {
            const dx = nextX - objX;
            const dz = nextZ - objZ;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < minDist) {
                if (dist > 0.001) {
                    const overlap = minDist - dist;
                    nextX += (dx / dist) * overlap;
                    nextZ += (dz / dist) * overlap;
                } else {
                    nextX += minDist;
                }
            }
        };

        // Trees (standing trunks; stumps are low enough to step over)
        for (const tree of s.trees) {
            if (tree.isFelled) continue;
            pushOut(tree.position[0], tree.position[2], PLAYER_RADIUS + trunkBaseRadius(tree));
        }

        // Boulders - only if they stick up to Chucky's level (you can swim over low ones)
        for (const boulder of s.boulders) {
            const top = boulder.position[1] + boulder.scale;
            if (top > y - PLAYER_RADIUS) {
                pushOut(boulder.position[0], boulder.position[2], PLAYER_RADIUS + boulder.scale);
            }
        }

        // Structures - per-log segments (cached)
        const cache = colliders.current;
        if (cache.size !== s.placedStructures.length || s.placedStructures.some(ps => !cache.has(ps.id))) {
            const alive = new Set(s.placedStructures.map(ps => ps.id));
            for (const id of Array.from(cache.keys())) if (!alive.has(id)) cache.delete(id);
            for (const ps of s.placedStructures) {
                if (cache.has(ps.id)) continue;
                const bp = s.blueprints.find(b => b.id === ps.blueprintId);
                if (bp) cache.set(ps.id, buildCollider(ps, bp));
            }
        }

        const minLogDist = PLAYER_RADIUS + STRUCTURE_LOG_RADIUS;
        const out = closest.current;
        let nearestStructId: string | null = null;
        let nearestStructDist = Infinity;
        let targetStructDist = Infinity;

        for (const ps of s.placedStructures) {
            const col = cache.get(ps.id);
            if (!col) continue;
            if (Math.hypot(nextX - col.cx, nextZ - col.cz) > col.boundR + PLAYER_RADIUS + DESTROY_RELEASE_RANGE) continue;
            if (y - PLAYER_RADIUS > col.topY) continue; // Above a low / sunken structure

            let structDist = Infinity;
            const segs = col.segs;
            for (let i = 0; i < segs.length; i += 4) {
                const d = closestOnSegment(nextX, nextZ, segs[i], segs[i + 1], segs[i + 2], segs[i + 3], out);
                if (d < minLogDist) {
                    if (d > 0.001) {
                        const push = minLogDist - d;
                        nextX += ((nextX - out[0]) / d) * push;
                        nextZ += ((nextZ - out[1]) / d) * push;
                    } else {
                        nextX += minLogDist;
                    }
                }
                structDist = Math.min(structDist, d);
            }
            if (structDist < nearestStructDist) {
                nearestStructDist = structDist;
                nearestStructId = ps.id;
            }
            if (ps.id === s.destroyTargetId) targetStructDist = structDist;
        }

        // --- Vertical: terrain following, floating & diving ---
        const terrainNext = calculateTerrainHeight(nextX, nextZ);
        const bedY = terrainNext + PLAYER_RADIUS;
        const smoothK = 1 - Math.exp(-VERTICAL_SMOOTHING * delta);
        let finalY: number;
        if (terrainNext < WATER_LEVEL) {
            const floatY = Math.max(bedY, SURFACE_Y);
            if (isDiving.current) {
                finalY = moveTowards(y, bedY, DIVE_SPEED * delta);       // Sink towards the river bed
            } else if (y < floatY) {
                finalY = moveTowards(y, floatY, SURFACE_SPEED * delta);  // Swim back up
            } else {
                finalY = THREE.MathUtils.lerp(y, floatY, smoothK);       // Settle onto the surface
            }
            // The river bed rising under Chucky (swimming towards a bank) pushes him up quickly
            if (finalY < bedY) finalY = THREE.MathUtils.lerp(y, bedY, smoothK);
        } else {
            finalY = THREE.MathUtils.lerp(y, bedY, smoothK);
        }

        // --- Apply to physics (velocity lets the kinematic body push logs/mobs) ---
        const safeDelta = Math.max(0.001, delta);
        api.position.set(nextX, finalY, nextZ);
        api.velocity.set((nextX - x) / safeDelta, (finalY - y) / safeDelta, (nextZ - z) / safeDelta);

        internalPos.current = [nextX, finalY, nextZ];
        currentWoodchuckPos.set(nextX, finalY, nextZ);
        x = nextX; y = finalY; z = nextZ;

        storeSyncTimer.current += delta;
        if (storeSyncTimer.current >= STORE_SYNC_INTERVAL) {
            storeSyncTimer.current = 0;
            useGameStore.setState({ woodchuckPosition: [x, y, z] });
        }

        // Water / breath for the HUD + dive button (only written when it changes, breath in 2% steps)
        const breathStep = Math.round(breath.current * 50) / 50;
        if (s.isInWater !== inWater || s.breath !== breathStep) s.setWaterState(inWater, breathStep);

        const nowUnderwater = inWater && y < WATER_LEVEL - 0.2;
        if (nowUnderwater !== underwaterRef.current) {
            underwaterRef.current = nowUnderwater;
            setUnderwater(nowUnderwater);
        }

        // --- Building: placement preview, validity + place ---
        // The preview sits in front of Chucky, far enough that even big structures never land on him.
        // Yaw = Chucky's facing + the rotation offset (🔄 / R).
        const selectedBp = s.isPlacementMode ? s.blueprints.find(b => b.id === s.selectedBlueprintId) : undefined;
        const footprint = selectedBp ? blueprintFootprint(selectedBp) : 0;
        const placeDist = Math.max(PLACEMENT_MIN_DISTANCE, PLAYER_RADIUS + footprint + PLACEMENT_GAP);
        const placeX = x + Math.sin(currentRotationY.current) * placeDist;
        const placeZ = z + Math.cos(currentRotationY.current) * placeDist;
        const placeY = calculateTerrainHeight(placeX, placeZ);
        const placeYaw = currentRotationY.current + s.placementRotation[1];
        const placePitch = s.placementRotation[0];

        let placementOk = false;
        if (selectedBp) {
            let reason: string | null = null;
            if (s.woodCount < selectedBp.cost) {
                reason = `Need ${selectedBp.cost} wood`;
            } else if (Math.abs(placeX) > MAP_LIMIT || Math.abs(placeZ) > MAP_LIMIT) {
                reason = 'Too close to the edge of the map';
            } else {
                for (const ps of s.placedStructures) {
                    const col = cache.get(ps.id);
                    if (col && Math.hypot(placeX - col.cx, placeZ - col.cz) < (footprint + col.boundR) * MIN_STRUCTURE_SPACING) {
                        reason = 'Too close to another structure';
                        break;
                    }
                }
            }
            placementOk = reason === null;
            s.setPlacementStatus(placementOk, placeY < WATER_LEVEL, reason);
        }

        if (s.isPlacementMode && previewRef.current) {
            previewRef.current.position.set(placeX, placeY, placeZ);
            previewRef.current.rotation.set(placePitch, placeYaw, 0);
        }

        if (input.isBuilding) {
            // Consume the button press whatever happens
            // @ts-ignore
            window.woodchuckInput.isBuilding = false;
            if (s.isPlacementMode && placementOk) {
                s.placeStructure([placeX, placeY, placeZ], [placePitch, placeYaw, 0]);
            }
        }

        // --- Destroy target (hold 💥 to destroy) ---
        if (!s.isPlacementMode) {
            if (s.destroyTargetId) {
                const stillExists = s.placedStructures.some(ps => ps.id === s.destroyTargetId);
                if (!stillExists || (!s.isDestroying && targetStructDist > DESTROY_RELEASE_RANGE)) {
                    s.setDestroyTarget(null);
                }
            } else if (nearestStructId && nearestStructDist < DESTROY_RANGE) {
                s.setDestroyTarget(nearestStructId);
            }
        } else if (s.destroyTargetId && !s.isDestroying) {
            s.setDestroyTarget(null);
        }

        // --- Chomping (restored: this damage call was lost in the March refactor) ---
        let chomped = false;
        if (!s.isPlacementMode) {
            if (s.isTreePowerupActive) {
                // Mega Chomp: every standing tree in range, nearest damaged last so it's the one shown in the UI
                const inRange: { tree: TreeData; d: number }[] = [];
                for (const tree of s.trees) {
                    if (tree.isFelled) continue;
                    const d = Math.hypot(x - tree.position[0], z - tree.position[2]);
                    if (d < MEGA_CHOMP_RADIUS) inRange.push({ tree, d });
                }
                inRange.sort((a, b) => b.d - a.d);
                for (const { tree } of inRange) s.damageTree(tree.id, CHOMP_DPS * delta);
                chomped = inRange.length > 0;
            } else {
                // Normal: the nearest tree Chucky is touching
                let best: TreeData | null = null;
                let bestGap = Infinity;
                for (const tree of s.trees) {
                    if (tree.isFelled) continue;
                    const d = Math.hypot(x - tree.position[0], z - tree.position[2]);
                    const gap = d - (PLAYER_RADIUS + trunkBaseRadius(tree));
                    if (gap < CHOMP_REACH && gap < bestGap) {
                        best = tree;
                        bestGap = gap;
                    }
                }
                if (best) {
                    s.damageTree(best.id, CHOMP_DPS * delta);
                    chomped = true;
                }
            }
        }

        if (chomped) {
            if (time - lastChopSound.current > CHOP_SOUND_INTERVAL) {
                audioService.playChop();
                lastChopSound.current = time;
            }
        } else if (useGameStore.getState().activeTreeId !== null) {
            s.setActiveTree(null);
        }
        isChomping.current = chomped;

        // --- Visuals ---
        if (visualRef.current) {
            visualRef.current.position.set(x, y, z);
            visualRef.current.rotation.set(0, currentRotationY.current, 0);
        }
        if (bodyRef.current) {
            // Swimming: lie belly-down with the head pointing forward (+Z)
            const targetOffset = isSwimming ? 0 : 0.4;
            visualOffsetY.current += (targetOffset - visualOffsetY.current) * (1 - Math.exp(-10 * delta));
            bodyRef.current.position.y = visualOffsetY.current;
            // Nose down while diving towards the bed, nose up while surfacing
            const divePitch = isDiving.current && y > bedY + 0.05 ? 0.45 : (!isDiving.current && y < SURFACE_Y - 0.1 ? -0.35 : 0);
            const targetPitch = isSwimming ? Math.PI / 2 + divePitch : 0;
            bodyRef.current.rotation.x += (targetPitch - bodyRef.current.rotation.x) * (1 - Math.exp(-10 * delta));
        }
        if (headRef.current) {
            // Chomp nod
            headRef.current.rotation.x = chomped ? Math.sin(time * 30) * 0.3 : 0;
        }
        if (auraRef.current) {
            auraRef.current.position.set(x, y, z);
        }
        if (ghostRef.current) {
            ghostRef.current.position.set(x, y, z);
            if (ghostLightRef.current) {
                const flicker = Math.sin(time * 15) * 0.3 + Math.cos(time * 27) * 0.3;
                ghostLightRef.current.intensity = ghostActiveRef.current ? 6 + flicker : 0;
                ghostLightRef.current.position.set(Math.sin(time * 1.3) * 0.2, 3.5 + Math.sin(time * 2) * 0.2, Math.cos(time * 1.7) * 0.2);
            }
        }
    });

    const furColor = isTreePowerupActive ? '#FFD700' : '#795548';
    const headColor = isTreePowerupActive ? '#FFD700' : '#5D4037';

    return (
        <group>
            {/* Physics body (invisible) */}
            <group ref={ref as any} />

            {/* Visual model: visualRef = position + yaw, bodyRef = pose, headRef = chomp nod */}
            <group ref={visualRef}>
                <group ref={bodyRef} position={[0, 0.4, 0]}>
                    <mesh position={[0, 0, 0]} castShadow>
                        <capsuleGeometry args={[0.5, 1, 4, 8]} />
                        <meshStandardMaterial color={furColor} />
                    </mesh>
                    <group ref={headRef} position={[0, 0.6, 0]}>
                        <mesh position={[0, 0.2, 0]} castShadow>
                            <sphereGeometry args={[0.4, 16, 16]} />
                            <meshStandardMaterial color={headColor} />
                        </mesh>
                        <mesh position={[0.15, 0.3, 0.3]} castShadow>
                            <sphereGeometry args={[0.08, 8, 8]} />
                            <meshStandardMaterial color="black" />
                        </mesh>
                        <mesh position={[-0.15, 0.3, 0.3]} castShadow>
                            <sphereGeometry args={[0.08, 8, 8]} />
                            <meshStandardMaterial color="black" />
                        </mesh>
                        <mesh position={[0, 0.1, 0.35]} castShadow>
                            <boxGeometry args={[0.2, 0.15, 0.05]} />
                            <meshStandardMaterial color="white" />
                        </mesh>
                    </group>
                    <mesh position={[0, -0.3, -0.5]} rotation={[-Math.PI / 4, 0, 0]} castShadow>
                        <capsuleGeometry args={[0.15, 0.6, 4, 8]} />
                        <meshStandardMaterial color="#4E342E" />
                    </mesh>
                    {isTreePowerupActive && (
                        <mesh position={[0, 1.2, 0]}>
                            <torusGeometry args={[0.3, 0.05, 8, 16]} />
                            <meshStandardMaterial color="#FFD700" emissive="#FFD700" emissiveIntensity={0.5} />
                        </mesh>
                    )}
                </group>
            </group>

            {/* Powerup territory spheres - follow position, not rotation */}
            <group ref={auraRef}>
                {isTreePowerupActive && (
                    <>
                        <mesh>
                            <sphereGeometry args={[MEGA_CHOMP_RADIUS, 32, 32]} />
                            <meshBasicMaterial color="#FF4500" wireframe transparent opacity={0.15} depthWrite={false} />
                        </mesh>
                        <mesh>
                            <sphereGeometry args={[MEGA_CHOMP_RADIUS - 0.2, 32, 32]} />
                            <meshBasicMaterial color="#FF4500" transparent opacity={0.05} side={THREE.DoubleSide} depthWrite={false} />
                        </mesh>
                    </>
                )}
                {isLogPowerupActive && (
                    <>
                        <mesh>
                            <sphereGeometry args={[MAGNET_VISUAL_RADIUS, 32, 32]} />
                            <meshBasicMaterial color="#00BFFF" wireframe transparent opacity={0.15} depthWrite={false} />
                        </mesh>
                        <mesh>
                            <sphereGeometry args={[MAGNET_VISUAL_RADIUS - 0.2, 32, 32]} />
                            <meshBasicMaterial color="#00BFFF" transparent opacity={0.05} side={THREE.DoubleSide} depthWrite={false} />
                        </mesh>
                    </>
                )}
                {/* Zoomies: speed sparkles */}
                {isSpeedPowerupActive && (
                    <Sparkles count={30} scale={[1.5, 1.5, 1.5]} size={5} speed={2} opacity={0.9} color="#7CFFB2" position={[0, 0.6, 0]} />
                )}
                {/* Bubbles while underwater */}
                {underwater && (
                    <Sparkles count={20} scale={[0.8, 2.5, 0.8]} size={4} speed={1.5} opacity={0.7} color="#E0F7FF" position={[0, 1.2, 0]} />
                )}
            </group>

            {/* Ghost light - the light is always mounted (intensity 0 when off) to avoid shader recompiles */}
            <group ref={ghostRef}>
                <pointLight ref={ghostLightRef} position={[0, 3.5, 0]} intensity={0} distance={25} decay={2} color="#FFD700" />
                {ghostActive && (
                    <>
                        <mesh position={[0, 3.5, 0]}>
                            <sphereGeometry args={[0.15, 8, 8]} />
                            <meshBasicMaterial color="#FFFFE0" transparent opacity={0.8} />
                        </mesh>
                        <Sparkles count={40} scale={2.5} size={6} speed={0.4} opacity={0.8} color="#FFFF00" position={[0, 3.5, 0]} />
                    </>
                )}
            </group>

            {/* Placement preview */}
            {isPlacementMode && (
                <group ref={previewRef}>
                    <PreviewStructureOverlay valid={placementValid} />
                </group>
            )}
        </group>
    );
};
