import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Physics, useSphere } from '@react-three/cannon';
import { Sky, Stars, Cloud, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore, calculateTerrainHeight, isNightTime, MAP_SIZE, getRiverX, getRiverWidth } from '../store';
import { audioService } from '../services/audio';
import { Terrain } from './Terrain';
import { Water } from './Water';
import { Boulder, Tree, Log, LooseLog, PlacedStructureRenderer } from './WorldObjects';
import { Woodchuck } from './Woodchuck';
import { FoodData, MobData, GraphicsQuality } from '../types';
import { currentWoodchuckPos, liveObjects, playerState, readBodyPosition } from '../globals';

const WATER_LEVEL = -1.5;
const MAX_FRAME_DELTA = 0.1;

// --- Lighting ---
const SUN_DISTANCE = 100;
const SHADOW_EXTENT = 60; // Shadow camera half-size around Chucky (the sun follows him)

// --- Graphics quality (Settings menu) ---
// dpr: pixel-ratio range (clamped to the screen's), shadowMap: sun shadow map size (moon: half)
const QUALITY_SETTINGS: Record<GraphicsQuality, { dpr: number | [number, number]; shadowMap: number; clouds: boolean }> = {
    LOW: { dpr: 1, shadowMap: 512, clouds: false },
    MEDIUM: { dpr: [1, 1.5], shadowMap: 1024, clouds: true },
    HIGH: { dpr: [1, 2], shadowMap: 2048, clouds: true },
};

// --- Grass --- only drawn in a window of tiles around Chucky (see Grass below)
const GRASS_TILE = 12; // m
const GRASS_QUALITY: Record<GraphicsQuality, { tilesAcross: number; bladesPerTile: number }> = {
    LOW: { tilesAcross: 5, bladesPerTile: 45 },      // 60 m window,  1,125 blades
    MEDIUM: { tilesAcross: 9, bladesPerTile: 60 },   // 108 m window, 4,860 blades
    HIGH: { tilesAcross: 11, bladesPerTile: 90 },    // 132 m window, 10,890 blades
};

// --- Food ---
const FOOD_PICKUP_RADIUS = 1.3;

// --- Mobs ---
const MOB_SPEED = { wolf: 9, bear: 6 };
const MOB_DAMAGE = { wolf: 15, bear: 30 };
const MOB_AGGRO_RANGE = 45;
const MOB_LUNGE_RANGE = 8;
const MOB_LUNGE_MULTIPLIER = 1.3;
const MOB_HIT_RANGE = 1.3;
const MOB_HIT_COOLDOWN = 1200;  // ms between hits from the same mob
const MOB_STUN_TIME = 600;      // ms a mob backs off after landing a hit
const MOB_KNOCKBACK = 60;       // Impulse applied to the mob after a hit (mass 10)
const MOB_HITS_TO_CHASE = { wolf: 2, bear: 3 }; // Thrown-log hits before it runs off
const MOB_THROW_STUN_TIME = 900; // ms a mob is dazed after a log hits it
const MOB_THROW_KNOCKBACK = 55;

// =====================================================================
// Optional scene elements (e.g. drei Clouds load a texture from a CDN).
// If one fails (offline, blocked CDN) skip it instead of crashing the whole game.
// =====================================================================
class OptionalBoundary extends React.Component<{ children?: React.ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch(error: any) {
        console.warn('[Chucky] Optional scene element failed to load and was skipped:', error?.message || error);
    }
    render() {
        return this.state.failed ? null : this.props.children;
    }
}

// =====================================================================
// Camera
// =====================================================================
// Four distinct views (📷 cycles them). The zoom slider / mouse wheel scales distance + height.
//   BEHIND    "3rd person" - chase cam behind Chucky; swings round as he turns (steering controls)
//   FOLLOW    "Overview"   - high three-quarter view from the south, world-aligned
//   TOP_DOWN  "Top-down"   - map view from straight above, north up
//   CINEMATIC "Cinematic"  - slow, low orbit around Chucky
const CHASE = { distance: 8, height: 3.5, lookAhead: 4, lookHeight: 1.2, posRate: 8, yawRate: 3.5, minDistance: 2.8 };
const OVERVIEW = { back: 26, height: 18, posRate: 3 };
const TOP_DOWN_VIEW = { height: 42, back: 2, posRate: 3 };
const CINEMATIC_VIEW = { radius: 20, height: 6, orbitSpeed: 0.12, posRate: 2 };
const CAMERA_MIN_CLEARANCE = 1.5; // Above terrain
// Must match the Tree visuals in WorldObjects.tsx (trunk 4*s tall, radius up to 0.75*s;
// lower canopy cone from 3*s to 7*s above the ground, 2*s wide at its base)
const TREE_SCALE: Record<string, number> = { small: 0.8, medium: 1.1, large: 1.5 };

const wrapAngle = (a: number) => {
    while (a < -Math.PI) a += Math.PI * 2;
    while (a > Math.PI) a -= Math.PI * 2;
    return a;
};

const CameraController = () => {
    const { camera } = useThree();
    const desired = useMemo(() => new THREE.Vector3(), []);
    const lookTarget = useMemo(() => new THREE.Vector3(), []);
    const smoothLook = useMemo(() => new THREE.Vector3(), []);
    const chaseYaw = useRef(playerState.facing);
    const orbitAngle = useRef(0);
    const chasePull = useRef(1); // 1 = full distance, <1 = pulled in front of a tree
    const lastMode = useRef('');

    useFrame((state, rawDelta) => {
        const { x, y, z } = currentWoodchuckPos;
        if (x === 0 && y === 0 && z === 0) return; // Skip until the woodchuck has spawned
        const delta = Math.min(rawDelta, MAX_FRAME_DELTA);
        const s = useGameStore.getState();
        const zoom = s.cameraZoom;
        const mode = s.cameraMode;

        // Entering a mode: start from where the camera currently is, so the switch is smooth
        if (mode !== lastMode.current) {
            lastMode.current = mode;
            chaseYaw.current = playerState.facing;
            orbitAngle.current = Math.atan2(camera.position.x - x, camera.position.z - z);
            smoothLook.set(x, y, z);
        }

        let rate: number;
        if (mode === 'BEHIND') {
            // Yaw eases towards Chucky's facing, so the camera swings round behind him
            chaseYaw.current += wrapAngle(playerState.facing - chaseYaw.current) * (1 - Math.exp(-CHASE.yawRate * delta));
            const sin = Math.sin(chaseYaw.current);
            const cos = Math.cos(chaseYaw.current);
            const dist = CHASE.distance * zoom;
            const height = CHASE.height * zoom;

            // A tree between Chucky and the camera would hide him: slide the camera in front of it
            // (pull in quickly, ease back out once the view is clear)
            let clear = dist;
            for (const tree of s.trees) {
                if (tree.isFelled) continue;
                const rx = tree.position[0] - x;
                const rz = tree.position[2] - z;
                const along = -(rx * sin + rz * cos); // How far behind Chucky (camera side)
                if (along <= 0 || along >= dist + 2) continue;
                const sc = TREE_SCALE[tree.size] ?? 1.1;
                const perp = Math.abs(rx * cos - rz * sin);
                if (perp > 2 * sc + 0.5) continue;
                const rayY = y + CHASE.lookHeight + (height - CHASE.lookHeight) * Math.min(1, along / dist)
                    - calculateTerrainHeight(tree.position[0], tree.position[2]);
                let r = 0.75 * sc + 0.35; // Trunk
                if (rayY > 3 * sc && rayY < 7 * sc) r = Math.max(r, 2 * sc * (1 - (rayY - 3 * sc) / (4 * sc)) + 0.35);
                if (perp < r) clear = Math.min(clear, along - Math.sqrt(r * r - perp * perp) - 0.3);
            }
            const targetPull = Math.max(CHASE.minDistance, clear) / dist;
            const pullRate = targetPull < chasePull.current ? 12 : 2;
            chasePull.current += (targetPull - chasePull.current) * (1 - Math.exp(-pullRate * delta));
            const d = dist * chasePull.current;
            // Height stays put when pulled in: looking down over Chucky's shoulder keeps the view open
            desired.set(x - sin * d, y + height, z - cos * d);
            const ahead = CHASE.lookAhead * chasePull.current; // Pulled in: look nearer so Chucky stays in frame
            lookTarget.set(x + sin * ahead, y + CHASE.lookHeight, z + cos * ahead);
            rate = CHASE.posRate;
        } else if (mode === 'TOP_DOWN') {
            desired.set(x, y + TOP_DOWN_VIEW.height * zoom, z + TOP_DOWN_VIEW.back * zoom);
            lookTarget.set(x, y, z);
            rate = TOP_DOWN_VIEW.posRate;
        } else if (mode === 'CINEMATIC') {
            orbitAngle.current += CINEMATIC_VIEW.orbitSpeed * delta;
            const r = CINEMATIC_VIEW.radius * zoom;
            desired.set(x + Math.sin(orbitAngle.current) * r, y + CINEMATIC_VIEW.height * zoom, z + Math.cos(orbitAngle.current) * r);
            lookTarget.set(x, y + 1, z);
            rate = CINEMATIC_VIEW.posRate;
        } else {
            // FOLLOW / Overview
            desired.set(x, y + OVERVIEW.height * zoom, z + OVERVIEW.back * zoom);
            lookTarget.set(x, y, z);
            rate = OVERVIEW.posRate;
        }

        // Stay above the terrain (also halfway along the view, so hills behind Chucky don't swallow
        // the chase cam) and above the water surface (diving: look down at him through the water)
        const midGround = calculateTerrainHeight((desired.x + x) / 2, (desired.z + z) / 2);
        const minY = Math.max(
            calculateTerrainHeight(desired.x, desired.z) + CAMERA_MIN_CLEARANCE,
            midGround + CAMERA_MIN_CLEARANCE * 0.5,
            WATER_LEVEL + 0.6
        );
        if (desired.y < minY) desired.y = minY;

        const k = 1 - Math.exp(-rate * delta);
        camera.position.lerp(desired, k);
        smoothLook.lerp(lookTarget, Math.min(1, k * 1.5));
        camera.lookAt(smoothLook);
    });
    return null;
};

// =====================================================================
// Managers (restored - lost in the March component extraction)
// =====================================================================

// Advances the day/night clock and spawns/despawns mobs
const TimeManager = () => {
    useFrame((_, rawDelta) => {
        const s = useGameStore.getState();
        if (s.isPaused || s.phase !== 'PLAYING') return;
        s.updateTime(Math.min(rawDelta, MAX_FRAME_DELTA), [currentWoodchuckPos.x, currentWoodchuckPos.y, currentWoodchuckPos.z]);
    });
    return null;
};

// Structure destruction ticks and powerup expiry (powerups never expired without this)
const DestructionManager = () => {
    useFrame((_, rawDelta) => {
        const s = useGameStore.getState();
        if (s.isPaused) return;
        s.tickDestruction(Math.min(rawDelta, MAX_FRAME_DELTA));
        s.checkPowerups();
        s.checkCombo();        // Combo expiry lives in the store now (was driven by the HUD)
        s.syncLeaderboard();   // Throttled: only writes when the run's numbers changed
    });
    return null;
};

// =====================================================================
// Day / night cycle - driven imperatively so the scene does not re-render every frame
// =====================================================================
const DayNightCycle = ({ shadowMapSize }: { shadowMapSize: number }) => {
    const isNight = useGameStore(state => isNightTime(state.timeOfDay));

    const skyRef = useRef<any>(null);
    const ambientRef = useRef<THREE.AmbientLight>(null);
    const sunRef = useRef<THREE.DirectionalLight>(null);
    const moonLightRef = useRef<THREE.DirectionalLight>(null);
    const moonRef = useRef<THREE.Mesh>(null);
    const sunTarget = useMemo(() => new THREE.Object3D(), []);
    const moonTarget = useMemo(() => new THREE.Object3D(), []);

    useEffect(() => {
        if (sunRef.current) sunRef.current.target = sunTarget;
        if (moonLightRef.current) moonLightRef.current.target = moonTarget;
    }, [sunTarget, moonTarget]);

    // Quality change: resize the shadow maps (three.js recreates a map after it's disposed)
    useEffect(() => {
        const sizes: [THREE.DirectionalLight | null, number][] = [
            [sunRef.current, shadowMapSize],
            [moonLightRef.current, Math.max(512, shadowMapSize / 2)],
        ];
        for (const [light, size] of sizes) {
            if (!light || light.shadow.mapSize.x === size) continue;
            light.shadow.mapSize.set(size, size);
            light.shadow.map?.dispose();
            light.shadow.map = null;
        }
    }, [shadowMapSize]);

    useFrame(() => {
        // timeOfDay: 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight
        const t = useGameStore.getState().timeOfDay;
        const theta = t * Math.PI * 2;
        const sX = Math.cos(theta) * SUN_DISTANCE;
        const sY = Math.sin(theta) * SUN_DISTANCE;
        const sZ = -50;

        const sunIntensity = Math.max(0, Math.sin(theta)) * 1.5;
        const moonIntensity = Math.max(0, -Math.sin(theta)) * 0.5;

        const uniforms = skyRef.current?.material?.uniforms;
        if (uniforms?.sunPosition) uniforms.sunPosition.value.set(sX, sY, sZ);

        // Lights follow Chucky so the (smaller, sharper) shadow map always covers him
        const p = currentWoodchuckPos;
        sunTarget.position.copy(p);
        sunTarget.updateMatrixWorld();
        moonTarget.position.copy(p);
        moonTarget.updateMatrixWorld();

        // Only render a shadow map while its light is up (both rendered every frame before)
        if (sunRef.current) {
            sunRef.current.position.set(p.x + sX, p.y + sY, p.z + sZ);
            sunRef.current.intensity = sunIntensity;
            sunRef.current.shadow.autoUpdate = sunIntensity > 0;
        }
        if (moonLightRef.current) {
            moonLightRef.current.position.set(p.x - sX, p.y - sY, p.z);
            moonLightRef.current.intensity = moonIntensity;
            moonLightRef.current.shadow.autoUpdate = moonIntensity > 0;
        }
        if (moonRef.current) {
            moonRef.current.position.set(-sX * 4, -sY * 4, 0);
        }
        if (ambientRef.current) {
            ambientRef.current.intensity = 0.4 + sunIntensity * 0.2 + moonIntensity * 0.2;
        }
    });

    return (
        <>
            <Sky ref={skyRef} sunPosition={[SUN_DISTANCE, 0, -50]} turbidity={0.5} rayleigh={0.5} mieCoefficient={0.005} mieDirectionalG={0.8} />
            {isNight && <Stars radius={150} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />}

            {/* Moon - orbits opposite the sun, far away */}
            <mesh ref={moonRef}>
                <sphereGeometry args={[20, 32, 32]} />
                <meshStandardMaterial color="#DDDDDD" emissive="#222222" />
            </mesh>

            <ambientLight ref={ambientRef} intensity={0.5} />
            <primitive object={sunTarget} />
            <primitive object={moonTarget} />

            <directionalLight
                ref={sunRef}
                intensity={1}
                castShadow
                shadow-mapSize={[shadowMapSize, shadowMapSize]}
                shadow-bias={-0.0005}
                shadow-camera-left={-SHADOW_EXTENT}
                shadow-camera-right={SHADOW_EXTENT}
                shadow-camera-top={SHADOW_EXTENT}
                shadow-camera-bottom={-SHADOW_EXTENT}
                shadow-camera-near={1}
                shadow-camera-far={400}
            />
            <directionalLight
                ref={moonLightRef}
                intensity={0}
                color="#AACCEE"
                castShadow
                shadow-mapSize={[Math.max(512, shadowMapSize / 2), Math.max(512, shadowMapSize / 2)]}
                shadow-bias={-0.0005}
                shadow-camera-left={-SHADOW_EXTENT}
                shadow-camera-right={SHADOW_EXTENT}
                shadow-camera-top={SHADOW_EXTENT}
                shadow-camera-bottom={-SHADOW_EXTENT}
                shadow-camera-near={1}
                shadow-camera-far={400}
            />
        </>
    );
};

// =====================================================================
// Food (restored) - dropped by felled trees, heals Chucky
// =====================================================================
const Food = React.memo(({ data }: { data: FoodData }) => {
    const collectedRef = useRef(false);
    const collect = () => {
        if (collectedRef.current) return;
        collectedRef.current = true;
        useGameStore.getState().collectFood(data.id);
    };

    const [ref] = useSphere(() => ({
        mass: 1,
        position: data.position,
        args: [0.3],
        type: 'Dynamic',
        linearDamping: 0.4,
        angularDamping: 0.4,
        onCollide: (e) => {
            if (e.body && e.body.userData && (e.body.userData as any).tag === 'player') collect();
        }
    }));

    // Register the live body so a save captures its real position
    useEffect(() => {
        // @ts-ignore
        const mesh = ref.current as THREE.Object3D | null;
        if (mesh) liveObjects.food.set(data.id, mesh);
        return () => { liveObjects.food.delete(data.id); };
    }, [data.id]);

    // Proximity pick-up - robust fallback for the kinematic player body
    const foodPos = useMemo(() => new THREE.Vector3(), []);
    useFrame(() => {
        // @ts-ignore
        const mesh = ref.current as THREE.Object3D | null;
        if (!mesh || collectedRef.current) return;
        const s = useGameStore.getState();
        if (s.isPaused || s.phase !== 'PLAYING') return;
        if (readBodyPosition(mesh, foodPos).distanceTo(currentWoodchuckPos) < FOOD_PICKUP_RADIUS) collect();
    });

    return (
        <mesh ref={ref as any} castShadow>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshStandardMaterial color={data.type === 'apple' ? '#FF0000' : '#9C27B0'} emissive={data.type === 'apple' ? '#550000' : '#330033'} />
            <mesh position={[0, 0.3, 0]}>
                <cylinderGeometry args={[0.05, 0.05, 0.2]} />
                <meshStandardMaterial color="#3E2723" />
            </mesh>
        </mesh>
    );
});

// =====================================================================
// Mobs (restored) - wolves & bears hunt at night, can't follow Chucky into the river
// =====================================================================
const MobRenderer = React.memo(({ data }: { data: MobData }) => {
    const touchingRef = useRef(false);
    const lastHitRef = useRef(0);
    const hitsLeftRef = useRef(MOB_HITS_TO_CHASE[data.type]);
    const stunUntilRef = useRef(0);
    const flashUntilRef = useRef(0);
    const bodyMatRef = useRef<THREE.MeshStandardMaterial>(null);
    const livePos = useMemo(() => new THREE.Vector3(), []);

    const [ref, api] = useSphere(() => ({
        mass: 10,
        position: data.position,
        args: [0.5],
        type: 'Dynamic',
        linearDamping: 0.5,
        fixedRotation: true,
        onCollide: (e) => {
            if (e.body && e.body.userData && (e.body.userData as any).tag === 'player') touchingRef.current = true;
        }
    }));

    const vy = useRef(0);
    useEffect(() => api.velocity.subscribe(v => { vy.current = v[1]; }), [api.velocity]);

    // Thrown logs check this registry: a hit dazes and knocks the mob back; enough hits chase it off
    useEffect(() => {
        const mesh = ref.current as THREE.Object3D | null;
        if (!mesh) return;
        liveObjects.mobs.set(data.id, {
            object: mesh,
            hit: (dirX: number, dirZ: number) => {
                const now = Date.now();
                stunUntilRef.current = now + MOB_THROW_STUN_TIME;
                flashUntilRef.current = now + 250;
                api.applyImpulse([dirX * MOB_THROW_KNOCKBACK, 25, dirZ * MOB_THROW_KNOCKBACK], [0, 0, 0]);
                hitsLeftRef.current -= 1;
                if (hitsLeftRef.current <= 0) useGameStore.getState().defeatMob(data.id);
            },
        });
        return () => { liveObjects.mobs.delete(data.id); };
    }, [data.id, api]);

    useFrame(() => {
        // @ts-ignore
        const mesh = ref.current as THREE.Object3D | null;
        if (!mesh) return;
        const s = useGameStore.getState();

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

        const dx = currentWoodchuckPos.x - pos.x;
        const dz = currentWoodchuckPos.z - pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const now = Date.now();

        // Flash red when hit by a log; dazed mobs don't move or attack
        if (bodyMatRef.current) bodyMatRef.current.emissive.setHex(now < flashUntilRef.current ? 0x991111 : 0x000000);
        if (now < stunUntilRef.current) {
            touchingRef.current = false;
            return;
        }

        // Attack (collision or proximity), with a per-mob cooldown
        const touching = touchingRef.current || dist < MOB_HIT_RANGE;
        touchingRef.current = false;
        if (touching && now - lastHitRef.current > MOB_HIT_COOLDOWN) {
            lastHitRef.current = now;
            s.takeDamage(MOB_DAMAGE[data.type]);
            if (dist > 0.001) {
                api.applyImpulse([(-dx / dist) * MOB_KNOCKBACK, 0, (-dz / dist) * MOB_KNOCKBACK], [0, 0, 0]);
            }
        }

        // Back off briefly after landing a hit
        if (now - lastHitRef.current < MOB_STUN_TIME) return;

        if (dist > 1 && dist < MOB_AGGRO_RANGE) {
            const dirX = dx / dist;
            const dirZ = dz / dist;

            // Land animals: stop at the river bank instead of wading in
            const aheadH = calculateTerrainHeight(pos.x + dirX * 1.5, pos.z + dirZ * 1.5);
            if (aheadH < WATER_LEVEL) {
                api.velocity.set(0, vy.current, 0);
            } else {
                let speed = MOB_SPEED[data.type];
                if (dist < MOB_LUNGE_RANGE) speed *= MOB_LUNGE_MULTIPLIER;
                api.velocity.set(dirX * speed, vy.current, dirZ * speed);
            }
            api.rotation.set(0, Math.atan2(dx, dz), 0);
        } else {
            api.velocity.set(0, vy.current, 0);
        }
    });

    return (
        <mesh ref={ref as any} castShadow>
            <sphereGeometry args={[0.5, 16, 16]} />
            <meshStandardMaterial ref={bodyMatRef} color={data.type === 'wolf' ? '#555' : '#3E2723'} />
            <mesh position={[0.2, 0.2, 0.4]}>
                <sphereGeometry args={[0.1]} />
                <meshBasicMaterial color="red" />
            </mesh>
            <mesh position={[-0.2, 0.2, 0.4]}>
                <sphereGeometry args={[0.1]} />
                <meshBasicMaterial color="red" />
            </mesh>
        </mesh>
    );
});

// =====================================================================
// Grass - only around Chucky. The world is split into GRASS_TILE-sized tiles; the
// tilesAcross x tilesAcross tiles around Chucky's tile are drawn. Each tile's blades
// are generated from the tile's coordinates (same grass every time you come back).
// Slots are reused like a ring buffer: when Chucky crosses into a new tile only the
// row/column of tiles that came into range is rebuilt and uploaded. Blades shrink
// into the ground towards the edge of the window, so it has no visible border.
// =====================================================================
const tileHash = (x: number, z: number) => {
    let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
};
const wrapIndex = (v: number, n: number) => ((v % n) + n) % n;
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
const EMPTY_SLOT = 0x7fffffff;

const Grass = ({ quality }: { quality: GraphicsQuality }) => {
    const { tilesAcross, bladesPerTile } = GRASS_QUALITY[quality];
    const tileCount = tilesAcross * tilesAcross;
    const count = tileCount * bladesPerTile;
    const half = Math.floor(tilesAcross / 2);
    const fadeRadius = half * GRASS_TILE - 1; // Chucky is always at least half*TILE from the window edge

    const meshRef = useRef<THREE.InstancedMesh>(null);
    const slotTiles = useMemo(() => new Int32Array(tileCount * 2).fill(EMPTY_SLOT), [tileCount]);
    const lastTile = useRef<[number, number] | null>(null);
    const dummy = useMemo(() => new THREE.Object3D(), []);

    // Blade base at y = 0 so it stands on the ground and fades into it
    const geometry = useMemo(() => {
        const g = new THREE.PlaneGeometry(0.15, 1, 1, 4);
        g.translate(0, 0.5, 0);
        return g;
    }, []);
    useEffect(() => () => geometry.dispose(), [geometry]);

    // Hide every blade until its tile has been filled
    useEffect(() => {
        const mesh = meshRef.current;
        if (!mesh) return;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < count; i++) mesh.setMatrixAt(i, ZERO_MATRIX);
        mesh.instanceMatrix.needsUpdate = true;
    }, [count]);

    const fillTile = (mesh: THREE.InstancedMesh, slot: number, tx: number, tz: number) => {
        let seed = tileHash(tx, tz) || 1;
        const rand = () => {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const limit = MAP_SIZE / 2;
        const base = slot * bladesPerTile;
        for (let i = 0; i < bladesPerTile; i++) {
            // Always draw the same 5 numbers per blade, so a tile's grass never changes
            const x = (tx + rand()) * GRASS_TILE;
            const z = (tz + rand()) * GRASS_TILE;
            const rotation = rand() * Math.PI;
            const scaleY = 0.5 + rand() * 1.0;
            const scaleXZ = 0.5 + rand() * 0.5;

            // Patchy distribution, only on land, only on the map
            const noise = Math.sin(x * 0.1) * Math.cos(z * 0.1) + Math.sin(x * 0.3 + z * 0.2);
            const y = noise < -0.5 || Math.abs(x) > limit || Math.abs(z) > limit ? -Infinity : calculateTerrainHeight(x, z);
            if (y > WATER_LEVEL + 0.2) {
                dummy.position.set(x, y, z);
                dummy.rotation.set(0, rotation, 0);
                dummy.scale.set(scaleXZ, scaleY, scaleXZ);
                dummy.updateMatrix();
                mesh.setMatrixAt(base + i, dummy.matrix);
            } else {
                mesh.setMatrixAt(base + i, ZERO_MATRIX);
            }
        }
    };

    const uniforms = useMemo(() => ({
        time: { value: 0 },
        playerPos: { value: new THREE.Vector3() },
        fadeRadius: { value: fadeRadius },
    }), [fadeRadius]);

    useFrame((state) => {
        uniforms.time.value = state.clock.elapsedTime;
        uniforms.playerPos.value.copy(currentWoodchuckPos);

        const mesh = meshRef.current;
        const p = currentWoodchuckPos;
        if (!mesh || (p.x === 0 && p.y === 0 && p.z === 0)) return; // Not spawned yet
        const cx = Math.floor(p.x / GRASS_TILE);
        const cz = Math.floor(p.z / GRASS_TILE);
        const last = lastTile.current;
        if (last && last[0] === cx && last[1] === cz) return;
        lastTile.current = [cx, cz];

        const attr = mesh.instanceMatrix;
        attr.clearUpdateRanges();
        let changed = 0;
        for (let dz = -half; dz <= half; dz++) {
            for (let dx = -half; dx <= half; dx++) {
                const tx = cx + dx;
                const tz = cz + dz;
                const slot = wrapIndex(tx, tilesAcross) + wrapIndex(tz, tilesAcross) * tilesAcross;
                if (slotTiles[slot * 2] === tx && slotTiles[slot * 2 + 1] === tz) continue;
                slotTiles[slot * 2] = tx;
                slotTiles[slot * 2 + 1] = tz;
                fillTile(mesh, slot, tx, tz);
                attr.addUpdateRange(slot * bladesPerTile * 16, bladesPerTile * 16);
                changed++;
            }
        }
        if (changed === 0) return;
        if (changed > tileCount / 2) attr.clearUpdateRanges(); // Mostly new (spawn / load): upload it all
        attr.needsUpdate = true;
    });

    const onBeforeCompile = (shader: any) => {
        shader.uniforms.time = uniforms.time;
        shader.uniforms.playerPos = uniforms.playerPos;
        shader.uniforms.fadeRadius = uniforms.fadeRadius;
        shader.vertexShader = `
            uniform float time;
            uniform vec3 playerPos;
            uniform float fadeRadius;
            ${shader.vertexShader}
        `.replace(
            '#include <begin_vertex>',
            `
            #include <begin_vertex>
            vec4 worldPos = instanceMatrix * vec4(position, 1.0);
            float dist = distance(worldPos.xz, playerPos.xz);

            // Shrink into the ground towards the edge of the grass window
            trsformed *= 1.0 - smoothstep(fadeRadius * 0.75, fadeRadius, dist);

            // Sway (only the top of the blade moves)
            float sway = sin(time * 2.0 + worldPos.x * 0.5 + worldPos.z * 0.5) * 0.2;
            transformed.x += sway * uv.y;

            // Push away from Chucky
            if (dist < 2.0) {
                vec3 dir = normalize(worldPos.xyz - playerPos);
                float force = (2.0 - dist) / 2.0;
                transformed.x += dir.x * force * 1.5 * uv.y;
                transformed.z += dir.z * force * 1.5 * uv.y;
                transformed.y -= force * 0.5 * uv.y;
            }
            `
        );
    };

    return (
        <instancedMesh ref={meshRef} args={[geometry, undefined, count]} receiveShadow frustumCulled={false}>
            <meshStandardMaterial
                color="#66bb6a"
                side={THREE.DoubleSide}
                onBeforeCompile={onBeforeCompile}
                transparent
                alphaTest={0.5}
            />
        </instancedMesh>
    );
};

// =====================================================================
// Environment sounds: tell the audio service how close the river is, day/night, underwater
// =====================================================================
const AMBIENT_UPDATE_INTERVAL = 0.25; // s

const AmbientAudioManager = () => {
    const elapsed = useRef(AMBIENT_UPDATE_INTERVAL);
    useFrame((_, delta) => {
        elapsed.current += delta;
        if (elapsed.current < AMBIENT_UPDATE_INTERVAL) return;
        elapsed.current = 0;
        const p = currentWoodchuckPos;
        const s = useGameStore.getState();
        audioService.updateEnvironment({
            riverDistance: Math.max(0, Math.abs(p.x - getRiverX(p.z)) - getRiverWidth(p.z)),
            isNight: isNightTime(s.timeOfDay),
            isUnderwater: s.isInWater && p.y < WATER_LEVEL - 0.2,
        });
    });
    return null;
};

// =====================================================================
// Main Game Component
// =====================================================================
const GameScene = () => {
    const trees = useGameStore(state => state.trees);
    const logs = useGameStore(state => state.logs);
    const looseLogs = useGameStore(state => state.looseLogs);
    const boulders = useGameStore(state => state.boulders);
    const placedStructures = useGameStore(state => state.placedStructures);
    const blueprints = useGameStore(state => state.blueprints);
    const food = useGameStore(state => state.food);
    const mobs = useGameStore(state => state.mobs);
    const quality = useGameStore(state => state.quality);
    const qualitySettings = QUALITY_SETTINGS[quality];

    // Audio Init
    useEffect(() => {
        const handleInteract = () => {
            audioService.resume();
            window.removeEventListener('click', handleInteract);
            window.removeEventListener('keydown', handleInteract);
            window.removeEventListener('touchstart', handleInteract);
        };
        window.addEventListener('click', handleInteract);
        window.addEventListener('keydown', handleInteract);
        window.addEventListener('touchstart', handleInteract);
        return () => {
            window.removeEventListener('click', handleInteract);
            window.removeEventListener('keydown', handleInteract);
            window.removeEventListener('touchstart', handleInteract);
        };
    }, []);

    return (
        <div className="w-full h-full bg-black">
            <Canvas shadows dpr={qualitySettings.dpr} camera={{ position: [0, 15, 20], fov: 50 }}>
                <TimeManager />
                <DestructionManager />
                <AmbientAudioManager />
                <DayNightCycle shadowMapSize={qualitySettings.shadowMap} />

                {qualitySettings.clouds && (
                    <OptionalBoundary>
                        <Suspense fallback={null}>
                            <Cloud opacity={0.5} speed={0.4} bounds={[10, 1.5, 1.5]} segments={20} position={[0, 20, -10]} />
                            <Cloud opacity={0.3} speed={0.1} bounds={[50, 20, 20]} segments={10} position={[40, 25, -50]} />
                        </Suspense>
                    </OptionalBoundary>
                )}

                <Physics gravity={[0, -20, 0]}>
                    <Terrain />
                    <Water />

                    {/* World Objects */}
                    {boulders.map(b => <Boulder key={b.id} data={b} />)}
                    {/* isFelled in the key: the stump needs a freshly-created (short) physics body */}
                    {trees.map(t => <Tree key={`${t.id}-${t.isFelled ? 'stump' : 'tree'}`} data={t} />)}
                    {logs.map(l => <Log key={l.id} data={l} />)}
                    {looseLogs.map(l => <LooseLog key={l.id} data={l} />)}
                    {food.map(f => <Food key={f.id} data={f} />)}
                    {placedStructures.map(s => <PlacedStructureRenderer key={s.id} data={s} blueprints={blueprints} />)}
                    {mobs.map(m => <MobRenderer key={m.id} data={m} />)}

                    {/* Player */}
                    <Woodchuck />
                </Physics>

                <Grass key={quality} quality={quality} />
                <CameraController />

                {/* Effects */}
                <Sparkles count={50} scale={12} size={4} speed={0.4} opacity={0.5} color="#FFD700" position={[0, 5, 0]} />
            </Canvas>
        </div>
    );
};

// Memoised: App re-renders (HUD changes) must not re-render the whole 3D scene
export const Game3D = React.memo(GameScene);
