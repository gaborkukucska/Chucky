import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, calculateTerrainHeight, getRiverX, getRiverWidth } from '../store';
import { audioService } from '../services/audio';
import { currentWoodchuckPos, fx, FxKind } from '../globals';
import { liveWeather } from './Weather';
import { GraphicsQuality } from '../types';

const WATER_LEVEL = -1.5;
const MAX_FRAME_DELTA = 0.1;

// =====================================================================
// Particles: one instanced mesh of little cubes for every burst in the game (wood chips,
// felled-tree leaves, splashes, sparkles, confetti). Queue a burst with fx.emit() (globals.ts).
// =====================================================================
const MAX_PARTICLES = 600;

interface BurstStyle {
    count: number;
    colors: string[];
    size: [number, number];
    speed: [number, number];   // Sideways m/s
    up: [number, number];      // Upwards m/s
    gravity: number;           // m/s² (negative rises)
    drag: number;              // 1/s
    life: [number, number];    // s
    spread?: number;           // Spawn box half-size (m)
    flutter?: boolean;         // Sways side to side (leaves, confetti)
}

const STYLES: Record<FxKind, BurstStyle> = {
    chips: { count: 4, colors: ['#c8955a', '#a8743f', '#e6c58f'], size: [0.07, 0.15], speed: [1.5, 3.5], up: [2.5, 4.5], gravity: 18, drag: 1, life: [0.5, 0.8], spread: 0.15 },
    fell: { count: 34, colors: ['#3e8e41', '#5fae4b', '#2f6e33', '#c8955a', '#a8743f'], size: [0.12, 0.26], speed: [1, 4], up: [1, 5], gravity: 5, drag: 1.6, life: [1.2, 2.2], spread: 1.6, flutter: true },
    splash: { count: 16, colors: ['#ffffff', '#d6f1ff', '#a9dcf5'], size: [0.08, 0.16], speed: [1.2, 3.2], up: [3.5, 6], gravity: 18, drag: 0.6, life: [0.45, 0.75], spread: 0.3 },
    sparkle: { count: 10, colors: ['#ffe066', '#fff3b0', '#ffd23f'], size: [0.06, 0.12], speed: [0.4, 1.6], up: [0.8, 2.4], gravity: -1.5, drag: 2, life: [0.5, 0.9], spread: 0.4 },
    confetti: { count: 40, colors: ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#ff924c'], size: [0.1, 0.18], speed: [2, 5.5], up: [6, 10], gravity: 9, drag: 1.3, life: [1.6, 2.6], spread: 0.3, flutter: true },
    bonk: { count: 9, colors: ['#ffffff', '#ffe066'], size: [0.08, 0.14], speed: [2, 4], up: [1, 3], gravity: 6, drag: 2, life: [0.35, 0.55], spread: 0.2 },
};

const rnd = (r: [number, number]) => r[0] + Math.random() * (r[1] - r[0]);

const Particles = () => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const data = useMemo(() => ({
        pos: new Float32Array(MAX_PARTICLES * 3),
        vel: new Float32Array(MAX_PARTICLES * 3),
        life: new Float32Array(MAX_PARTICLES),     // Time left (s); <= 0 = free
        maxLife: new Float32Array(MAX_PARTICLES),
        size: new Float32Array(MAX_PARTICLES),
        gravity: new Float32Array(MAX_PARTICLES),
        drag: new Float32Array(MAX_PARTICLES),
        spin: new Float32Array(MAX_PARTICLES * 2),
        flutter: new Uint8Array(MAX_PARTICLES),
        next: 0,
        alive: 0,
    }), []);
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const color = useMemo(() => new THREE.Color(), []);
    const hidden = useMemo(() => new THREE.Matrix4().makeScale(0, 0, 0), []);

    useEffect(() => {
        const mesh = meshRef.current;
        if (!mesh) return;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < MAX_PARTICLES; i++) {
            mesh.setMatrixAt(i, hidden);
            mesh.setColorAt(i, color.set('#ffffff'));
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }, [hidden, color]);

    useFrame((state, rawDelta) => {
        const mesh = meshRef.current;
        if (!mesh) return;
        const delta = Math.min(rawDelta, MAX_FRAME_DELTA);
        const d = data;

        // Spawn queued bursts
        let colorsChanged = false;
        while (fx.queue.length) {
            const b = fx.queue.shift()!;
            const st = STYLES[b.kind];
            const n = b.count ?? st.count;
            for (let k = 0; k < n; k++) {
                const i = d.next;
                d.next = (d.next + 1) % MAX_PARTICLES;
                const sp = st.spread ?? 0;
                d.pos[i * 3] = b.x + (Math.random() - 0.5) * 2 * sp;
                d.pos[i * 3 + 1] = b.y + (Math.random() - 0.5) * 2 * sp;
                d.pos[i * 3 + 2] = b.z + (Math.random() - 0.5) * 2 * sp;
                const a = Math.random() * Math.PI * 2;
                const v = rnd(st.speed);
                d.vel[i * 3] = Math.cos(a) * v;
                d.vel[i * 3 + 1] = rnd(st.up);
                d.vel[i * 3 + 2] = Math.sin(a) * v;
                d.maxLife[i] = d.life[i] = rnd(st.life);
                d.size[i] = rnd(st.size);
                d.gravity[i] = st.gravity;
                d.drag[i] = st.drag;
                d.spin[i * 2] = (Math.random() - 0.5) * 16;
                d.spin[i * 2 + 1] = (Math.random() - 0.5) * 16;
                d.flutter[i] = st.flutter ? 1 : 0;
                mesh.setColorAt(i, color.set(st.colors[Math.floor(Math.random() * st.colors.length)]));
                colorsChanged = true;
            }
        }
        if (colorsChanged && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

        // Move the live ones
        let alive = 0;
        const t = state.clock.elapsedTime;
        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (d.life[i] <= 0) continue;
            d.life[i] -= delta;
            if (d.life[i] <= 0) {
                mesh.setMatrixAt(i, hidden);
                continue;
            }
            alive++;
            const k = Math.exp(-d.drag[i] * delta);
            d.vel[i * 3] *= k;
            d.vel[i * 3 + 2] *= k;
            d.vel[i * 3 + 1] = d.vel[i * 3 + 1] * k - d.gravity[i] * delta;
            if (d.flutter[i]) {
                d.vel[i * 3] += Math.sin(t * 5 + i) * 3 * delta;
                d.vel[i * 3 + 2] += Math.cos(t * 4 + i * 1.7) * 3 * delta;
            }
            d.pos[i * 3] += d.vel[i * 3] * delta;
            d.pos[i * 3 + 1] += d.vel[i * 3 + 1] * delta;
            d.pos[i * 3 + 2] += d.vel[i * 3 + 2] * delta;
            // Land on the ground instead of falling through it
            const g = calculateTerrainHeight(d.pos[i * 3], d.pos[i * 3 + 2]);
            const floor = Math.max(g, WATER_LEVEL) + d.size[i] * 0.5;
            if (d.pos[i * 3 + 1] < floor && d.vel[i * 3 + 1] < 0) {
                d.pos[i * 3 + 1] = floor;
                d.vel[i * 3 + 1] *= -0.25;
                d.vel[i * 3] *= 0.5;
                d.vel[i * 3 + 2] *= 0.5;
                d.spin[i * 2] *= 0.5;
                d.spin[i * 2 + 1] *= 0.5;
            }
            const f = d.life[i] / d.maxLife[i];
            const s = d.size[i] * Math.min(1, f * 3); // Shrink away at the end
            dummy.position.set(d.pos[i * 3], d.pos[i * 3 + 1], d.pos[i * 3 + 2]);
            dummy.rotation.set(t * d.spin[i * 2], t * d.spin[i * 2 + 1], 0);
            dummy.scale.set(s, d.flutter[i] ? s * 0.25 : s, s);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        }
        if (alive > 0 || d.alive > 0) mesh.instanceMatrix.needsUpdate = true;
        d.alive = alive;
    });

    return (
        <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_PARTICLES]} frustumCulled={false}>
            <boxGeometry args={[1, 1, 1]} />
            <meshLambertMaterial emissive="#222222" />
        </instancedMesh>
    );
};

// =====================================================================
// Fireflies: soft glowing dots that drift and blink over the grass on warm, dry nights
// =====================================================================
const FIREFLIES: Record<GraphicsQuality, number> = { LOW: 0, MEDIUM: 40, HIGH: 70 };
const FIREFLY_RANGE = 22;

const fireflyVertex = /* glsl */`
    attribute float aPhase;
    uniform float time;
    uniform float strength;
    uniform float pixelRatio;
    varying float vGlow;
    void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float blink = pow(max(0.0, sin(time * (0.7 + fract(aPhase * 7.3) * 0.9) + aPhase * 6.28)), 3.0);
        vGlow = blink * strength;
        gl_PointSize = (90.0 * pixelRatio / -mv.z) * (0.6 + blink * 0.6);
    }
`;
const fireflyFragment = /* glsl */`
    varying float vGlow;
    void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(0.85, 1.0, 0.45) * (0.6 + a), a * a * vGlow);
    }
`;

const Fireflies = ({ quality }: { quality: GraphicsQuality }) => {
    const count = FIREFLIES[quality];
    const ref = useRef<THREE.Points>(null);
    const state = useMemo(() => Array.from({ length: count }, () => ({
        home: new THREE.Vector3(), seed: Math.random() * 100, placed: false,
    })), [count]);
    const geometry = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        const phase = new Float32Array(count);
        for (let i = 0; i < count; i++) phase[i] = Math.random();
        g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
        return g;
    }, [count]);
    useEffect(() => () => geometry.dispose(), [geometry]);
    // Made here, not as JSX: react-three-fiber copies number uniforms when it applies props
    const material = useMemo(() => new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, strength: { value: 0 }, pixelRatio: { value: 1 } },
        vertexShader: fireflyVertex,
        fragmentShader: fireflyFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    }), []);
    useEffect(() => () => material.dispose(), [material]);
    const uniforms = material.uniforms;

    const place = (f: { home: THREE.Vector3; placed: boolean }, px: number, pz: number) => {
        for (let tries = 0; tries < 6; tries++) {
            const a = Math.random() * Math.PI * 2;
            const r = 4 + Math.random() * FIREFLY_RANGE;
            const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
            const g = calculateTerrainHeight(x, z);
            if (g > WATER_LEVEL + 0.3) {
                f.home.set(x, g + 0.6 + Math.random() * 1.8, z);
                f.placed = true;
                return;
            }
        }
    };

    useFrame((st) => {
        if (!ref.current || count === 0) return;
        const s = useGameStore.getState();
        const tod = s.timeOfDay;
        // Out from just after sunset until just before sunrise, not in the rain
        const night = Math.min(1, Math.max(0, (tod - 0.52) / 0.05)) * Math.min(1, Math.max(0, (0.98 - tod) / 0.05));
        const strength = night * Math.max(0, 1 - liveWeather.rain * 2.5);
        uniforms.strength.value = strength;
        uniforms.time.value = st.clock.elapsedTime;
        uniforms.pixelRatio.value = st.gl.getPixelRatio();
        ref.current.visible = strength > 0.01;
        if (!ref.current.visible) return;

        const p = currentWoodchuckPos;
        const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
        const t = st.clock.elapsedTime;
        for (let i = 0; i < count; i++) {
            const f = state[i];
            if (!f.placed || Math.hypot(f.home.x - p.x, f.home.z - p.z) > FIREFLY_RANGE + 6) place(f, p.x, p.z);
            pos.setXYZ(i,
                f.home.x + Math.sin(t * 0.4 + f.seed) * 1.5,
                f.home.y + Math.sin(t * 0.9 + f.seed * 2) * 0.4,
                f.home.z + Math.cos(t * 0.33 + f.seed * 3) * 1.5);
        }
        pos.needsUpdate = true;
    });

    if (count === 0) return null;
    return (
        <points ref={ref} geometry={geometry} material={material} frustumCulled={false} />
    );
};

// =====================================================================
// Jumping fish: now and then a fish leaps out of the river near Chucky, with a splash
// =====================================================================
const FISH_JUMP_TIME = 0.95;  // s in the air
const FISH_LEAP = { height: 1.5, length: 2.8 };
const FISH_HEAR_DISTANCE = 45;

const JumpingFish = () => {
    const ref = useRef<THREE.Group>(null);
    const jump = useRef<{ start: number; x: number; z: number; dx: number; dz: number } | null>(null);
    const nextAt = useRef(4);

    useFrame((st) => {
        const g = ref.current;
        if (!g) return;
        const t = st.clock.elapsedTime;
        const s = useGameStore.getState();
        const p = currentWoodchuckPos;

        if (!jump.current) {
            g.visible = false;
            if (t < nextAt.current || s.isPaused || s.phase !== 'PLAYING') return;
            nextAt.current = t + 5 + Math.random() * 9;
            // A spot in the river near Chucky, deep enough to jump out of
            for (let tries = 0; tries < 5; tries++) {
                const z = p.z + (Math.random() - 0.5) * 50;
                const x = getRiverX(z) + (Math.random() - 0.5) * getRiverWidth(z) * 1.2;
                if (Math.hypot(x - p.x, z - p.z) > 55) continue;
                if (calculateTerrainHeight(x, z) > WATER_LEVEL - 0.8) continue;
                const a = Math.random() * Math.PI * 2;
                jump.current = { start: t, x, z, dx: Math.cos(a), dz: Math.sin(a) };
                fx.emit('splash', x, WATER_LEVEL, z, 10);
                break;
            }
            return;
        }

        const j = jump.current;
        const f = (t - j.start) / FISH_JUMP_TIME;
        if (f >= 1) {
            const ex = j.x + j.dx * FISH_LEAP.length, ez = j.z + j.dz * FISH_LEAP.length;
            fx.emit('splash', ex, WATER_LEVEL, ez, 14);
            const dist = Math.hypot(ex - p.x, ez - p.z);
            if (dist < FISH_HEAR_DISTANCE) audioService.playPlop(1 - dist / FISH_HEAR_DISTANCE);
            jump.current = null;
            g.visible = false;
            return;
        }
        g.visible = true;
        const x = j.x + j.dx * FISH_LEAP.length * f;
        const z = j.z + j.dz * FISH_LEAP.length * f;
        const y = WATER_LEVEL - 0.2 + 4 * FISH_LEAP.height * f * (1 - f);
        g.position.set(x, y, z);
        // Nose follows the arc; a wiggle of the tail
        const climb = 4 * FISH_LEAP.height * (1 - 2 * f) / FISH_LEAP.length;
        g.rotation.set(0, Math.atan2(j.dx, j.dz) - Math.PI / 2, 0);
        g.rotateZ(Math.atan(climb));
        g.rotateY(Math.sin(t * 30) * 0.15);
    });

    return (
        <group ref={ref} visible={false}>
            {/* Body along +X */}
            <mesh scale={[0.42, 0.17, 0.11]} castShadow>
                <sphereGeometry args={[1, 12, 8]} />
                <meshStandardMaterial color="#8fa9a3" metalness={0.5} roughness={0.35} />
            </mesh>
            <mesh position={[0, 0.06, 0]} scale={[0.36, 0.1, 0.1]}>
                <sphereGeometry args={[1, 10, 6]} />
                <meshStandardMaterial color="#4f6f5f" metalness={0.3} roughness={0.5} />
            </mesh>
            {/* Tail */}
            <mesh position={[-0.48, 0, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.3]}>
                <coneGeometry args={[0.16, 0.22, 4]} />
                <meshStandardMaterial color="#6d8a80" />
            </mesh>
            {/* Eye */}
            <mesh position={[0.3, 0.04, 0.09]}>
                <sphereGeometry args={[0.025, 6, 6]} />
                <meshBasicMaterial color="#111111" />
            </mesh>
        </group>
    );
};

export const Effects = ({ quality }: { quality: GraphicsQuality }) => (
    <>
        <Particles />
        <Fireflies quality={quality} />
        <JumpingFish />
    </>
);
