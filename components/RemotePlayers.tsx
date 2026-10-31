// Joint games in the 3D scene: the other players' Chuckies (team scarf + name tag)
// and the per-frame sync with the server (our position, moved logs, the clock).

import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../store';
import { currentWoodchuckPos, playerState } from '../globals';
import { multiplayer, remotePlayers, TEAM_INFO, Team, RemoteSample } from '../services/multiplayer';

const WATER_LEVEL = -1.5;
const INTERP_DELAY_MS = 120;   // Render others slightly in the past so movement is smooth between updates
const MAX_EXTRAPOLATE_MS = 300;

// =====================================================================
// Name tag: a camera-facing sprite drawn from a canvas
// =====================================================================
const makeNameTexture = (name: string, color: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.font = 'bold 30px system-ui, sans-serif';
        const w = Math.min(240, ctx.measureText(name).width + 36);
        const x = (256 - w) / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, 10, w, 44, 22);
        else ctx.rect(x, 10, w, 44);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x + 20, 32, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, x + 34, 33, w - 42);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
};

// =====================================================================
// One remote Chucky
// =====================================================================
const lerpAngle = (a: number, b: number, t: number) => {
    let d = b - a;
    while (d < -Math.PI) d += Math.PI * 2;
    while (d > Math.PI) d -= Math.PI * 2;
    return a + d * t;
};

const RemoteChucky = React.memo(({ id, name, team }: { id: string; name: string; team: Team }) => {
    const rootRef = useRef<THREE.Group>(null);
    const bodyRef = useRef<THREE.Group>(null);
    const headRef = useRef<THREE.Group>(null);
    const color = TEAM_INFO[team]?.color ?? '#e5e7eb';
    const texture = useMemo(() => makeNameTexture(name, color), [name, color]);
    useEffect(() => () => texture.dispose(), [texture]);

    useFrame((state, delta) => {
        const entry = remotePlayers.get(id);
        const root = rootRef.current;
        if (!entry || !root || entry.samples.length === 0) {
            if (root) root.visible = false;
            return;
        }
        root.visible = true;

        // Interpolate between the two samples around (now - delay)
        const renderT = Date.now() - INTERP_DELAY_MS;
        const s = entry.samples;
        let a: RemoteSample = s[0];
        let b: RemoteSample = s[s.length - 1];
        for (let i = s.length - 1; i > 0; i--) {
            if (s[i - 1].t <= renderT) {
                a = s[i - 1];
                b = s[i];
                break;
            }
        }
        let k = b.t > a.t ? (renderT - a.t) / (b.t - a.t) : 1;
        k = Math.max(0, Math.min(1 + MAX_EXTRAPOLATE_MS / Math.max(1, b.t - a.t), k));
        const kc = Math.min(1, k);
        root.position.set(
            a.p[0] + (b.p[0] - a.p[0]) * k,
            a.p[1] + (b.p[1] - a.p[1]) * kc,
            a.p[2] + (b.p[2] - a.p[2]) * k
        );
        root.rotation.y = lerpAngle(a.f, b.f, kc);

        // Pose: swimming (belly down), knocked out (on its side), chomping (head nod)
        const cur = k < 0.5 ? a : b;
        const smooth = 1 - Math.exp(-10 * delta);
        if (bodyRef.current) {
            const swim = cur.sw && !cur.ko;
            bodyRef.current.position.y += ((swim ? 0 : 0.4) - bodyRef.current.position.y) * smooth;
            const pitch = swim ? Math.PI / 2 + (cur.dv ? 0.45 : 0) : 0;
            bodyRef.current.rotation.x += (pitch - bodyRef.current.rotation.x) * smooth;
            const roll = cur.ko ? Math.PI / 2 : 0;
            bodyRef.current.rotation.z += (roll - bodyRef.current.rotation.z) * smooth;
        }
        if (headRef.current) {
            headRef.current.rotation.x = cur.ch && !cur.ko ? Math.sin(state.clock.elapsedTime * 30) * 0.3 : 0;
        }
    });

    return (
        <group ref={rootRef} visible={false}>
            <group ref={bodyRef} position={[0, 0.4, 0]}>
                <mesh castShadow>
                    <capsuleGeometry args={[0.5, 1, 4, 8]} />
                    <meshStandardMaterial color="#795548" />
                </mesh>
                {/* Team scarf */}
                <mesh position={[0, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
                    <torusGeometry args={[0.42, 0.09, 8, 20]} />
                    <meshStandardMaterial color={color} />
                </mesh>
                <group ref={headRef} position={[0, 0.6, 0]}>
                    <mesh position={[0, 0.2, 0]} castShadow>
                        <sphereGeometry args={[0.4, 16, 16]} />
                        <meshStandardMaterial color="#5D4037" />
                    </mesh>
                    <mesh position={[0.15, 0.3, 0.3]}>
                        <sphereGeometry args={[0.08, 8, 8]} />
                        <meshStandardMaterial color="black" />
                    </mesh>
                    <mesh position={[-0.15, 0.3, 0.3]}>
                        <sphereGeometry args={[0.08, 8, 8]} />
                        <meshStandardMaterial color="black" />
                    </mesh>
                    <mesh position={[0, 0.1, 0.35]}>
                        <boxGeometry args={[0.2, 0.15, 0.05]} />
                        <meshStandardMaterial color="white" />
                    </mesh>
                </group>
                <mesh position={[0, -0.3, -0.5]} rotation={[-Math.PI / 4, 0, 0]} castShadow>
                    <capsuleGeometry args={[0.15, 0.6, 4, 8]} />
                    <meshStandardMaterial color="#4E342E" />
                </mesh>
            </group>
            <sprite position={[0, 2.6, 0]} scale={[2.4, 0.6, 1]} renderOrder={20}>
                <spriteMaterial map={texture} transparent depthWrite={false} />
            </sprite>
        </group>
    );
});

// =====================================================================
// All remote players + the per-frame network tick
// =====================================================================
export const RemotePlayers = () => {
    const players = useGameStore(state => state.mp.players);
    const status = useGameStore(state => state.mp.status);
    if (status !== 'playing') return null;
    return (
        <>
            {Object.values(players).map(p => (
                <RemoteChucky key={p.id} id={p.id} name={p.name} team={p.team} />
            ))}
        </>
    );
};

export const MultiplayerSync = () => {
    useFrame(() => {
        const s = useGameStore.getState();
        if (s.mp.status !== 'playing') return;
        const p = currentWoodchuckPos;
        multiplayer.tick(Date.now(), {
            p: [p.x, p.y, p.z],
            f: playerState.facing,
            sw: s.isInWater,
            dv: s.isInWater && p.y < WATER_LEVEL - 0.2,
            ch: s.activeTreeId !== null,
            ko: s.koUntil > Date.now(),
            s: Math.floor(s.score),
            w: s.woodCount,
        });
    });
    return null;
};
