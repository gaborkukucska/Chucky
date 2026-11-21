import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Clouds, Cloud } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore, calculateTerrainHeight, findDryLand } from '../store';
import { getWeather, rainbowSpot, lightningIn, LIGHTNING_BUCKET_S, Weather as WeatherState } from '../services/weather';
import { audioService } from '../services/audio';
import { currentWoodchuckPos, fx } from '../globals';
import { GraphicsQuality } from '../types';

// =====================================================================
// Weather in the scene: overcast sky, fog, clouds, rain, lightning, and the rainbow with its
// treasure. What the weather is comes from services/weather.ts (seed + day + clock), so joint
// games see the same sky. Other parts of the scene read `liveWeather` (lights, sound, HUD).
// =====================================================================

export const liveWeather: WeatherState & { flash: number; daylight: number } = {
    kind: 'clear', rain: 0, cloud: 0.1, storm: 0, rainbow: 0, slotKey: '1-0', flash: 0, daylight: 1,
};

// Where the current rainbow's treasure is, for the minimap (active = there to be taken)
export const rainbowTarget = { active: false, x: 0, z: 0 };

const RAIN_DROPS: Record<GraphicsQuality, number> = { LOW: 700, MEDIUM: 1600, HIGH: 2600 };
const RAIN_BOX = { w: 44, h: 26 };    // m around the camera
const RAIN_SPEED = 24;                // m/s
const RAINBOW_RADIUS = 42;
const RAINBOW_WIDTH = 5;
const TREASURE_RADIUS = 2.4;          // Walk this close to the pot to take the treasure
const THUNDER_SPEED = 160;            // m/s - "speed of sound", sped up so you're not waiting

// Shader materials are made here rather than as JSX: react-three-fiber copies number uniforms
// into the material when it applies props, so later `uniform.value = x` would never reach it.
const useShaderMaterial = (params: THREE.ShaderMaterialParameters) => {
    const material = useMemo(() => new THREE.ShaderMaterial(params), []); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => () => material.dispose(), [material]);
    return material;
};

const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
};

// Colours of the overcast sky / fog: [horizon, top] for day, storm-day and night
const C = (hex: string) => new THREE.Color(hex);
const SKY = {
    clearDay: [C('#c4dcef'), C('#c4dcef')],
    greyDay: [C('#a3adb6'), C('#78838e')],
    stormDay: [C('#626b74'), C('#3a424b')],
    night: [C('#151b24'), C('#090d13')],
};

// ---------------------------------------------------------------------
// Overcast dome + fog: a big sphere around the camera that greys out the sky as the clouds
// thicken. Fog uses the same horizon colour so far hills melt into it.
// ---------------------------------------------------------------------
const domeVertex = /* glsl */`
    varying float vH;
    void main() {
        vH = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;
const domeFragment = /* glsl */`
    uniform vec3 horizon;
    uniform vec3 top;
    uniform float opacity;
    varying float vH;
    void main() {
        vec3 col = mix(horizon, top, smoothstep(0.0, 0.6, vH));
        gl_FragColor = vec4(col, opacity * smoothstep(-0.25, 0.05, vH + 0.2));
    }
`;

const SkyAndFog = () => {
    const { scene, camera } = useThree();
    const domeRef = useRef<THREE.Mesh>(null);
    const uniforms = useMemo(() => ({
        horizon: { value: new THREE.Color() },
        top: { value: new THREE.Color() },
        opacity: { value: 0 },
    }), []);
    const material = useShaderMaterial({
        uniforms, vertexShader: domeVertex, fragmentShader: domeFragment,
        side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
    });
    const fog = useMemo(() => new THREE.Fog('#c4dcef', 140, 700), []);
    const h = useMemo(() => new THREE.Color(), []);
    const t = useMemo(() => new THREE.Color(), []);
    const tmp = useMemo(() => new THREE.Color(), []);

    useEffect(() => {
        const previous = scene.fog;
        scene.fog = fog;
        return () => { scene.fog = previous; };
    }, [scene, fog]);

    useFrame(() => {
        const w = liveWeather;
        const overcast = smooth(0.25, 1, w.cloud);
        // Day colours: clear haze -> grey -> storm grey; then towards night
        h.copy(SKY.clearDay[0]).lerp(SKY.greyDay[0], overcast).lerp(SKY.stormDay[0], w.storm);
        t.copy(SKY.clearDay[1]).lerp(SKY.greyDay[1], overcast).lerp(SKY.stormDay[1], w.storm);
        h.lerp(SKY.night[0], 1 - w.daylight);
        t.lerp(SKY.night[1], 1 - w.daylight);
        // Lightning lights the clouds up
        if (w.flash > 0) {
            tmp.set('#dfe8ff');
            h.lerp(tmp, w.flash * 0.6);
            t.lerp(tmp, w.flash * 0.7);
        }
        uniforms.horizon.value.copy(h);
        uniforms.top.value.copy(t);
        uniforms.opacity.value = overcast * 0.94;

        fog.color.copy(h);
        const thick = Math.max(w.rain, overcast * 0.35);
        fog.near = 140 - 120 * thick;
        fog.far = 700 - 560 * thick;

        if (domeRef.current) {
            domeRef.current.position.copy(camera.position);
            domeRef.current.visible = uniforms.opacity.value > 0.01;
        }
    });

    return (
        <mesh ref={domeRef} renderOrder={-1} frustumCulled={false} material={material}>
            <sphereGeometry args={[470, 32, 16]} />
        </mesh>
    );
};

// ---------------------------------------------------------------------
// Clouds: a layer that drifts with the camera (with some parallax), greying and thickening
// with the weather. The texture ships with the game (public/cloud.png), so no CDN is needed.
// ---------------------------------------------------------------------
const CLOUD_LAYOUT: { pos: [number, number, number]; bounds: [number, number, number]; seed: number }[] = [
    { pos: [0, 58, -60], bounds: [30, 4, 10], seed: 1 },
    { pos: [70, 62, -10], bounds: [26, 5, 12], seed: 2 },
    { pos: [-80, 55, 20], bounds: [34, 4, 10], seed: 3 },
    { pos: [-20, 64, 80], bounds: [28, 5, 12], seed: 4 },
    { pos: [60, 57, 75], bounds: [24, 4, 10], seed: 5 },
    { pos: [-60, 60, -85], bounds: [30, 5, 12], seed: 6 },
];

export const WeatherClouds = () => {
    const groupRef = useRef<THREE.Group>(null);
    const mats = useRef<THREE.Material[]>([]);
    const { camera } = useThree();
    const grey = useMemo(() => new THREE.Color(), []);

    useFrame((state) => {
        const g = groupRef.current;
        if (!g) return;
        const w = liveWeather;
        // Parallax: the layer follows the camera at 85%, and drifts with the wind
        const drift = state.clock.elapsedTime * (1.2 + w.storm * 3);
        g.position.set(camera.position.x * 0.85 + drift, 0, camera.position.z * 0.85);
        if (mats.current.length === 0) {
            g.traverse(o => {
                const m = (o as THREE.Mesh).material as THREE.Material | undefined;
                if (m && (o as THREE.InstancedMesh).isInstancedMesh) mats.current.push(m);
            });
        }
        const overcast = smooth(0.1, 1, w.cloud);
        const light = 0.25 + 0.75 * w.daylight;
        grey.setRGB(1, 1, 1).lerp(C('#8a939c'), overcast).lerp(C('#4a525b'), w.storm).multiplyScalar(light);
        if (w.flash > 0) grey.lerp(C('#ffffff'), w.flash * 0.8);
        for (const m of mats.current) {
            const mm = m as THREE.MeshLambertMaterial;
            mm.color.copy(grey);
            mm.opacity = 0.35 + 0.65 * overcast;
        }
    });

    return (
        <group ref={groupRef}>
            <Clouds texture="/cloud.png" limit={240}>
                {CLOUD_LAYOUT.map((c, i) => (
                    <Cloud key={i} seed={c.seed} position={c.pos} bounds={c.bounds} segments={26} volume={14} growth={6} speed={0.15} opacity={0.9} fade={30} />
                ))}
            </Clouds>
        </group>
    );
};

// ---------------------------------------------------------------------
// Rain: thin streaks (camera-facing quads) in a box that travels with the camera. Every drop is
// moved by the vertex shader, so the CPU does nothing per frame but update a few uniforms.
// ---------------------------------------------------------------------
const rainVertex = /* glsl */`
    attribute vec3 aSeed;     // xyz in [0,1)
    attribute vec2 aCorner;   // x: -1 / 1 = left / right edge, y: 0 = bottom of the streak, 1 = top
    attribute float aRank;    // 0..1 - drops with aRank above the rain amount aren't drawn
    uniform float time;
    uniform float amount;
    uniform vec3 camPos;
    uniform vec2 wind;
    varying float vAlpha;
    #include <fog_pars_vertex>
    void main() {
        if (aRank > amount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
        float W = ${RAIN_BOX.w.toFixed(1)};
        float H = ${RAIN_BOX.h.toFixed(1)};
        float fall = time * ${RAIN_SPEED.toFixed(1)} * (0.85 + aSeed.y * 0.3);
        vec3 p;
        p.x = camPos.x + mod(aSeed.x * W - camPos.x + wind.x * fall * 0.04, W) - W * 0.5;
        p.z = camPos.z + mod(aSeed.z * W - camPos.z + wind.y * fall * 0.04, W) - W * 0.5;
        p.y = camPos.y - H * 0.45 + mod(aSeed.y * H - fall - camPos.y, H);
        float len = 0.6 + amount * 0.5;
        p += vec3(-wind.x * 0.03, 1.0, -wind.y * 0.03) * len * aCorner.y;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        mvPosition.x += aCorner.x * 0.011 * (1.0 + 0.04 * max(0.0, -mvPosition.z)); // A little wider far away
        gl_Position = projectionMatrix * mvPosition;
        float d = length(p.xz - camPos.xz) / (W * 0.5);
        vAlpha = (1.0 - smoothstep(0.6, 1.0, d)) * (0.3 + aCorner.y * 0.5) * smoothstep(1.5, 4.5, -mvPosition.z);
        #include <fog_vertex>
    }
`;
const rainFragment = /* glsl */`
    uniform vec3 color;
    uniform float opacity;
    varying float vAlpha;
    #include <fog_pars_fragment>
    void main() {
        gl_FragColor = vec4(color, vAlpha * opacity);
        #include <fog_fragment>
    }
`;

const Rain = ({ quality }: { quality: GraphicsQuality }) => {
    const ref = useRef<THREE.Mesh>(null);
    const { camera } = useThree();
    const count = RAIN_DROPS[quality];
    const geometry = useMemo(() => {
        const g = new THREE.BufferGeometry();
        const seeds = new Float32Array(count * 12);
        const corners = new Float32Array(count * 8);
        const ranks = new Float32Array(count * 4);
        const index = new Uint32Array(count * 6);
        const CORNERS = [[-1, 0], [1, 0], [-1, 1], [1, 1]];
        for (let i = 0; i < count; i++) {
            const sx = Math.random(), sy = Math.random(), sz = Math.random(), r = Math.random();
            for (let c = 0; c < 4; c++) {
                seeds.set([sx, sy, sz], (i * 4 + c) * 3);
                corners.set(CORNERS[c], (i * 4 + c) * 2);
                ranks[i * 4 + c] = r;
            }
            index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
        }
        // position is required by three.js but the shader ignores it
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 12), 3));
        g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
        g.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
        g.setAttribute('aRank', new THREE.BufferAttribute(ranks, 1));
        g.setIndex(new THREE.BufferAttribute(index, 1));
        return g;
    }, [count]);
    useEffect(() => () => geometry.dispose(), [geometry]);

    const uniforms = useMemo(() => THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
            time: { value: 0 },
            amount: { value: 0 },
            camPos: { value: new THREE.Vector3() },
            wind: { value: new THREE.Vector2(2, 1) },
            color: { value: new THREE.Color('#c9d6e6') },
            opacity: { value: 0.7 },
        },
    ]), []);
    const material = useShaderMaterial({
        uniforms, vertexShader: rainVertex, fragmentShader: rainFragment,
        transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    });

    useFrame((state) => {
        const w = liveWeather;
        uniforms.time.value = state.clock.elapsedTime;
        uniforms.amount.value = w.rain;
        uniforms.camPos.value.copy(camera.position);
        uniforms.wind.value.set(2 + w.storm * 6, 1 + w.storm * 3);
        uniforms.opacity.value = 0.35 + 0.45 * w.daylight + w.flash * 0.5;
        if (ref.current) ref.current.visible = w.rain > 0.01;
    });

    return (
        <mesh ref={ref} geometry={geometry} material={material} frustumCulled={false} />
    );
};

// ---------------------------------------------------------------------
// Lightning: strikes come from the seed and the game clock (the same for every player).
// A jagged bolt, a flash over the whole scene, and thunder that arrives later the further
// away the strike was.
// ---------------------------------------------------------------------
const BOLT_POINTS = 14;
// How long a bolt and its flash last (s). Dev play-tests stretch these to catch them on screen.
const lightningTiming = { bolt: 0.28, flash: 0.45, strikes: 0 };
const Lightning = () => {
    const { camera } = useThree();
    const fired = useRef<Set<number>>(new Set());
    const boltRef = useRef<THREE.Mesh>(null);
    const boltUntil = useRef(0);
    const flashStart = useRef(-10);
    const flashPower = useRef(0);
    const geometry = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT_POINTS * 2 * 3 * 2), 3));
        const idx: number[] = [];
        // Main bolt: BOLT_POINTS points (ribbon), plus a short branch: another BOLT_POINTS points
        for (let part = 0; part < 2; part++) {
            const o = part * BOLT_POINTS * 2;
            for (let i = 0; i < BOLT_POINTS - 1; i++) {
                const a = o + i * 2, b = a + 1, c = a + 2, d = a + 3;
                idx.push(a, b, c, b, d, c);
            }
        }
        g.setIndex(idx);
        return g;
    }, []);
    useEffect(() => () => geometry.dispose(), [geometry]);

    const buildBolt = (x: number, z: number, ground: number) => {
        const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
        const pts: THREE.Vector3[] = [];
        let px = x + (Math.random() - 0.5) * 20, pz = z + (Math.random() - 0.5) * 20;
        const top = ground + 75;
        for (let i = 0; i < BOLT_POINTS; i++) {
            const f = i / (BOLT_POINTS - 1);
            const y = top + (ground - top) * f;
            px += (x - px) * 0.25 + (Math.random() - 0.5) * 5 * (1 - f * 0.6);
            pz += (z - pz) * 0.25 + (Math.random() - 0.5) * 5 * (1 - f * 0.6);
            pts.push(new THREE.Vector3(i === BOLT_POINTS - 1 ? x : px, y, i === BOLT_POINTS - 1 ? z : pz));
        }
        // Branch: splits off a third of the way down, fizzles out sideways
        const branch: THREE.Vector3[] = [];
        const start = pts[Math.floor(BOLT_POINTS / 3)].clone();
        const dir = new THREE.Vector3(Math.random() - 0.5, -1, Math.random() - 0.5).normalize();
        for (let i = 0; i < BOLT_POINTS; i++) {
            branch.push(start.clone().addScaledVector(dir, i * 2.2).add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2)));
        }
        const toCam = new THREE.Vector3();
        const along = new THREE.Vector3();
        const side = new THREE.Vector3();
        [pts, branch].forEach((line, part) => {
            for (let i = 0; i < BOLT_POINTS; i++) {
                const p = line[i];
                along.subVectors(line[Math.min(i + 1, BOLT_POINTS - 1)], line[Math.max(i - 1, 0)]).normalize();
                toCam.subVectors(camera.position, p).normalize();
                side.crossVectors(along, toCam).normalize();
                const width = (part === 0 ? 0.9 : 0.4) * (1 - (part === 1 ? i / BOLT_POINTS : 0));
                const k = (part * BOLT_POINTS * 2 + i * 2) * 3;
                pos.setXYZ(k / 3, p.x + side.x * width, p.y + side.y * width, p.z + side.z * width);
                pos.setXYZ(k / 3 + 1, p.x - side.x * width, p.y - side.y * width, p.z - side.z * width);
            }
        });
        pos.needsUpdate = true;
        geometry.computeBoundingSphere();
    };

    useFrame((state) => {
        const s = useGameStore.getState();
        const now = state.clock.elapsedTime;
        // Flash: a bright double flicker that fades
        const ft = now - flashStart.current;
        const ff = ft / lightningTiming.flash; // 0..1 through the flash
        liveWeather.flash = ff < 1
            ? flashPower.current * (1 - ff) * (ff < 0.18 || (ff > 0.3 && ff < 0.5) ? 1 : 0.35)
            : 0;
        if (boltRef.current) boltRef.current.visible = now < boltUntil.current;

        if (s.phase !== 'PLAYING' || liveWeather.storm < 0.5) return;
        const gameSeconds = (s.day + s.timeOfDay) * s.dayDuration;
        const bucket = Math.floor(gameSeconds / LIGHTNING_BUCKET_S);
        for (const b of [bucket - 1, bucket]) {
            if (fired.current.has(b)) continue;
            const strike = lightningIn(s.worldSeed, b);
            if (!strike || strike.at > gameSeconds) continue;
            fired.current.add(b);
            if (gameSeconds - strike.at > 1.5) continue; // Too late (just loaded / resumed)
            if (fired.current.size > 20) fired.current = new Set([...fired.current].slice(-10));

            const p = currentWoodchuckPos;
            const dist = Math.hypot(strike.x - p.x, strike.z - p.z);
            const ground = calculateTerrainHeight(strike.x, strike.z);
            buildBolt(strike.x, strike.z, ground);
            boltUntil.current = now + lightningTiming.bolt;
            lightningTiming.strikes++;
            flashStart.current = now;
            flashPower.current = 0.45 + 0.55 * Math.max(0, 1 - dist / 260);
            if (dist < 60) fx.emit('sparkle', strike.x, ground + 0.5, strike.z, 16);
            const delay = Math.min(4, dist / THUNDER_SPEED);
            setTimeout(() => audioService.playThunder(dist), delay * 1000);
        }
    });

    return (
        <mesh ref={boltRef} geometry={geometry} visible={false} frustumCulled={false}>
            <meshBasicMaterial color="#eef3ff" side={THREE.DoubleSide} fog={false} toneMapped={false} />
        </mesh>
    );
};

// ---------------------------------------------------------------------
// Rainbow: after the rain, an arc whose end stands on a seeded spot of the map. There's a pot
// of treasure where it ends (each player can take it once). The arc turns to face you, pivoting
// on its foot, so it always looks like a rainbow and the foot never moves.
// ---------------------------------------------------------------------
const rainbowVertex = /* glsl */`
    varying vec2 vPos;
    void main() {
        vPos = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;
const rainbowFragment = /* glsl */`
    uniform float strength;
    uniform float inner;
    uniform float outer;
    varying vec2 vPos;
    vec3 hue(float h) {
        vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        return k;
    }
    void main() {
        float r = (length(vPos) - inner) / (outer - inner); // 0 inside (violet) .. 1 outside (red)
        vec3 col = hue((1.0 - r) * 0.78);
        float edge = smoothstep(0.0, 0.12, r) * smoothstep(1.0, 0.88, r);
        float feet = smoothstep(-2.0, 10.0, vPos.y);            // Fades out into the ground
        gl_FragColor = vec4(col, strength * edge * feet * 0.55);
    }
`;

const Rainbow = () => {
    const { camera } = useThree();
    const arcRef = useRef<THREE.Mesh>(null);
    const potRef = useRef<THREE.Group>(null);
    const beamRef = useRef<THREE.Mesh>(null);
    const spot = useRef<{ key: string; x: number; y: number; z: number } | null>(null);
    const uniforms = useMemo(() => ({
        strength: { value: 0 },
        inner: { value: RAINBOW_RADIUS - RAINBOW_WIDTH },
        outer: { value: RAINBOW_RADIUS },
    }), []);
    const material = useShaderMaterial({
        uniforms, vertexShader: rainbowVertex, fragmentShader: rainbowFragment,
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    });

    useFrame((state) => {
        const w = liveWeather;
        const s = useGameStore.getState();
        const show = w.rainbow > 0.01 && s.phase === 'PLAYING';
        if (arcRef.current) arcRef.current.visible = show;
        rainbowTarget.active = false;
        if (!show) {
            if (potRef.current) potRef.current.visible = false;
            return;
        }
        if (!spot.current || spot.current.key !== w.slotKey) {
            // In the open: the first seeded spot with no tree close by (every tree counts, felled or
            // not, so all players in a joint game pick the same spot)
            let x = 0, z = 0;
            for (let attempt = 0; attempt < 12; attempt++) {
                [x, z] = findDryLand(...rainbowSpot(s.worldSeed, w.slotKey, attempt));
                if (!s.trees.some(t => Math.hypot(t.position[0] - x, t.position[2] - z) < 4.5)) break;
            }
            spot.current = { key: w.slotKey, x, z, y: calculateTerrainHeight(x, z) };
        }
        const { x, y, z, key } = spot.current;
        // Up close the arc would fill the screen: it fades out, and the pot's beam shows the way
        const camDist = Math.hypot(camera.position.x - x, camera.position.z - z);
        uniforms.strength.value = w.rainbow * smooth(12, 40, camDist);

        // Face the camera, pivoting on the foot at the pot
        const yaw = Math.atan2(camera.position.x - x, camera.position.z - z);
        const arc = arcRef.current!;
        arc.rotation.set(0, yaw, 0);
        arc.position.set(x + Math.cos(yaw) * RAINBOW_RADIUS, y - 3, z - Math.sin(yaw) * RAINBOW_RADIUS);

        // The pot: hidden once this player has taken this rainbow's treasure
        const taken = s.rainbowFound === key;
        rainbowTarget.active = !taken;
        rainbowTarget.x = x;
        rainbowTarget.z = z;
        const pot = potRef.current;
        if (pot) {
            pot.visible = !taken;
            pot.position.set(x, y, z);
            pot.rotation.y = state.clock.elapsedTime * 0.6;
        }
        if (beamRef.current) {
            const m = beamRef.current.material as THREE.MeshBasicMaterial;
            m.opacity = 0.18 + 0.08 * Math.sin(state.clock.elapsedTime * 3);
        }
        if (!taken && !s.isPaused && w.rainbow > 0.05) {
            const p = currentWoodchuckPos;
            if (Math.hypot(p.x - x, p.z - z) < TREASURE_RADIUS) {
                fx.emit('confetti', x, y + 1, z, 50);
                fx.emit('sparkle', x, y + 1, z, 24);
                s.collectRainbow(key);
            }
        }
    });

    return (
        <>
            <mesh ref={arcRef} visible={false} renderOrder={1} frustumCulled={false} material={material}>
                <ringGeometry args={[RAINBOW_RADIUS - RAINBOW_WIDTH, RAINBOW_RADIUS, 96, 1, 0, Math.PI]} />
            </mesh>
            <group ref={potRef} visible={false}>
                {/* Cauldron */}
                <mesh position={[0, 0.45, 0]} castShadow>
                    <sphereGeometry args={[0.55, 16, 12, 0, Math.PI * 2, Math.PI * 0.25, Math.PI * 0.75]} />
                    <meshStandardMaterial color="#1f1f24" metalness={0.6} roughness={0.4} side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[0, 0.83, 0]} rotation={[Math.PI / 2, 0, 0]}>
                    <torusGeometry args={[0.4, 0.06, 8, 20]} />
                    <meshStandardMaterial color="#2b2b31" metalness={0.6} roughness={0.4} />
                </mesh>
                {/* Gold heaped in it */}
                <mesh position={[0, 0.8, 0]}>
                    <sphereGeometry args={[0.38, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
                    <meshStandardMaterial color="#ffcc33" emissive="#a06800" emissiveIntensity={0.6} metalness={0.8} roughness={0.25} />
                </mesh>
                {[0, 1, 2, 3, 4].map(i => (
                    <mesh key={i} position={[Math.cos(i * 1.3) * 0.75, 0.05, Math.sin(i * 1.3) * 0.75]} rotation={[0.2 * i, i, 0]}>
                        <cylinderGeometry args={[0.14, 0.14, 0.04, 12]} />
                        <meshStandardMaterial color="#ffd24a" emissive="#a06800" emissiveIntensity={0.5} metalness={0.8} roughness={0.25} />
                    </mesh>
                ))}
                {/* A shimmering beam so you can spot it from afar */}
                <mesh ref={beamRef} position={[0, 20, 0]}>
                    <cylinderGeometry args={[0.6, 1.4, 40, 12, 1, true]} />
                    <meshBasicMaterial color="#fff1a8" transparent opacity={0.2} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} fog={false} />
                </mesh>
                <pointLight position={[0, 1.5, 0]} color="#ffd96b" intensity={6} distance={9} />
            </group>
        </>
    );
};

// ---------------------------------------------------------------------
// Works out the weather once per frame for everyone else
// ---------------------------------------------------------------------
const WeatherClock = () => {
    useFrame(() => {
        const s = useGameStore.getState();
        const w = s.phase === 'PLAYING' ? getWeather(s.worldSeed, s.day, s.timeOfDay) : getWeather(s.worldSeed, 1, 0.1);
        liveWeather.kind = w.kind;
        liveWeather.rain = w.rain;
        liveWeather.cloud = w.cloud;
        liveWeather.storm = w.storm;
        liveWeather.rainbow = w.rainbow;
        liveWeather.slotKey = w.slotKey;
        liveWeather.daylight = smooth(-0.12, 0.25, Math.sin(s.timeOfDay * Math.PI * 2));
    });
    return null;
};

export const WeatherSystem = ({ quality }: { quality: GraphicsQuality }) => (
    <>
        <WeatherClock />
        <SkyAndFog />
        <Rain quality={quality} />
        <Lightning />
        <Rainbow />
    </>
);

// Dev servers only: lets play-tests look up the weather schedule
if (import.meta.env.DEV) (window as any).__chuckyWeather = { getWeather, liveWeather, lightningTiming, rainbowTarget };
