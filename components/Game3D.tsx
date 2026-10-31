import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Physics, useSphere } from '@react-three/cannon';
import { Sky, Stars, Cloud, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore, calculateTerrainHeight, isNightTime, MAP_SIZE } from '../store';
import { audioService } from '../services/audio';
import { Terrain } from './Terrain';
import { Water } from './Water';
import { Boulder, Tree, Log, LooseLog, PlacedStructureRenderer } from './WorldObjects';
import { Woodchuck } from './Woodchuck';
import { FoodData, MobData } from '../types';
import { currentWoodchuckPos, liveObjects } from '../globals';

const WATER_LEVEL = -1.5;
const MAX_FRAME_DELTA = 0.1;

// --- Lighting ---
const SUN_DISTANCE = 100;
const SHADOW_EXTENT = 60; // Shadow camera half-size around Chucky (the sun follows him)

// --- Grass ---
const GRASS_COUNT = 40000;

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
const CAMERA_MODES: Record<string, { offset: [number, number, number]; speed: number; absoluteY?: boolean }> = {
    FOLLOW:    { offset: [0, 20, 40], speed: 3 },
    BEHIND:    { offset: [0, 12, 25], speed: 5 },
    TOP_DOWN:  { offset: [0, 40, 5],  speed: 2, absoluteY: true },
    CINEMATIC: { offset: [45, 15, 0], speed: 2 },
};

const CameraController = () => {
    const { camera } = useThree();
    const desired = useMemo(() => new THREE.Vector3(), []);
    const lookTarget = useMemo(() => new THREE.Vector3(), []);

    useFrame((state, rawDelta) => {
        const { x, y, z } = currentWoodchuckPos;
        if (x === 0 && y === 0 && z === 0) return; // Skip until the woodchuck has spawned
        const delta = Math.min(rawDelta, MAX_FRAME_DELTA);

        const mode = CAMERA_MODES[useGameStore.getState().cameraMode] || CAMERA_MODES.FOLLOW;
        const [ox, oy, oz] = mode.offset;
        desired.set(x + ox, mode.absoluteY ? oy : y + oy, z + oz);

        // Never dip below the terrain (hills / mountain rim)
        const groundY = calculateTerrainHeight(desired.x, desired.z) + 2;
        if (desired.y < groundY) desired.y = groundY;

        camera.position.lerp(desired, 1 - Math.exp(-mode.speed * delta));
        lookTarget.set(x, y, z);
        camera.lookAt(lookTarget);
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
const DayNightCycle = () => {
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

        if (sunRef.current) {
            sunRef.current.position.set(p.x + sX, p.y + sY, p.z + sZ);
            sunRef.current.intensity = sunIntensity;
        }
        if (moonLightRef.current) {
            moonLightRef.current.position.set(p.x - sX, p.y - sY, p.z);
            moonLightRef.current.intensity = moonIntensity;
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
                shadow-mapSize={[2048, 2048]}
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
                shadow-mapSize={[1024, 1024]}
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
    useFrame(() => {
        // @ts-ignore
        const mesh = ref.current as THREE.Object3D | null;
        if (!mesh || collectedRef.current) return;
        const s = useGameStore.getState();
        if (s.isPaused || s.phase !== 'PLAYING') return;
        if (mesh.position.distanceTo(currentWoodchuckPos) < FOOD_PICKUP_RADIUS) collect();
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

        const pos = mesh.position;
        if (pos.y < -30) {
            s.removeMob(data.id);
            return;
        }

        const dx = currentWoodchuckPos.x - pos.x;
        const dz = currentWoodchuckPos.z - pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const now = Date.now();

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
            <meshStandardMaterial color={data.type === 'wolf' ? '#555' : '#3E2723'} />
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
// Grass (restored) - instanced blades with sway + push-away around Chucky
// =====================================================================
const Grass = () => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const materialRef = useRef<THREE.MeshStandardMaterial>(null);

    const instances = useMemo(() => {
        const temp: THREE.Matrix4[] = [];
        const dummy = new THREE.Object3D();

        for (let i = 0; i < GRASS_COUNT; i++) {
            const x = (Math.random() - 0.5) * MAP_SIZE;
            const z = (Math.random() - 0.5) * MAP_SIZE;

            // Patchy distribution
            const noise = Math.sin(x * 0.1) * Math.cos(z * 0.1) + Math.sin(x * 0.3 + z * 0.2);
            if (noise < -0.5) continue;

            const y = calculateTerrainHeight(x, z);
            if (y > WATER_LEVEL + 0.2) { // Only on land
                dummy.position.set(x, y + 0.5, z);
                dummy.rotation.set(0, Math.random() * Math.PI, 0);
                const scaleY = 0.5 + Math.random() * 1.0;
                const scaleXZ = 0.5 + Math.random() * 0.5;
                dummy.scale.set(scaleXZ, scaleY, scaleXZ);
                dummy.updateMatrix();
                temp.push(dummy.matrix.clone());
            }
        }
        return temp;
    }, []);

    useEffect(() => {
        if (meshRef.current) {
            instances.forEach((matrix, i) => meshRef.current!.setMatrixAt(i, matrix));
            meshRef.current.instanceMatrix.needsUpdate = true;
        }
    }, [instances]);

    const uniforms = useMemo(() => ({
        time: { value: 0 },
        playerPos: { value: new THREE.Vector3() }
    }), []);

    useFrame((state) => {
        uniforms.time.value = state.clock.elapsedTime;
        uniforms.playerPos.value.copy(currentWoodchuckPos);
    });

    const onBeforeCompile = (shader: any) => {
        shader.uniforms.time = uniforms.time;
        shader.uniforms.playerPos = uniforms.playerPos;
        shader.vertexShader = `
            uniform float time;
            uniform vec3 playerPos;
            ${shader.vertexShader}
        `.replace(
            '#include <begin_vertex>',
            `
            #include <begin_vertex>
            vec4 worldPos = instanceMatrix * vec4(position, 1.0);

            // Sway (only the top of the blade moves)
            float sway = sin(time * 2.0 + worldPos.x * 0.5 + worldPos.z * 0.5) * 0.2;
            transformed.x += sway * uv.y;

            // Push away from Chucky
            float dist = distance(worldPos.xz, playerPos.xz);
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
        <instancedMesh ref={meshRef} args={[undefined, undefined, instances.length]} receiveShadow frustumCulled={false}>
            <planeGeometry args={[0.15, 1, 1, 4]} />
            <meshStandardMaterial
                ref={materialRef}
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
            <Canvas shadows camera={{ position: [0, 15, 20], fov: 50 }}>
                <TimeManager />
                <DestructionManager />
                <DayNightCycle />

                <OptionalBoundary>
                    <Suspense fallback={null}>
                        <Cloud opacity={0.5} speed={0.4} bounds={[10, 1.5, 1.5]} segments={20} position={[0, 20, -10]} />
                        <Cloud opacity={0.3} speed={0.1} bounds={[50, 20, 20]} segments={10} position={[40, 25, -50]} />
                    </Suspense>
                </OptionalBoundary>

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

                <Grass />
                <CameraController />

                {/* Effects */}
                <Sparkles count={50} scale={12} size={4} speed={0.4} opacity={0.5} color="#FFD700" position={[0, 5, 0]} />
            </Canvas>
        </div>
    );
};

// Memoised: App re-renders (HUD changes) must not re-render the whole 3D scene
export const Game3D = React.memo(GameScene);
