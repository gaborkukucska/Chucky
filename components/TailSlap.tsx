import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, calculateTerrainHeight } from '../store';
import { audioService } from '../services/audio';
import { getWaterLevel } from '../services/hydrology';
import { abilityEvents, fx, liveObjects, readBodyPosition } from '../globals';

// =====================================================================
// Tail Slap (E / 💦): beavers really do slap their tails on the water - here it sends a wave
// rolling out from Chucky that washes wolves, bears and the piranha away. Bigger when he's
// swimming than when he slaps the water from the bank. store.tailSlap() checks he's at the
// water and starts the cooldown; this draws the wave and does the washing.
// =====================================================================
const WAVE_RADIUS = { swimming: 15, bank: 9 };   // m the wave reaches
const waveTiming = { speed: 12 };                 // m/s outwards (dev play-tests slow it down to see it)
const CREST_HEIGHT = 0.9;                         // m - the wall of water at the wave's front
const MAX_WAVES = 3;

interface Wave { x: number; y: number; z: number; start: number; reach: number; hit: Set<string>; lastSplash: number }

const _p = new THREE.Vector3();

export const TailSlap = () => {
    const waves = useRef<Wave[]>([]);
    const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
    const innerRefs = useRef<(THREE.Mesh | null)[]>([]);
    const material = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }), []);
    const innerMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: '#dff6ff', transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }), []);

    useFrame((state) => {
        const t = state.clock.elapsedTime;
        const s = useGameStore.getState();

        // New slaps
        for (let i = abilityEvents.queue.length - 1; i >= 0; i--) {
            const e = abilityEvents.queue[i];
            if (e.kind !== 'slap') continue;
            abilityEvents.queue.splice(i, 1);
            const level = getWaterLevel(e.x, e.z);
            const swimming = calculateTerrainHeight(e.x, e.z) < level;
            if (waves.current.length >= MAX_WAVES) waves.current.shift();
            waves.current.push({ x: e.x, y: level, z: e.z, start: t, reach: swimming ? WAVE_RADIUS.swimming : WAVE_RADIUS.bank, hit: new Set(), lastSplash: 0 });
            fx.emit('splash', e.x, level, e.z, 30);
            audioService.playTailSlap();
        }

        if (import.meta.env.DEV) (window as any).__chuckyWaves = { waveTiming };
        // Grow the waves; wash away whatever they reach
        waves.current = waves.current.filter(w => (t - w.start) * waveTiming.speed < w.reach + 2);
        for (let i = 0; i < MAX_WAVES; i++) {
            const w = waves.current[i];
            const ring = ringRefs.current[i], inner = innerRefs.current[i];
            if (!w) {
                if (ring) ring.visible = false;
                if (inner) inner.visible = false;
                continue;
            }
            const r = Math.max(0.5, (t - w.start) * waveTiming.speed);
            const fade = Math.max(0, 1 - r / (w.reach + 2));
            if (ring) {
                ring.visible = true;
                ring.position.set(w.x, w.y + 0.08, w.z);
                ring.scale.setScalar(r);
            }
            if (inner) {
                // The crest: a low wall of water, shrinking as the wave spreads out
                inner.visible = true;
                inner.position.set(w.x, w.y, w.z);
                inner.scale.set(r, 0.3 + fade * 0.7, r);
            }
            // (The waves share their materials: the newest one sets how see-through they are)
            material.opacity = 0.95 * fade;
            innerMaterial.opacity = 0.75 * fade;

            // Spray along the crest
            if (t - w.lastSplash > 0.06 && r < w.reach) {
                w.lastSplash = t;
                for (let k = 0; k < 6; k++) {
                    const a = Math.random() * Math.PI * 2;
                    const x = w.x + Math.cos(a) * r, z = w.z + Math.sin(a) * r;
                    fx.emit('splash', x, Math.max(getWaterLevel(x, z), calculateTerrainHeight(x, z)), z, 3);
                }
            }

            if (s.isPaused) continue;
            for (const [id, mob] of liveObjects.mobs) {
                if (w.hit.has(id)) continue;
                const p = readBodyPosition(mob.object, _p);
                const d = Math.hypot(p.x - w.x, p.z - w.z);
                if (d > r || d > w.reach) continue;
                w.hit.add(id);
                const dirX = d > 0.01 ? (p.x - w.x) / d : 1, dirZ = d > 0.01 ? (p.z - w.z) / d : 0;
                mob.shove(dirX, dirZ, 1 - (d / w.reach) * 0.5);
                fx.emit('splash', p.x, p.y, p.z, 14);
                if (mob.type !== 'piranha') s.addTally('slapHits');
            }
        }
    });

    return (
        <>
            {Array.from({ length: MAX_WAVES }, (_, i) => (
                <group key={i}>
                    <mesh ref={el => { ringRefs.current[i] = el; }} rotation={[-Math.PI / 2, 0, 0]} material={material} visible={false} frustumCulled={false}>
                        <ringGeometry args={[0.86, 1, 48]} />
                    </mesh>
                    <mesh ref={el => { innerRefs.current[i] = el; }} material={innerMaterial} visible={false} frustumCulled={false}>
                        <cylinderGeometry args={[1, 1.04, CREST_HEIGHT, 48, 1, true]} />
                    </mesh>
                </group>
            ))}
        </>
    );
};
