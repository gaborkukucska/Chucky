import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useGameStore, calculateTerrainHeight, MAP_SIZE } from '../store';
import { currentWoodchuckPos, liveObjects, playerState, readBodyPosition } from '../globals';
import { remotePlayers, TEAM_INFO, Team } from '../services/multiplayer';
import { rainbowTarget } from './Weather';
import { getWaterLevel, hydrology } from '../services/hydrology';
import { magpieNests } from './Magpies';

// =====================================================================
// Minimap (bottom right): the whole map, north up. The land is drawn once per world; trees,
// structures, animals, players and the rainbow treasure are redrawn a few times a second.
// Tap it to make it bigger.
// =====================================================================
const WATER_LEVEL = -1.5;
const BASE_RES = 150;          // Pixels across for the land picture (2 m per pixel)
const REDRAW_MS = 200;
const SIZE = { small: 96, big: 210 };

const half = MAP_SIZE / 2;

// The land: water by depth, grass by height, a little hill shading
const drawLand = (): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = c.height = BASE_RES;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(BASE_RES, BASE_RES);
    const m = MAP_SIZE / BASE_RES;
    for (let py = 0; py < BASE_RES; py++) {
        for (let px = 0; px < BASE_RES; px++) {
            const x = -half + (px + 0.5) * m;
            const z = -half + (py + 0.5) * m;
            const h = calculateTerrainHeight(x, z);
            const level = getWaterLevel(x, z); // Ponds and flooded meadows behind dams too
            let r: number, g: number, b: number;
            if (h < level) {
                const depth = Math.min(1, (level - h) / 4);
                r = 70 - 40 * depth; g = 150 - 50 * depth; b = 200 - 40 * depth;
                if (h >= WATER_LEVEL) { r += 25; g += 25; b -= 25; } // Wetland: shallow, greener water
            } else {
                const t = Math.max(0, Math.min(1, (h - WATER_LEVEL) / 14));
                // Hill shading from the north-west
                const slope = calculateTerrainHeight(x - m, z - m) - h;
                const shade = Math.max(-25, Math.min(25, slope * 12));
                r = 78 + 60 * t + shade; g = 128 + 40 * t + shade; b = 62 + 30 * t + shade;
                if (h < level + 0.35) { r = 190; g = 175; b = 120; } // Sandy bank
            }
            const i = (py * BASE_RES + px) * 4;
            img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return c;
};

const _mob = new THREE.Vector3();

export const Minimap = () => {
    const [big, setBig] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const landRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
    const worldSeedKey = useGameStore(state => `${state.worldSeed}-${state.terrainVersion}`);
    const size = big ? SIZE.big : SIZE.small;

    useEffect(() => {
        let raf = 0;
        let last = 0;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const draw = (now: number) => {
            raf = requestAnimationFrame(draw);
            if (now - last < REDRAW_MS) return;
            last = now;
            const canvas = canvasRef.current;
            if (!canvas) return;
            const px = Math.round(size * dpr);
            if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            // Redrawn when the world changes, or the river settles at a new height (dams)
            const worldKey = `${worldSeedKey}-${hydrology.wetlandVersion}`;
            if (!landRef.current || landRef.current.key !== worldKey) {
                landRef.current = { key: worldKey, canvas: drawLand() };
            }
            const s = useGameStore.getState();
            const k = px / MAP_SIZE;
            const X = (x: number) => (x + half) * k;
            const Z = (z: number) => (z + half) * k;
            const dot = (x: number, z: number, r: number, fill: string, stroke?: string) => {
                ctx.beginPath();
                ctx.arc(X(x), Z(z), r * dpr, 0, Math.PI * 2);
                ctx.fillStyle = fill;
                ctx.fill();
                if (stroke) { ctx.lineWidth = 1.2 * dpr; ctx.strokeStyle = stroke; ctx.stroke(); }
            };

            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(landRef.current.canvas, 0, 0, px, px);

            // Night: darker
            const night = s.timeOfDay > 0.5 ? Math.sin((s.timeOfDay - 0.5) * Math.PI * 2) : 0;
            if (night > 0) {
                ctx.fillStyle = `rgba(8, 14, 35, ${0.45 * night})`;
                ctx.fillRect(0, 0, px, px);
            }

            // Standing trees
            ctx.fillStyle = 'rgba(20, 70, 30, 0.85)';
            const tr = (big ? 1.3 : 0.9) * dpr;
            for (const t of s.trees) {
                if (t.isFelled) continue;
                ctx.fillRect(X(t.position[0]) - tr / 2, Z(t.position[2]) - tr / 2, tr, tr);
            }

            // Structures (yours and your team's brown, rivals' grey)
            for (const st of s.placedStructures) {
                const mine = !st.ownerId || st.ownerId === s.mp.myId || (st.team && st.team !== 'solo' && st.team === s.mp.team);
                const r = (big ? 3.2 : 2.4) * dpr;
                ctx.fillStyle = mine ? '#8b5a2b' : '#6b7280';
                ctx.strokeStyle = '#f5deb3';
                ctx.lineWidth = 1 * dpr;
                ctx.fillRect(X(st.position[0]) - r, Z(st.position[2]) - r, r * 2, r * 2);
                ctx.strokeRect(X(st.position[0]) - r, Z(st.position[2]) - r, r * 2, r * 2);
            }

            // Magpie nests: a white ring with a black middle
            for (const n of magpieNests()) dot(n.x, n.z, big ? 3.4 : 2.6, '#111827', '#ffffff');

            // Magic items, wolves and bears
            for (const m of s.magicItems) dot(m.position[0], m.position[2], big ? 3 : 2.2, '#c084fc', '#ffffff');
            for (const mob of liveObjects.mobs.values()) {
                const p = readBodyPosition(mob.object, _mob);
                dot(p.x, p.z, big ? 3 : 2.3, '#dc2626', '#fee2e2');
            }

            // Rainbow treasure: a pulsing gold star
            if (rainbowTarget.active) {
                const pulse = 1 + 0.25 * Math.sin(now / 180);
                const r = (big ? 6 : 4.5) * dpr * pulse;
                const cx = X(rainbowTarget.x), cy = Z(rainbowTarget.z);
                ctx.beginPath();
                for (let i = 0; i < 10; i++) {
                    const a = -Math.PI / 2 + (i * Math.PI) / 5;
                    const rr = i % 2 === 0 ? r : r * 0.45;
                    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
                }
                ctx.closePath();
                ctx.fillStyle = '#facc15';
                ctx.fill();
                ctx.lineWidth = 1.2 * dpr;
                ctx.strokeStyle = '#7c2d12';
                ctx.stroke();
            }

            // Other players (joint games), in their team colours
            for (const [id, entry] of remotePlayers) {
                const last = entry.samples[entry.samples.length - 1];
                if (!last) continue;
                const team = (s.mp.players[id]?.team ?? 'solo') as Team;
                dot(last.p[0], last.p[2], big ? 3.6 : 2.8, TEAM_INFO[team]?.color ?? '#e5e7eb', '#111827');
            }

            // Chucky: an arrow pointing the way he faces
            const p = currentWoodchuckPos;
            if (p.x !== 0 || p.z !== 0) {
                const f = playerState.facing;
                const dx = Math.sin(f), dz = Math.cos(f);
                const cx = X(p.x), cy = Z(p.z);
                const L = (big ? 8 : 6) * dpr, W = L * 0.6;
                ctx.beginPath();
                ctx.moveTo(cx + dx * L, cy + dz * L);
                ctx.lineTo(cx - dx * L * 0.6 + dz * W, cy - dz * L * 0.6 - dx * W);
                ctx.lineTo(cx - dx * L * 0.25, cy - dz * L * 0.25);
                ctx.lineTo(cx - dx * L * 0.6 - dz * W, cy - dz * L * 0.6 + dx * W);
                ctx.closePath();
                ctx.fillStyle = s.mp.status === 'playing' ? (TEAM_INFO[s.mp.team]?.color ?? '#f59e0b') : '#f59e0b';
                ctx.fill();
                ctx.lineWidth = 1.5 * dpr;
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();
            }
        };
        raf = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(raf);
    }, [size, big, worldSeedKey]);

    return (
        <button
            className="absolute bottom-3 right-12 z-40 rounded-xl overflow-hidden border-2 border-white/40 shadow-xl pointer-events-auto bg-black/40 transition-all duration-200 active:scale-95"
            style={{ width: size, height: size }}
            onClick={() => setBig(b => !b)}
            onMouseDown={e => e.preventDefault()} // Don't take keyboard focus (Space would click it)
            tabIndex={-1}
            aria-label={big ? 'Make the map smaller' : 'Make the map bigger'}
        >
            <canvas ref={canvasRef} style={{ width: size, height: size, display: 'block' }} />
            <span className="absolute top-0.5 left-1 text-[8px] font-black text-white/80 drop-shadow pointer-events-none">N ↑</span>
        </button>
    );
};
