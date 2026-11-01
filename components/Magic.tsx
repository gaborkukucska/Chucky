// Magic and river monsters:
//   - Piranhas: one lurks in the river (another turns up a few minutes after it's chased
//     off). They bite when you're in the water; two log hits chase one off.
//   - Magic items dropped by chased-off wolves, bears and piranhas (see MAGIC_INFO in store.ts)
//   - Log Shield: logs orbiting Chucky that bonk animals and rival players
// Like wolves and bears, piranhas and magic items are per player in joint games; a rival's
// Log Shield hurts you (each player checks their own Chucky, as with thrown logs).

import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, calculateTerrainHeight, getRiverX, getRiverWidth, MAGIC_INFO, MAGIC_ITEM_LIFETIME } from '../store';
import { currentWoodchuckPos, liveObjects, readBodyPosition } from '../globals';
import { remotePlayers } from '../services/multiplayer';
import { audioService } from '../services/audio';
import { MagicItemData, MagicType, PiranhaData } from '../types';

const WATER_LEVEL = -1.5;
const MAP_LIMIT = 140;

// --- Piranhas ---
const PIRANHA_HITS = 2;              // Log hits to chase one off
const PIRANHA_WANDER_SPEED = 2.5;    // m/s
const PIRANHA_CHASE_SPEED = 6;       // m/s - Chucky swims at 7 (faster with Zoomies)
const PIRANHA_CHASE_RANGE = 22;      // m - only chases Chucky while he's in the water
const PIRANHA_BITE_RANGE = 1.4;
const PIRANHA_BITE_COOLDOWN = 1100;  // ms
const PIRANHA_STUN_TIME = 1500;      // ms dazed after a log hit
const PIRANHA_MIN_DEPTH = 0.6;       // m of water it needs under the surface (it never leaves the river)
const PIRANHA_CRUISE_DEPTH = 0.5;    // m under the surface: just deep enough for its fin to poke out

// --- Magic items ---
const MAGIC_PICKUP_RADIUS = 1.6;
const MAGIC_BLINK_MS = 10000;        // Blinks for the last 10 s before it vanishes

// --- Log Shield ---
const SHIELD_LOGS = 6;
const SHIELD_RADIUS = 2.2;           // m from Chucky
const SHIELD_SPIN = 3;               // rad/s
const SHIELD_HIT_RADIUS = 0.9;       // m from one orbiting log to a target
const SHIELD_HIT_COOLDOWN = 700;     // ms per target
const SHIELD_PLAYER_DAMAGE = 10;
const SHIELD_PLAYER_BAND: [number, number] = [SHIELD_RADIUS - 1.0, SHIELD_RADIUS + 1.0];
const SHIELD_PLAYER_COOLDOWN = 1000;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Deep enough for a piranha? (Chucky counts as in the water wherever the ground is below it) */
const isSwimmable = (x: number, z: number) =>
    Math.abs(z) <= MAP_LIMIT && calculateTerrainHeight(x, z) < WATER_LEVEL - PIRANHA_MIN_DEPTH;

/** Move a piranha by (dx, dz) without leaving the water: slides along the bank if it can */
const swimBy = (p: THREE.Vector3, dx: number, dz: number) => {
    if (isSwimmable(p.x + dx, p.z + dz)) {
        p.x += dx;
        p.z += dz;
    } else if (isSwimmable(p.x, p.z + dz)) {
        p.z += dz;
    } else if (isSwimmable(p.x + dx, p.z)) {
        p.x += dx;
    }
};

// =====================================================================
// Piranha
// =====================================================================
const PiranhaFish = React.memo(({ data }: { data: PiranhaData }) => {
    const groupRef = useRef<THREE.Group>(null);
    const tailRef = useRef<THREE.Group>(null);
    const bodyMatRef = useRef<THREE.MeshStandardMaterial>(null);
    const sim = useRef({
        pos: new THREE.Vector3(data.position[0], data.position[1], data.position[2]),
        target: new THREE.Vector3(data.position[0], data.position[1], data.position[2]),
        nextWander: 0,
        hitsLeft: PIRANHA_HITS,
        stunUntil: 0,
        flashUntil: 0,
        lastBite: 0,
        heading: 0,
    });

    // Thrown logs and the Log Shield check this registry (same as wolves/bears)
    useEffect(() => {
        const group = groupRef.current;
        if (!group) return;
        liveObjects.mobs.set(data.id, {
            object: group,
            hit: (dirX: number, dirZ: number) => {
                const st = sim.current;
                const now = Date.now();
                st.stunUntil = now + PIRANHA_STUN_TIME;
                st.flashUntil = now + 250;
                swimBy(st.pos, dirX * 1.5, dirZ * 1.5);
                st.hitsLeft -= 1;
                if (st.hitsLeft <= 0) useGameStore.getState().defeatPiranha(data.id, [st.pos.x, st.pos.y, st.pos.z]);
            },
        });
        return () => { liveObjects.mobs.delete(data.id); };
    }, [data.id]);

    useFrame((state, rawDelta) => {
        const group = groupRef.current;
        if (!group) return;
        const st = sim.current;
        const s = useGameStore.getState();
        const now = Date.now();
        const time = state.clock.elapsedTime;
        if (bodyMatRef.current) bodyMatRef.current.emissive.setHex(now < st.flashUntil ? 0x991111 : 0x000000);

        if (!s.isPaused && s.phase === 'PLAYING') {
            const delta = Math.min(rawDelta, 0.1);
            const me = currentWoodchuckPos;
            const dist = st.pos.distanceTo(me);
            const chasing = s.isInWater && dist < PIRANHA_CHASE_RANGE && now >= st.stunUntil;

            if (now < st.stunUntil) {
                // Dazed: drift, don't bite
            } else if (chasing) {
                st.target.copy(me);
                if (dist < PIRANHA_BITE_RANGE && now - st.lastBite > PIRANHA_BITE_COOLDOWN) {
                    st.lastBite = now;
                    s.piranhaBite();
                    audioService.playHit();
                }
            } else if (now >= st.nextWander || st.pos.distanceTo(st.target) < 1) {
                // Wander up and down the river
                st.nextWander = now + 3000 + Math.random() * 3000;
                const z = clamp(st.pos.z + (Math.random() - 0.5) * 50, -MAP_LIMIT, MAP_LIMIT);
                st.target.set(getRiverX(z) + (Math.random() - 0.5) * getRiverWidth(z), WATER_LEVEL - PIRANHA_CRUISE_DEPTH, z);
            }

            if (now >= st.stunUntil) {
                const speed = chasing ? PIRANHA_CHASE_SPEED : PIRANHA_WANDER_SPEED;
                const dx = st.target.x - st.pos.x;
                const dz = st.target.z - st.pos.z;
                const flat = Math.hypot(dx, dz);
                const stopAt = chasing ? 0.8 : 0.05; // Snaps at Chucky from just in front, not inside him
                if (flat > stopAt) {
                    const step = Math.min(flat - stopAt, speed * delta);
                    swimBy(st.pos, (dx / flat) * step, (dz / flat) * step);
                    st.heading = Math.atan2(dx, dz);
                }
            }

            // Depth: under the surface, above the bed; follows Chucky's depth when chasing
            const bed = calculateTerrainHeight(st.pos.x, st.pos.z);
            const wantY = chasing ? me.y : WATER_LEVEL - PIRANHA_CRUISE_DEPTH;
            const targetY = clamp(wantY, bed + 0.4, WATER_LEVEL - 0.3);
            st.pos.y += (targetY - st.pos.y) * (1 - Math.exp(-3 * delta));
        }

        group.position.copy(st.pos);
        group.rotation.y = st.heading;
        if (tailRef.current) tailRef.current.rotation.y = Math.sin(time * 14) * 0.5;
    });

    return (
        <group ref={groupRef} position={data.position}>
            {/* Body */}
            <mesh scale={[0.35, 0.55, 0.75]} castShadow>
                <sphereGeometry args={[0.6, 14, 10]} />
                <meshStandardMaterial ref={bodyMatRef} color="#6B7280" metalness={0.4} roughness={0.4} />
            </mesh>
            {/* Red belly */}
            <mesh position={[0, -0.12, 0.05]} scale={[0.3, 0.38, 0.6]}>
                <sphereGeometry args={[0.6, 12, 8]} />
                <meshStandardMaterial color="#DC2626" />
            </mesh>
            {/* Eyes */}
            <mesh position={[0.13, 0.1, 0.32]}>
                <sphereGeometry args={[0.06, 8, 6]} />
                <meshBasicMaterial color="#FF3B30" />
            </mesh>
            <mesh position={[-0.13, 0.1, 0.32]}>
                <sphereGeometry args={[0.06, 8, 6]} />
                <meshBasicMaterial color="#FF3B30" />
            </mesh>
            {/* Teeth */}
            <mesh position={[0, -0.05, 0.43]}>
                <boxGeometry args={[0.16, 0.05, 0.04]} />
                <meshStandardMaterial color="white" />
            </mesh>
            {/* Dorsal fin: pokes out of the water so you can see it coming */}
            <mesh position={[0, 0.45, -0.05]} rotation={[0, Math.PI / 2, 0]} scale={[1, 1, 0.12]}>
                <coneGeometry args={[0.28, 0.6, 4]} />
                <meshStandardMaterial color="#7F1D1D" />
            </mesh>
            {/* Tail fin (wiggles) */}
            <group ref={tailRef} position={[0, 0, -0.45]}>
                <mesh position={[0, 0, -0.15]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.25, 1, 1]}>
                    <coneGeometry args={[0.32, 0.4, 3]} />
                    <meshStandardMaterial color="#4B5563" />
                </mesh>
            </group>
        </group>
    );
});

export const Piranhas = () => {
    const piranhas = useGameStore(state => state.piranhas);
    return (
        <>
            {piranhas.map(p => <PiranhaFish key={p.id} data={p} />)}
        </>
    );
};

// =====================================================================
// Magic items: a floating, spinning icon with a glowing ring
// =====================================================================
const iconTextures = new Map<MagicType, THREE.CanvasTexture>();
const iconTexture = (type: MagicType) => {
    let tex = iconTextures.get(type);
    if (tex) return tex;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 62);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(64, 64, 62, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '72px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(MAGIC_INFO[type].icon, 64, 70);
    }
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    iconTextures.set(type, tex);
    return tex;
};

const MagicItem = React.memo(({ data }: { data: MagicItemData }) => {
    const groupRef = useRef<THREE.Group>(null);
    const ringRef = useRef<THREE.Mesh>(null);
    const takenRef = useRef(false);
    const texture = useMemo(() => iconTexture(data.type), [data.type]);
    const info = MAGIC_INFO[data.type];
    const lifetime = MAGIC_ITEM_LIFETIME;

    useFrame((state) => {
        const group = groupRef.current;
        if (!group || takenRef.current) return;
        const s = useGameStore.getState();
        const now = Date.now();
        const age = now - data.createdAt;
        const t = state.clock.elapsedTime;
        group.position.set(data.position[0], data.position[1] + 0.8 + Math.sin(t * 2.5) * 0.2, data.position[2]);
        if (ringRef.current) ringRef.current.rotation.z = t * 1.5;
        group.visible = age < lifetime - MAGIC_BLINK_MS || Math.floor(age / 200) % 2 === 0;
        if (s.isPaused || s.phase !== 'PLAYING') return;
        if (age > lifetime) {
            takenRef.current = true;
            s.expireMagic(data.id);
            return;
        }
        const me = currentWoodchuckPos;
        if (Math.hypot(me.x - data.position[0], me.z - data.position[2]) < MAGIC_PICKUP_RADIUS && Math.abs(me.y - data.position[1]) < 3) {
            takenRef.current = true;
            s.collectMagic(data.id);
        }
    });

    return (
        <group ref={groupRef} position={data.position}>
            <sprite scale={[1.1, 1.1, 1]} renderOrder={12}>
                <spriteMaterial map={texture} transparent depthWrite={false} />
            </sprite>
            <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.75, 0.06, 8, 32]} />
                <meshBasicMaterial color={info.color} transparent opacity={0.85} />
            </mesh>
            <pointLight color={info.color} intensity={1.5} distance={6} decay={2} />
        </group>
    );
});

export const MagicItems = () => {
    const items = useGameStore(state => state.magicItems);
    return (
        <>
            {items.map(item => <MagicItem key={item.id} data={item} />)}
        </>
    );
};

// =====================================================================
// Log Shield: logs orbiting Chucky; hits wolves, bears, piranhas.
// Also checks rivals' shields against our own Chucky (joint games).
// =====================================================================
const ShieldLogs = ({ groupRef }: { groupRef: React.RefObject<THREE.Group | null> }) => (
    <group ref={groupRef}>
        {Array.from({ length: SHIELD_LOGS }).map((_, i) => {
            const a = (i / SHIELD_LOGS) * Math.PI * 2;
            return (
                // 'YXZ': tip the log flat along +Z, then turn it to angle a, so one end points at Chucky
                <mesh key={i} position={[Math.sin(a) * SHIELD_RADIUS, 0, Math.cos(a) * SHIELD_RADIUS]} rotation={[Math.PI / 2, a, 0, 'YXZ']} castShadow>
                    <cylinderGeometry args={[0.15, 0.15, 1.1, 8]} />
                    <meshStandardMaterial color="#8D6E63" emissive="#F59E0B" emissiveIntensity={0.35} />
                </mesh>
            );
        })}
    </group>
);

export { ShieldLogs, SHIELD_SPIN };

export const LogShield = () => {
    const groupRef = useRef<THREE.Group>(null);
    const lastHit = useRef(new Map<string, number>());
    const tmp = useMemo(() => ({ log: new THREE.Vector3(), target: new THREE.Vector3() }), []);

    useFrame((state) => {
        const group = groupRef.current;
        if (!group) return;
        const s = useGameStore.getState();
        const now = Date.now();
        const active = s.magic.shield > now && s.phase === 'PLAYING' && s.koUntil === 0;
        group.visible = active;
        const me = currentWoodchuckPos;

        // A rival's shield hitting us (each player checks their own Chucky)
        if (s.mp.status === 'playing' && s.phase === 'PLAYING' && s.koUntil === 0) {
            for (const [id, entry] of remotePlayers) {
                const last = entry.samples[entry.samples.length - 1];
                if (!last || !last.sh || last.ko) continue;
                const rival = s.mp.players[id];
                if (!rival || (s.mp.team !== 'solo' && rival.team === s.mp.team)) continue;
                const dx = me.x - last.p[0];
                const dz = me.z - last.p[2];
                const d = Math.hypot(dx, dz);
                if (d < SHIELD_PLAYER_BAND[0] || d > SHIELD_PLAYER_BAND[1] || Math.abs(me.y - last.p[1]) > 2) continue;
                const key = `p:${id}`;
                if (now - (lastHit.current.get(key) ?? 0) < SHIELD_PLAYER_COOLDOWN) continue;
                lastHit.current.set(key, now);
                s.takeThrowHit(id, dx / (d || 1), dz / (d || 1), SHIELD_PLAYER_DAMAGE);
                audioService.playHit();
            }
        }

        if (!active) return;
        group.position.set(me.x, me.y + 0.3, me.z);
        group.rotation.y = state.clock.elapsedTime * SHIELD_SPIN;
        if (s.isPaused) return;

        // Our orbiting logs hitting wolves, bears and piranhas
        for (const child of group.children) {
            child.getWorldPosition(tmp.log);
            for (const [id, mob] of liveObjects.mobs) {
                const p = readBodyPosition(mob.object, tmp.target);
                if (p.distanceTo(tmp.log) > SHIELD_HIT_RADIUS + 0.5) continue;
                if (now - (lastHit.current.get(id) ?? 0) < SHIELD_HIT_COOLDOWN) continue;
                lastHit.current.set(id, now);
                const dx = p.x - me.x;
                const dz = p.z - me.z;
                const d = Math.hypot(dx, dz) || 1;
                mob.hit(dx / d, dz / d);
                audioService.playHit();
            }
        }
    });

    return <ShieldLogs groupRef={groupRef} />;
};
