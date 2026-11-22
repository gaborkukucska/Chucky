import React, { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, calculateTerrainHeight, isNightTime } from '../store';
import { audioService } from '../services/audio';
import { getWaterLevel, hydrology, magpieCount } from '../services/hydrology';
import { abilityEvents, currentWoodchuckPos, liveObjects, readBodyPosition } from '../globals';

// =====================================================================
// Magpies: when a dam floods a meadow (a wetland, services/hydrology.ts), magpies move in and
// nest on a dead tree at its edge. The bigger the wetlands, the bigger the flock (up to 8).
//
//   By day they sit on their nests, warble, and now and then take a lap over the water.
//   At night they guard Chucky while he's near their wetland: a wolf or bear that comes close
//   gets swooped.
//   Magpie Call (Q / 🐦): the whole flock comes to Chucky wherever he is, swoops every wolf and
//   bear nearby, and circles over him for a while, swooping anything else that comes.
//
// A swoop counts as a hit, like a thrown log (wolves run off after 2, bears after 3).
// =====================================================================
const MAX_BIRDS = 8;
const NEST_HEIGHT = 5.2;           // m - the snag's top, where the nest is
const GUARD_RANGE = 45;            // m from a nest: the flock guards Chucky at night
const GUARD_REACH = 22;            // m from Chucky: wolves/bears inside this get swooped
const CALL_REACH = 32;             // m from Chucky: the Magpie Call goes after these at once
const ESCORT_TIME = 12;            // s the flock circles over Chucky after a call
const SWOOPS_PER_RUN = 2;          // Dives at the same animal before giving up
const GUARD_REST = 4;              // s a magpie rests between guard runs
const SPEED = { cruise: 11, swoop: 19, home: 13 };
const STEER = 28;                  // m/s² - how hard they turn
const BIRD_SCALE = 1.7;            // Bigger than life, so you can see them

type Mode = 'arrive' | 'perch' | 'lap' | 'home' | 'escort' | 'swoop' | 'climb';

interface Bird {
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    nest: number;
    seat: number;            // Which spot on the nest
    mode: Mode;
    until: number;
    target: string | null;
    swoopsLeft: number;
    restUntil: number;
    lapAngle: number;
    nextLap: number;
    flap: number;
    yaw: number;
}

interface Nest { x: number; y: number; z: number }

// A dry spot at the wetland's edge, close to its middle (the same for everyone: no randomness)
const nestFor = (wx: number, wz: number): Nest | null => {
    for (const r of [3, 6, 9, 12, 16, 20, 25]) {
        let best: Nest | null = null;
        for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            const x = wx + Math.cos(a) * r, z = wz + Math.sin(a) * r;
            const g = calculateTerrainHeight(x, z);
            if (g > getWaterLevel(x, z) + 0.4) {
                if (!best || g < best.y) best = { x, y: g, z }; // The lowest dry spot: right at the edge
            }
        }
        if (best) return best;
    }
    return null;
};

const seatOffset = (seat: number): [number, number] => {
    const a = seat * 2.1;
    return [Math.cos(a) * 0.45, Math.sin(a) * 0.45];
};

const _mob = new THREE.Vector3();
const _want = new THREE.Vector3();

// --- A dead tree with a nest on top: where the magpies live ---
const Snag = ({ nest }: { nest: Nest }) => (
    <group position={[nest.x, nest.y, nest.z]}>
        <mesh position={[0, NEST_HEIGHT / 2, 0]} castShadow>
            <cylinderGeometry args={[0.14, 0.3, NEST_HEIGHT, 7]} />
            <meshStandardMaterial color="#8a8178" roughness={1} />
        </mesh>
        <mesh position={[0.35, NEST_HEIGHT * 0.62, 0]} rotation={[0, 0, -0.9]}>
            <cylinderGeometry args={[0.05, 0.09, 1.3, 5]} />
            <meshStandardMaterial color="#8a8178" roughness={1} />
        </mesh>
        <mesh position={[-0.3, NEST_HEIGHT * 0.45, 0.1]} rotation={[0.2, 0, 1.0]}>
            <cylinderGeometry args={[0.04, 0.08, 1.0, 5]} />
            <meshStandardMaterial color="#8a8178" roughness={1} />
        </mesh>
        {/* The nest: a ring of twigs */}
        <mesh position={[0, NEST_HEIGHT, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.45, 0.17, 6, 12]} />
            <meshStandardMaterial color="#6b4f2e" roughness={1} />
        </mesh>
        <mesh position={[0, NEST_HEIGHT - 0.05, 0]}>
            <cylinderGeometry args={[0.42, 0.3, 0.2, 10]} />
            <meshStandardMaterial color="#5a4024" roughness={1} />
        </mesh>
    </group>
);

// --- A magpie: black with white patches; +Z forward ---
const MagpieModel = React.forwardRef<THREE.Group, { wingL: React.Ref<THREE.Group>; wingR: React.Ref<THREE.Group> }>(({ wingL, wingR }, ref) => (
    <group ref={ref} scale={BIRD_SCALE} visible={false}>
        <mesh scale={[0.1, 0.1, 0.19]} castShadow><sphereGeometry args={[1, 10, 8]} /><meshStandardMaterial color="#141414" roughness={0.6} /></mesh>
        {/* White belly and nape */}
        <mesh position={[0, -0.035, -0.02]} scale={[0.085, 0.065, 0.12]}><sphereGeometry args={[1, 8, 6]} /><meshStandardMaterial color="#f2f2f2" /></mesh>
        <mesh position={[0, 0.07, 0.07]} scale={[0.07, 0.035, 0.05]}><sphereGeometry args={[1, 8, 6]} /><meshStandardMaterial color="#f2f2f2" /></mesh>
        {/* Head and beak */}
        <mesh position={[0, 0.05, 0.17]}><sphereGeometry args={[0.07, 10, 8]} /><meshStandardMaterial color="#141414" roughness={0.6} /></mesh>
        <mesh position={[0, 0.04, 0.27]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.025, 0.1, 6]} /><meshStandardMaterial color="#c9c4bd" /></mesh>
        <mesh position={[0.04, 0.07, 0.21]}><sphereGeometry args={[0.012, 6, 4]} /><meshBasicMaterial color="#a33" /></mesh>
        <mesh position={[-0.04, 0.07, 0.21]}><sphereGeometry args={[0.012, 6, 4]} /><meshBasicMaterial color="#a33" /></mesh>
        {/* Tail */}
        <mesh position={[0, 0.0, -0.27]} rotation={[0.15, 0, 0]} scale={[0.06, 0.012, 0.16]}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#141414" /></mesh>
        {/* Wings: pivot at the shoulder, black with a white bar */}
        <group ref={wingL} position={[0.08, 0.04, 0.02]}>
            <mesh position={[0.15, 0, -0.03]} scale={[0.3, 0.015, 0.15]}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#141414" /></mesh>
            <mesh position={[0.1, 0.009, 0.0]} scale={[0.14, 0.01, 0.07]}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#f2f2f2" /></mesh>
        </group>
        <group ref={wingR} position={[-0.08, 0.04, 0.02]}>
            <mesh position={[-0.15, 0, -0.03]} scale={[0.3, 0.015, 0.15]}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#141414" /></mesh>
            <mesh position={[-0.1, 0.009, 0.0]} scale={[0.14, 0.01, 0.07]}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#f2f2f2" /></mesh>
        </group>
    </group>
));

export const Magpies = () => {
    const [nests, setNests] = useState<Nest[]>([]);
    const nestsRef = useRef<Nest[]>([]);
    const seenVersion = useRef(-1);
    const birds = useRef<Bird[]>([]);
    const escortUntil = useRef(0);
    const lastSong = useRef(0);
    const lastGuard = useRef(0);
    const knownWetlands = useRef(-1);
    const bodyRefs = useRef<(THREE.Group | null)[]>([]);
    const wingL = useRef<(THREE.Group | null)[]>([]);
    const wingR = useRef<(THREE.Group | null)[]>([]);

    const perchPoint = (b: Bird, out: THREE.Vector3) => {
        const n = nestsRef.current[b.nest % Math.max(1, nestsRef.current.length)];
        if (!n) return out.copy(b.pos);
        const [ox, oz] = seatOffset(b.seat);
        return out.set(n.x + ox, n.y + NEST_HEIGHT + 0.25, n.z + oz);
    };

    // Send a free magpie after a wolf or bear (returns false when none is free)
    const sendAfter = (id: string, t: number, needRest: boolean) => {
        const mob = liveObjects.mobs.get(id);
        if (!mob) return false;
        const mp = readBodyPosition(mob.object, _mob);
        let best: Bird | null = null, bestD = Infinity;
        for (const b of birds.current) {
            if (b.mode === 'swoop' || b.mode === 'climb' || b.mode === 'arrive') continue;
            if (needRest && t < b.restUntil) continue;
            const d = b.pos.distanceTo(mp);
            if (d < bestD) { bestD = d; best = b; }
        }
        if (!best) return false;
        best.mode = 'swoop';
        best.target = id;
        best.swoopsLeft = SWOOPS_PER_RUN;
        best.restUntil = t + GUARD_REST;
        audioService.playMagpie(Math.max(0, 1 - best.pos.distanceTo(currentWoodchuckPos) / 50) * 0.8);
        return true;
    };

    useFrame((state, rawDelta) => {
        const t = state.clock.elapsedTime;
        const s = useGameStore.getState();
        const delta = s.isPaused ? 0 : Math.min(rawDelta, 0.1);
        const me = currentWoodchuckPos;

        // --- Where they nest, and how many there are ---
        if (seenVersion.current !== hydrology.wetlandVersion) {
            seenVersion.current = hydrology.wetlandVersion;
            const list: Nest[] = [];
            for (const w of hydrology.wetlands.slice(0, 3)) {
                const n = nestFor(w.x, w.z);
                if (n && !list.some(o => Math.hypot(o.x - n.x, o.z - n.z) < 6)) list.push(n);
            }
            nestsRef.current = list;
            setNests(list);

            // A new wetland (counts for the "flood a meadow" challenge); magpies moving in
            const count = hydrology.wetlands.length;
            if (knownWetlands.current >= 0 && count > knownWetlands.current && s.phase === 'PLAYING') {
                for (let i = knownWetlands.current; i < count; i++) s.addTally('floods');
            }
            const hadBirds = birds.current.length > 0;
            knownWetlands.current = count;
            const want = list.length ? magpieCount() : 0;
            while (birds.current.length < want) {
                // New arrivals fly in from far away
                const a = Math.random() * Math.PI * 2;
                const i = birds.current.length;
                birds.current.push({
                    pos: new THREE.Vector3(me.x + Math.cos(a) * 70, me.y + 30, me.z + Math.sin(a) * 70),
                    vel: new THREE.Vector3(), nest: i % Math.max(1, list.length), seat: Math.floor(i / Math.max(1, list.length)),
                    mode: hadBirds || s.phase !== 'PLAYING' ? 'home' : 'arrive', until: 0, target: null, swoopsLeft: 0, restUntil: 0,
                    lapAngle: Math.random() * 6, nextLap: t + 8 + Math.random() * 12, flap: Math.random() * 6, yaw: 0,
                });
            }
            if (birds.current.length > want) birds.current.length = want;
            if (!hadBirds && want > 0 && s.phase === 'PLAYING' && !s.isPaused) {
                useGameStore.setState({
                    notification: {
                        id: `magpies-arrive-${Date.now()}`,
                        title: '🐦 MAGPIES MOVED IN!',
                        message: `${want} magpies nest by your wetland. At night they guard you nearby, and Q / 🐦 calls them to swoop!`,
                        type: 'achievement',
                    },
                });
                audioService.playMagpie(0.9);
            }
        }

        const flock = birds.current;
        if (import.meta.env.DEV) (window as any).__chuckyMagpies = { birds: flock, nests: nestsRef.current };
        if (flock.length === 0) {
            bodyRefs.current.forEach(g => g && (g.visible = false));
            return;
        }

        // --- Magpie Call ---
        for (let i = abilityEvents.queue.length - 1; i >= 0; i--) {
            if (abilityEvents.queue[i].kind !== 'magpies') continue;
            abilityEvents.queue.splice(i, 1);
            escortUntil.current = t + ESCORT_TIME;
            for (const b of flock) if (b.mode !== 'swoop' && b.mode !== 'climb') { b.mode = 'escort'; b.restUntil = 0; }
            audioService.playMagpie(1);
            // Straight after everything close by, two magpies each
            const targets = [...liveObjects.mobs.entries()]
                .filter(([, m]) => m.type !== 'piranha')
                .map(([id, m]) => ({ id, d: readBodyPosition(m.object, _mob).distanceTo(me) }))
                .filter(o => o.d < CALL_REACH)
                .sort((a, b) => a.d - b.d);
            for (const o of targets) { sendAfter(o.id, t, false); sendAfter(o.id, t, false); }
        }

        // --- Guarding: at night near the nests, or while escorting after a call ---
        const escorting = t < escortUntil.current;
        if (!s.isPaused && s.phase === 'PLAYING' && t - lastGuard.current > 0.25) {
            lastGuard.current = t;
            const nearNest = nestsRef.current.some(n => Math.hypot(n.x - me.x, n.z - me.z) < GUARD_RANGE);
            if (escorting || (isNightTime(s.timeOfDay) && nearNest)) {
                const chased = new Set(flock.filter(b => b.target).map(b => b.target));
                for (const [id, m] of liveObjects.mobs) {
                    if (m.type === 'piranha' || chased.has(id)) continue;
                    if (readBodyPosition(m.object, _mob).distanceTo(me) < GUARD_REACH) sendAfter(id, t, !escorting);
                }
            }
        }

        // A song now and then from a magpie near Chucky
        if (!s.isPaused && t - lastSong.current > 7 + Math.random() * 6) {
            lastSong.current = t;
            const near = flock.find(b => b.pos.distanceTo(me) < 35);
            if (near) audioService.playMagpie(Math.max(0, 1 - near.pos.distanceTo(me) / 40) * 0.6);
        }

        // --- Flying ---
        flock.forEach((b, i) => {
            if (delta === 0) return;
            let speed = SPEED.cruise;
            switch (b.mode) {
                case 'perch': {
                    perchPoint(b, b.pos);
                    b.vel.set(0, 0, 0);
                    if (!isNightTime(s.timeOfDay) && t > b.nextLap) { b.mode = 'lap'; b.until = t + 5 + Math.random() * 4; }
                    if (escorting) b.mode = 'escort';
                    break;
                }
                case 'arrive':
                case 'home': {
                    perchPoint(b, _want);
                    speed = SPEED.home;
                    if (b.pos.distanceTo(_want) < 0.6) { b.mode = 'perch'; b.nextLap = t + 10 + Math.random() * 15; }
                    break;
                }
                case 'lap': {
                    const n = nestsRef.current[b.nest % nestsRef.current.length];
                    b.lapAngle += delta * 0.9;
                    if (n) _want.set(n.x + Math.cos(b.lapAngle) * 9, n.y + 10, n.z + Math.sin(b.lapAngle) * 9);
                    if (t > b.until) b.mode = 'home';
                    break;
                }
                case 'escort': {
                    b.lapAngle += delta * 1.3;
                    const a = b.lapAngle + (i / flock.length) * Math.PI * 2;
                    _want.set(me.x + Math.cos(a) * 6, me.y + 6 + Math.sin(t * 2 + i) * 0.6, me.z + Math.sin(a) * 6);
                    if (!escorting) b.mode = 'home';
                    break;
                }
                case 'swoop': {
                    const mob = b.target ? liveObjects.mobs.get(b.target) : undefined;
                    if (!mob) { b.mode = escorting ? 'escort' : 'home'; b.target = null; break; }
                    const mp = readBodyPosition(mob.object, _mob);
                    const flat = Math.hypot(mp.x - b.pos.x, mp.z - b.pos.z);
                    speed = SPEED.swoop;
                    // Get above and behind it, then dive at its head
                    _want.set(mp.x, mp.y + (flat > 5 ? 4 : 0.3), mp.z);
                    if (b.pos.distanceTo(_want) < 1.3 && flat < 1.5) {
                        const dx = mp.x - b.pos.x + b.vel.x * 0.1, dz = mp.z - b.pos.z + b.vel.z * 0.1;
                        const h = Math.hypot(dx, dz) || 1;
                        mob.hit(dx / h, dz / h);
                        audioService.playSwoop(Math.max(0, 1 - mp.distanceTo(me) / 50));
                        s.addTally('swoops');
                        b.swoopsLeft -= 1;
                        b.mode = 'climb';
                        b.until = t + 0.7;
                        b.vel.y = 9;
                    }
                    break;
                }
                case 'climb': {
                    _want.copy(b.pos).addScaledVector(b.vel, 0.3);
                    _want.y = b.pos.y + 3;
                    if (t > b.until) {
                        const alive = b.target && liveObjects.mobs.has(b.target);
                        if (alive && b.swoopsLeft > 0) b.mode = 'swoop';
                        else { b.target = null; b.mode = escorting ? 'escort' : 'home'; }
                    }
                    break;
                }
            }

            if (b.mode !== 'perch') {
                // Steer towards where it wants to be
                const desired = _want.clone().sub(b.pos);
                const dist = desired.length();
                if (dist > 0.001) desired.multiplyScalar(Math.min(speed, dist * 3) / dist);
                const dv = desired.sub(b.vel);
                const maxDv = STEER * delta * (b.mode === 'swoop' ? 1.6 : 1);
                if (dv.length() > maxDv) dv.setLength(maxDv);
                b.vel.add(dv);
                b.pos.addScaledVector(b.vel, delta);
                // Never through the ground or the water
                const floor = Math.max(calculateTerrainHeight(b.pos.x, b.pos.z), getWaterLevel(b.pos.x, b.pos.z)) + 0.4;
                if (b.pos.y < floor) { b.pos.y = floor; if (b.vel.y < 0) b.vel.y = 0; }
            }

            // --- Pose ---
            const g = bodyRefs.current[i];
            if (!g) return;
            g.visible = true;
            g.position.copy(b.pos);
            const hs = Math.hypot(b.vel.x, b.vel.z);
            if (hs > 0.3) b.yaw = Math.atan2(b.vel.x, b.vel.z);
            else if (b.mode === 'perch') b.yaw += Math.sin(t * 0.7 + i) * 0.004; // Looking about
            g.rotation.set(b.mode === 'perch' ? 0 : -Math.atan2(b.vel.y, Math.max(1, hs)) * 0.8, b.yaw, 0, 'YXZ');
            // Wings: folded when perched, gliding in a dive, flapping otherwise
            const flying = b.mode !== 'perch';
            b.flap += delta * (b.mode === 'swoop' ? 10 : 16);
            const diving = b.mode === 'swoop' && b.vel.y < -3;
            const angle = !flying ? -1.3 : diving ? 0.15 : Math.sin(b.flap) * 0.9;
            const l = wingL.current[i], r = wingR.current[i];
            if (l) l.rotation.z = angle;
            if (r) r.rotation.z = -angle;
        });
        for (let i = flock.length; i < MAX_BIRDS; i++) {
            const g = bodyRefs.current[i];
            if (g) g.visible = false;
        }
    });

    const birdSlots = useMemo(() => Array.from({ length: MAX_BIRDS }, (_, i) => i), []);

    return (
        <>
            {nests.map((n, i) => <Snag key={`${i}-${n.x.toFixed(1)}-${n.z.toFixed(1)}`} nest={n} />)}
            {birdSlots.map(i => (
                <MagpieModel
                    key={i}
                    ref={el => { bodyRefs.current[i] = el; }}
                    wingL={el => { wingL.current[i] = el; }}
                    wingR={el => { wingR.current[i] = el; }}
                />
            ))}
        </>
    );
};

/** Where the magpies nest, for the minimap */
let nestCache: { version: number; nests: { x: number; z: number }[] } = { version: -1, nests: [] };
export const magpieNests = (): { x: number; z: number }[] => {
    if (nestCache.version === hydrology.wetlandVersion) return nestCache.nests;
    const out: { x: number; z: number }[] = [];
    for (const w of hydrology.wetlands.slice(0, 3)) {
        const n = nestFor(w.x, w.z);
        if (n && !out.some(o => Math.hypot(o.x - n.x, o.z - n.z) < 6)) out.push({ x: n.x, z: n.z });
    }
    nestCache = { version: hydrology.wetlandVersion, nests: out };
    return out;
};
