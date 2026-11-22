import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useSphere } from '@react-three/cannon';
import * as THREE from 'three';
import { useGameStore, calculateTerrainHeight, isNightTime } from '../store';
import { audioService } from '../services/audio';
import { getWaterLevel } from '../services/hydrology';
import { currentWoodchuckPos, fx, liveObjects, readBodyPosition } from '../globals';
import { MobData } from '../types';

// =====================================================================
// Wolves and bears: they come out at night, each with its own way of hunting.
//
//   Wolf: lopes towards Chucky, then CIRCLES him (keeping its distance, sizing him up) and
//         suddenly LUNGES straight at him. Missed or not, it backs off and circles again.
//         Howls when it first picks up his scent.
//   Bear: lumbers towards Chucky, then REARS UP on its hind legs and roars (your warning),
//         and CHARGES in a straight line - it can't turn while charging, so step aside! -
//         then stands panting for a moment.
//
// Neither will wade into water (a river, a pond behind a dam, a flooded meadow): one that ends
// up in deep water - a flood rising round it, a tail-slap wave - is washed away (chased off).
// =====================================================================

export const MOB_DAMAGE = { wolf: 15, bear: 30 };
const MOB_AGGRO_RANGE = 45;
const MOB_HIT_RANGE = { wolf: 1.4, bear: 1.8 };
const MOB_HIT_COOLDOWN = 1200;      // ms between hits from the same mob
const MOB_KNOCKBACK = 60;           // Impulse on the mob after it bites (mass 10)
const MOB_HITS_TO_CHASE = { wolf: 2, bear: 3 }; // Hits (logs, swoops, waves) before it runs off
const MOB_STUN_TIME = 900;          // ms dazed after a hit
const MOB_HIT_KNOCKBACK = 55;
const SHOVE_KNOCKBACK = 150;        // A full-power tail-slap wave
const SHOVE_STUN_TIME = 1500;
const WASH_DEPTH = 0.55;            // m of water over the ground that sweeps a mob away
const WASH_TIME = 0.35;             // s it has to be that deep

const WOLF = {
    run: 9,                // m/s towards Chucky
    circleFrom: 14,        // m - starts circling inside this
    circleRadius: 7,       // m it keeps while circling
    circleSpeed: 7,        // m/s around him
    circleTime: [1.4, 3.2],// s before it lunges
    lungeSpeed: 17,        // m/s
    lungeTime: 0.75,       // s
    retreatTime: 0.7,      // s backing off after a lunge
    retreatSpeed: 6,
};
const BEAR = {
    walk: 5,               // m/s lumbering towards Chucky
    rearFrom: 11,          // m - rears up inside this
    rearTime: 0.9,         // s up on its hind legs (the warning)
    chargeSpeed: 15,       // m/s
    chargeTime: 1.3,       // s, in a straight line
    tiredTime: 1.4,        // s panting afterwards
};
const RADIUS = { wolf: 0.5, bear: 0.7 };

type Mode = 'idle' | 'approach' | 'circle' | 'lunge' | 'retreat' | 'rear' | 'charge' | 'tired';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// Ground that's under water (counts ponds and floods)
const wet = (x: number, z: number, margin = 0.05) => calculateTerrainHeight(x, z) < getWaterLevel(x, z) - margin;

// How loud something at distance d is (sounds carry ~60 m)
const loudness = (d: number) => Math.max(0, 1 - d / 60);

// ---------------------------------------------------------------------
// Models. Local +Z is the way the animal faces; y = 0 is the centre of its physics ball.
// The leg groups pivot at the hip/shoulder so they can swing.
// ---------------------------------------------------------------------
interface Rig {
    root: React.RefObject<THREE.Group>;    // Whole model (rearing tilts this)
    body: React.RefObject<THREE.Group>;    // Bobs while running
    head: React.RefObject<THREE.Group>;
    tail: React.RefObject<THREE.Group>;
    legs: React.RefObject<THREE.Group>[];  // FL, FR, BL, BR
}

const useRig = (): Rig => ({
    root: useRef<THREE.Group>(null),
    body: useRef<THREE.Group>(null),
    head: useRef<THREE.Group>(null),
    tail: useRef<THREE.Group>(null),
    legs: [useRef<THREE.Group>(null), useRef<THREE.Group>(null), useRef<THREE.Group>(null), useRef<THREE.Group>(null)],
});

interface Mats { fur: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; light: THREE.MeshStandardMaterial; eye: THREE.MeshStandardMaterial; nose: THREE.MeshStandardMaterial }

const WolfModel = ({ rig, m }: { rig: Rig; m: Mats }) => (
    <group ref={rig.root}>
        <group ref={rig.body}>
            {/* Body, chest and a darker saddle along the back */}
            <mesh material={m.fur} position={[0, 0.08, -0.05]} scale={[0.27, 0.26, 0.58]} castShadow><sphereGeometry args={[1, 14, 10]} /></mesh>
            <mesh material={m.fur} position={[0, 0.12, 0.32]} scale={[0.3, 0.3, 0.32]} castShadow><sphereGeometry args={[1, 12, 10]} /></mesh>
            <mesh material={m.dark} position={[0, 0.28, -0.05]} scale={[0.17, 0.08, 0.5]}><sphereGeometry args={[1, 10, 8]} /></mesh>
            <mesh material={m.light} position={[0, -0.06, 0.3]} scale={[0.2, 0.15, 0.25]}><sphereGeometry args={[1, 10, 8]} /></mesh>
            {/* Head */}
            <group ref={rig.head} position={[0, 0.36, 0.62]}>
                <mesh material={m.fur} scale={[0.19, 0.17, 0.2]} castShadow><sphereGeometry args={[1, 12, 10]} /></mesh>
                <mesh material={m.light} position={[0, -0.05, 0.2]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.8]}><coneGeometry args={[0.09, 0.3, 8]} /></mesh>
                <mesh material={m.nose} position={[0, -0.03, 0.35]}><sphereGeometry args={[0.035, 8, 6]} /></mesh>
                <mesh material={m.dark} position={[0.09, 0.17, -0.03]} rotation={[0, 0, -0.2]}><coneGeometry args={[0.055, 0.17, 4]} /></mesh>
                <mesh material={m.dark} position={[-0.09, 0.17, -0.03]} rotation={[0, 0, 0.2]}><coneGeometry args={[0.055, 0.17, 4]} /></mesh>
                <mesh material={m.eye} position={[0.08, 0.05, 0.15]}><sphereGeometry args={[0.03, 8, 6]} /></mesh>
                <mesh material={m.eye} position={[-0.08, 0.05, 0.15]}><sphereGeometry args={[0.03, 8, 6]} /></mesh>
            </group>
            {/* Bushy tail */}
            <group ref={rig.tail} position={[0, 0.2, -0.58]} rotation={[-0.9, 0, 0]}>
                <mesh material={m.fur} position={[0, -0.22, 0]} scale={[0.09, 0.26, 0.09]}><sphereGeometry args={[1, 8, 8]} /></mesh>
                <mesh material={m.light} position={[0, -0.44, 0]} scale={[0.06, 0.08, 0.06]}><sphereGeometry args={[1, 6, 6]} /></mesh>
            </group>
        </group>
        {/* Legs: shoulder/hip pivots, reaching the ground (y = -0.5) */}
        {([[0.13, 0.36], [-0.13, 0.36], [0.13, -0.38], [-0.13, -0.38]] as const).map(([x, z], i) => (
            <group key={i} ref={rig.legs[i]} position={[x, 0.02, z]}>
                <mesh material={m.fur} position={[0, -0.22, 0]}><cylinderGeometry args={[0.055, 0.04, 0.46, 6]} /></mesh>
                <mesh material={m.dark} position={[0, -0.47, 0.03]} scale={[1, 0.6, 1.4]}><sphereGeometry args={[0.05, 6, 5]} /></mesh>
            </group>
        ))}
    </group>
);

const BearModel = ({ rig, m }: { rig: Rig; m: Mats }) => (
    <group ref={rig.root}>
        <group ref={rig.body}>
            {/* Big round body with a shoulder hump */}
            <mesh material={m.fur} position={[0, 0.05, -0.1]} scale={[0.58, 0.52, 0.85]} castShadow><sphereGeometry args={[1, 16, 12]} /></mesh>
            <mesh material={m.fur} position={[0, 0.3, 0.35]} scale={[0.5, 0.45, 0.45]} castShadow><sphereGeometry args={[1, 14, 10]} /></mesh>
            {/* Head */}
            <group ref={rig.head} position={[0, 0.38, 0.85]}>
                <mesh material={m.fur} scale={[0.3, 0.28, 0.3]} castShadow><sphereGeometry args={[1, 14, 10]} /></mesh>
                <mesh material={m.light} position={[0, -0.07, 0.27]} scale={[0.15, 0.12, 0.15]}><sphereGeometry args={[1, 10, 8]} /></mesh>
                <mesh material={m.nose} position={[0, -0.03, 0.41]}><sphereGeometry args={[0.055, 8, 6]} /></mesh>
                <mesh material={m.fur} position={[0.2, 0.24, -0.02]}><sphereGeometry args={[0.085, 8, 6]} /></mesh>
                <mesh material={m.fur} position={[-0.2, 0.24, -0.02]}><sphereGeometry args={[0.085, 8, 6]} /></mesh>
                <mesh material={m.eye} position={[0.12, 0.07, 0.24]}><sphereGeometry args={[0.035, 8, 6]} /></mesh>
                <mesh material={m.eye} position={[-0.12, 0.07, 0.24]}><sphereGeometry args={[0.035, 8, 6]} /></mesh>
            </group>
            {/* Stubby tail */}
            <group ref={rig.tail} position={[0, 0.25, -0.92]}>
                <mesh material={m.fur}><sphereGeometry args={[0.1, 8, 6]} /></mesh>
            </group>
        </group>
        {/* Thick legs, reaching the ground (y = -0.7) */}
        {([[0.3, 0.45], [-0.3, 0.45], [0.3, -0.55], [-0.3, -0.55]] as const).map(([x, z], i) => (
            <group key={i} ref={rig.legs[i]} position={[x, -0.15, z]}>
                <mesh material={m.fur} position={[0, -0.25, 0]}><cylinderGeometry args={[0.14, 0.12, 0.5, 8]} /></mesh>
                <mesh material={m.dark} position={[0, -0.52, 0.05]} scale={[1, 0.55, 1.3]}><sphereGeometry args={[0.13, 8, 6]} /></mesh>
            </group>
        ))}
    </group>
);

// ---------------------------------------------------------------------
export const MobRenderer = React.memo(({ data }: { data: MobData }) => {
    const type = data.type;
    const radius = RADIUS[type];
    const rig = useRig();
    const touchingRef = useRef(false);
    const livePos = useMemo(() => new THREE.Vector3(), []);
    const ai = useRef({
        mode: 'idle' as Mode,
        until: 0,               // s (clock time) the current mode ends
        circleDir: Math.random() < 0.5 ? 1 : -1,
        chargeX: 0, chargeZ: 0, // Locked-in direction (bear charge, wolf lunge)
        yaw: 0,
        speed: 0,               // Smoothed ground speed, for the legs
        stride: Math.random() * 10,
        rear: 0,                // 0..1 how far up on its hind legs (bear)
        lastHit: 0,
        hitsLeft: MOB_HITS_TO_CHASE[type],
        stunUntil: 0,
        flashUntil: 0,
        heardOf: false,         // Has howled/roared at first sight
        wetFor: 0,
        gone: false,
    });

    // Its own materials (so a hit flashes just this one)
    const mats = useMemo<Mats>(() => {
        const wolf = type === 'wolf';
        return {
            fur: new THREE.MeshStandardMaterial({ color: wolf ? '#7d8288' : '#5a3a22', roughness: 0.95 }),
            dark: new THREE.MeshStandardMaterial({ color: wolf ? '#43474c' : '#3a2414', roughness: 0.95 }),
            light: new THREE.MeshStandardMaterial({ color: wolf ? '#c9c4b8' : '#a07a55', roughness: 0.9 }),
            eye: new THREE.MeshStandardMaterial({ color: wolf ? '#ffd54a' : '#2b1a0d', emissive: wolf ? '#ffb300' : '#ff7a1a', emissiveIntensity: 0 }),
            nose: new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.4 }),
        };
    }, [type]);
    useEffect(() => () => Object.values(mats).forEach(m => m.dispose()), [mats]);

    const [ref, api] = useSphere(() => ({
        mass: 10,
        position: data.position,
        args: [radius],
        type: 'Dynamic',
        linearDamping: 0.5,
        fixedRotation: true,
        onCollide: (e) => {
            if (e.body && e.body.userData && (e.body.userData as any).tag === 'player') touchingRef.current = true;
        },
    }));

    const vy = useRef(0);
    useEffect(() => api.velocity.subscribe(v => { vy.current = v[1]; }), [api.velocity]);

    // Logs, the Log Shield, magpies and tail-slap waves find it here
    useEffect(() => {
        const mesh = ref.current as THREE.Object3D | null;
        if (!mesh) return;
        const takeHit = (stun: number) => {
            const a = ai.current;
            const now = Date.now();
            a.stunUntil = now + stun;
            a.flashUntil = now + 250;
            a.mode = 'approach'; // Whatever it was doing, it has to start again
            a.rear = 0;
            a.hitsLeft -= 1;
            if (a.hitsLeft <= 0 && !a.gone) {
                a.gone = true;
                const p = readBodyPosition(mesh, new THREE.Vector3());
                useGameStore.getState().defeatMob(data.id, [p.x, p.y, p.z]); // May drop magic here
            }
        };
        liveObjects.mobs.set(data.id, {
            object: mesh,
            type,
            hit: (dirX, dirZ) => {
                api.applyImpulse([dirX * MOB_HIT_KNOCKBACK, 25, dirZ * MOB_HIT_KNOCKBACK], [0, 0, 0]);
                takeHit(MOB_STUN_TIME);
            },
            shove: (dirX, dirZ, power) => {
                const k = SHOVE_KNOCKBACK * (0.4 + 0.6 * power) * (type === 'bear' ? 0.75 : 1);
                api.applyImpulse([dirX * k, 30 + 30 * power, dirZ * k], [0, 0, 0]);
                takeHit(SHOVE_STUN_TIME);
            },
        });
        return () => { liveObjects.mobs.delete(data.id); };
    }, [data.id, api, type]);

    useFrame((state, rawDelta) => {
        const mesh = ref.current as THREE.Object3D | null;
        if (!mesh) return;
        const s = useGameStore.getState();
        const a = ai.current;
        const t = state.clock.elapsedTime;
        const delta = Math.min(rawDelta, 0.1);

        // Eyes glow in the dark (wolves gold, bears ember)
        mats.eye.emissiveIntensity = isNightTime(s.timeOfDay) ? 1.6 : 0.1;
        const nowMs = Date.now();
        mats.fur.emissive.setHex(nowMs < a.flashUntil ? 0x991111 : 0x000000);

        if (s.isPaused || s.phase !== 'PLAYING') {
            api.velocity.set(0, vy.current, 0);
            touchingRef.current = false;
            return;
        }

        const pos = readBodyPosition(mesh, livePos); // Live physics position (not the spawn point)
        if (pos.y < -30) {
            s.removeMob(data.id);
            return;
        }

        // Swept away by deep water (a flood rose round it, a wave pushed it in)
        const depth = getWaterLevel(pos.x, pos.z) - calculateTerrainHeight(pos.x, pos.z);
        a.wetFor = depth > WASH_DEPTH ? a.wetFor + delta : 0;
        if (a.wetFor > WASH_TIME && !a.gone) {
            a.gone = true;
            fx.emit('splash', pos.x, getWaterLevel(pos.x, pos.z), pos.z, 22);
            audioService.playPlop(loudness(pos.distanceTo(currentWoodchuckPos)));
            s.defeatMob(data.id, [pos.x, pos.y, pos.z]);
            return;
        }

        const dx = currentWoodchuckPos.x - pos.x;
        const dz = currentWoodchuckPos.z - pos.z;
        const dist = Math.hypot(dx, dz);
        const toX = dist > 0.001 ? dx / dist : 0, toZ = dist > 0.001 ? dz / dist : 1;

        // Dazed: no moving, no biting (but the legs and pose still animate below)
        let vx = 0, vz = 0;
        let faceX = toX, faceZ = toZ;
        const stunned = nowMs < a.stunUntil;

        if (!stunned) {
            // Bite (collision or proximity), with a per-mob cooldown
            const touching = touchingRef.current || dist < MOB_HIT_RANGE[type];
            if (touching && nowMs - a.lastHit > MOB_HIT_COOLDOWN) {
                a.lastHit = nowMs;
                s.takeDamage(MOB_DAMAGE[type]);
                api.applyImpulse([-toX * MOB_KNOCKBACK, 0, -toZ * MOB_KNOCKBACK], [0, 0, 0]);
                if (a.mode === 'lunge' || a.mode === 'charge') a.until = t; // Got him: end the rush
            }

            if (dist > MOB_AGGRO_RANGE) {
                a.mode = 'idle';
            } else {
                if (!a.heardOf) {
                    a.heardOf = true;
                    if (type === 'wolf') audioService.playHowl(loudness(dist) * 0.9);
                }
                if (a.mode === 'idle') a.mode = 'approach';
                if (type === 'wolf') {
                    switch (a.mode) {
                        case 'approach':
                            vx = toX * WOLF.run; vz = toZ * WOLF.run;
                            if (dist < WOLF.circleFrom) { a.mode = 'circle'; a.until = t + rnd(WOLF.circleTime[0], WOLF.circleTime[1]); }
                            break;
                        case 'circle': {
                            // Around him, pulling in or out to keep its distance
                            const tx = -toZ * a.circleDir, tz = toX * a.circleDir;
                            const pull = THREE.MathUtils.clamp((dist - WOLF.circleRadius) * 0.8, -4, 4);
                            vx = tx * WOLF.circleSpeed + toX * pull;
                            vz = tz * WOLF.circleSpeed + toZ * pull;
                            faceX = vx; faceZ = vz;
                            if (dist > WOLF.circleFrom + 6) a.mode = 'approach';
                            if (t > a.until) { a.mode = 'lunge'; a.until = t + WOLF.lungeTime; a.chargeX = toX; a.chargeZ = toZ; }
                            break;
                        }
                        case 'lunge':
                            vx = a.chargeX * WOLF.lungeSpeed; vz = a.chargeZ * WOLF.lungeSpeed;
                            faceX = a.chargeX; faceZ = a.chargeZ;
                            if (t > a.until) { a.mode = 'retreat'; a.until = t + WOLF.retreatTime; }
                            break;
                        case 'retreat':
                            vx = -toX * WOLF.retreatSpeed; vz = -toZ * WOLF.retreatSpeed;
                            if (t > a.until) {
                                a.mode = 'circle';
                                a.until = t + rnd(WOLF.circleTime[0], WOLF.circleTime[1]);
                                if (Math.random() < 0.4) a.circleDir *= -1;
                            }
                            break;
                        default: a.mode = 'approach';
                    }
                } else {
                    switch (a.mode) {
                        case 'approach':
                            vx = toX * BEAR.walk; vz = toZ * BEAR.walk;
                            if (dist < BEAR.rearFrom) {
                                a.mode = 'rear';
                                a.until = t + BEAR.rearTime;
                                audioService.playRoar(loudness(dist));
                            }
                            break;
                        case 'rear':
                            // Up on its hind legs, turning to keep Chucky in sight
                            if (t > a.until) { a.mode = 'charge'; a.until = t + BEAR.chargeTime; a.chargeX = toX; a.chargeZ = toZ; }
                            break;
                        case 'charge':
                            vx = a.chargeX * BEAR.chargeSpeed; vz = a.chargeZ * BEAR.chargeSpeed;
                            faceX = a.chargeX; faceZ = a.chargeZ;
                            if (t > a.until) { a.mode = 'tired'; a.until = t + BEAR.tiredTime; }
                            break;
                        case 'tired':
                            if (t > a.until) a.mode = 'approach';
                            break;
                        default: a.mode = 'approach';
                    }
                }
            }

            // Land animals: never step into water. Circling wolves turn the other way; a rush stops.
            const sp = Math.hypot(vx, vz);
            if (sp > 0.1) {
                const look = 1.2 + sp * 0.12;
                if (wet(pos.x + (vx / sp) * look, pos.z + (vz / sp) * look)) {
                    if (a.mode === 'circle') a.circleDir *= -1;
                    if (a.mode === 'lunge' || a.mode === 'charge') a.until = t;
                    vx = 0; vz = 0;
                }
            }
        }
        touchingRef.current = false;
        if (!stunned) api.velocity.set(vx, vy.current, vz);

        // Face where it's going (smoothly)
        if (!stunned && (Math.abs(faceX) + Math.abs(faceZ) > 0.01)) {
            const want = Math.atan2(faceX, faceZ);
            let d = want - a.yaw;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            a.yaw += d * (1 - Math.exp(-(a.mode === 'circle' ? 6 : 10) * delta));
            api.rotation.set(0, a.yaw, 0);
        }

        // --- Animation ---
        const target = stunned ? 0 : Math.hypot(vx, vz);
        a.speed += (target - a.speed) * (1 - Math.exp(-8 * delta));
        const gait = type === 'wolf' ? 0.55 : 0.32;            // Strides per metre
        a.stride += a.speed * gait * delta * Math.PI * 2;
        const swing = Math.min(0.75, a.speed * (type === 'wolf' ? 0.07 : 0.06));
        const legs = rig.legs.map(l => l.current);
        // Diagonal pairs move together (a trot); a fast rush becomes a bound (front pair together)
        const bounding = a.mode === 'lunge' || a.mode === 'charge';
        const phases = bounding ? [0, 0, Math.PI, Math.PI] : [0, Math.PI, Math.PI, 0];
        legs.forEach((leg, i) => { if (leg) leg.rotation.x = Math.sin(a.stride + phases[i]) * swing; });
        if (rig.body.current) {
            rig.body.current.position.y = Math.abs(Math.sin(a.stride)) * swing * 0.12;
            // Stretch out in a lunge
            rig.body.current.rotation.x = bounding ? Math.sin(a.stride) * 0.08 : 0;
        }
        if (rig.tail.current) {
            rig.tail.current.rotation.z = Math.sin(t * (type === 'wolf' ? 9 : 4)) * (a.mode === 'circle' ? 0.35 : 0.12);
        }
        if (rig.head.current) {
            // Wolves lower their heads to stalk; tired bears pant
            const stalk = type === 'wolf' && (a.mode === 'circle' || a.mode === 'lunge') ? 0.25 : 0;
            const pant = a.mode === 'tired' ? Math.sin(t * 12) * 0.08 : 0;
            rig.head.current.rotation.x = stalk + pant;
        }
        // Bears rear up on their hind legs (pivoting on the back feet)
        if (type === 'bear' && rig.root.current) {
            const want = a.mode === 'rear' ? 1 : 0;
            a.rear += (want - a.rear) * (1 - Math.exp(-(want ? 7 : 5) * delta));
            const r = rig.root.current;
            const angle = -a.rear * 1.05;
            // Rotate about the hind feet (0, -0.7, -0.55)
            const py = -0.7, pz = -0.55;
            r.rotation.x = angle;
            r.position.set(0, py - (py * Math.cos(angle) - pz * Math.sin(angle)), pz - (py * Math.sin(angle) + pz * Math.cos(angle)));
            // Front paws paw at the air when up
            if (a.rear > 0.3) {
                legs[0] && (legs[0].rotation.x = -0.8 + Math.sin(t * 9) * 0.3);
                legs[1] && (legs[1].rotation.x = -0.8 + Math.sin(t * 9 + 1.5) * 0.3);
            }
        }
    });

    return (
        <group ref={ref as any}>
            {type === 'wolf' ? <WolfModel rig={rig} m={mats} /> : <BearModel rig={rig} m={mats} />}
        </group>
    );
});
