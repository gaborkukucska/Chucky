import React, { useMemo, useRef, useEffect, useLayoutEffect, useState, forwardRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useSphere, useCylinder, useCompoundBody } from '@react-three/cannon';
import * as THREE from 'three';
import { useGameStore, getRiverWidth, calculateTerrainHeight, MAP_SIZE } from '../store';
import { TreeData, LogData, LooseLogData, BoulderData, PlacedStructure, Blueprint } from '../types';
import { currentWoodchuckPos, liveObjects } from '../globals';

const WATER_LEVEL = -1.5;
// Logs are picked up when Chucky's centre is this close (squared) - fallback to onCollide,
// which is not guaranteed for the kinematic player body.
const PICKUP_RADIUS_SQ = 1.4 * 1.4;

export const Boulder = React.memo(({ data }: { data: BoulderData }) => {
    const [ref] = useSphere(() => ({
        type: 'Static',
        mass: 0,
        position: data.position,
        args: [data.scale],
    }));

    return (
        <mesh ref={ref as any} castShadow receiveShadow>
            <icosahedronGeometry args={[data.scale, 1]} />
            <meshStandardMaterial color="#546E7A" flatShading />
        </mesh>
    );
});

export const Tree = React.memo(({ data }: { data: TreeData }) => {
    const y = useMemo(() => calculateTerrainHeight(data.position[0], data.position[2]), [data.position]);
    
    const scale = useMemo(() => {
        if (data.size === 'small') return 0.8;
        if (data.size === 'large') return 1.5;
        return 1.1;
    }, [data.size]);

    const trunkHeight = 4 * scale;
    const trunkRadius = 0.5 * scale;
    const physicsRadius = trunkRadius * 1.4;

    const [ref] = useCylinder(() => ({
        mass: 0, 
        type: 'Static',
        position: data.isFelled ? [data.position[0], y + 0.2, data.position[2]] : [data.position[0], y + trunkHeight/2, data.position[2]],
        args: data.isFelled ? [trunkRadius * 1.2, trunkRadius * 1.4, 0.4, 8] : [physicsRadius, physicsRadius, trunkHeight, 8], 
    }));

    if (data.isFelled) {
        return (
            <mesh ref={ref as any} castShadow receiveShadow>
                 <cylinderGeometry args={[trunkRadius * 1.2, trunkRadius * 1.4, 0.4, 8]} />
                 <meshStandardMaterial color="#5D4037" />
            </mesh>
        );
    }

    return (
        <group ref={ref as any}>
            <mesh castShadow receiveShadow>
                <cylinderGeometry args={[trunkRadius, trunkRadius * 1.5, trunkHeight, 8]} />
                <meshStandardMaterial color="#795548" />
            </mesh>
            <mesh position={[0, trunkHeight * 0.75, 0]} castShadow>
                <coneGeometry args={[2 * scale, 4 * scale, 8]} />
                <meshStandardMaterial color="#2E7D32" />
            </mesh>
            <mesh position={[0, trunkHeight * 1.25, 0]} castShadow>
                <coneGeometry args={[1.5 * scale, 3 * scale, 8]} />
                <meshStandardMaterial color="#388E3C" />
            </mesh>
        </group>
    );
});

// A placed log in the dam (Legacy - kept for compatibility if needed, but new system uses PlacedStructure)
export const Log = React.memo(({ data }: { data: LogData }) => {
    const collectLog = useGameStore(state => state.collectLog);
    const collectedRef = useRef(false);
    const [ref, api] = useCylinder(() => ({
        mass: 30, // Heavier than loose logs to be stable in dam
        position: data.position,
        rotation: data.rotation,
        args: [0.4, 0.4, 3, 8],
        linearDamping: 0.5, 
        angularDamping: 0.5,
        friction: 0.8, // Sticky
        onCollide: (e) => {
            if (e.body && e.body.userData && (e.body.userData as any).tag === 'player') {
                const age = Date.now() - data.createdAt;
                if (age > 2500 && !collectedRef.current) {
                    collectedRef.current = true;
                    collectLog(data.id);
                }
            }
        }
    }));

    const matRef = useRef<THREE.MeshStandardMaterial>(null);
    const magnetizedStartRef = useRef<number | null>(null);
    const isLogPowerupActive = useGameStore(state => state.isLogPowerupActive);

    useFrame((state) => {
        // @ts-ignore
        const mesh = ref.current;
        if (mesh) {
            const pos = mesh.position;
            const now = Date.now();
            const age = now - data.createdAt;

            // Proximity pick-up
            if (!collectedRef.current && age > (isLogPowerupActive ? 500 : 2500)) {
                const pdx = currentWoodchuckPos.x - pos.x;
                const pdy = currentWoodchuckPos.y - pos.y;
                const pdz = currentWoodchuckPos.z - pos.z;
                if (pdx * pdx + pdy * pdy + pdz * pdz < PICKUP_RADIUS_SQ) {
                    collectedRef.current = true;
                    collectLog(data.id);
                    return;
                }
            }
            // Log Magnet Powerup
            // Allow collection slightly earlier if magnet is active
            const magnetInvulnTime = 500; // Reduced further
            const normalInvulnTime = 2500;
            const effectiveInvuln = isLogPowerupActive ? magnetInvulnTime : normalInvulnTime;
            const isCollectable = age > effectiveInvuln;
            let isBeingMagnetized = false;

            if (isLogPowerupActive && isCollectable && !collectedRef.current) {
                // Use global position or fallback to store
                let targetX = 0;
                let targetY = 1.5;
                let targetZ = 0;
                
                const storePos = useGameStore.getState().woodchuckPosition;
                if (storePos) {
                    targetX = storePos[0];
                    targetY = storePos[1] + 1.5;
                    targetZ = storePos[2];
                }

                const dx = targetX - pos.x;
                const dy = targetY - pos.y;
                const dz = targetZ - pos.z;
                const distSq = dx*dx + dy*dy + dz*dz;
                
                if (distSq < 3600) { // 60 units radius (Huge)
                    if (magnetizedStartRef.current === null) {
                        magnetizedStartRef.current = state.clock.elapsedTime;
                    }
                    const elapsed = state.clock.elapsedTime - magnetizedStartRef.current;
                    
                    isBeingMagnetized = true;
                    
                    // Disable physics velocity
                    api.velocity.set(0, 0, 0);
                    
                    // Accelerate spin
                    // Base spin 10, add acceleration
                    const spinSpeed = 10 + (elapsed * 40); 
                    api.angularVelocity.set(0, spinSpeed, 0);
                    
                    // Lift up to hover height
                    const hoverY = targetY + 1.0;
                    const newY = THREE.MathUtils.lerp(pos.y, hoverY, 0.05);
                    
                    // Keep X/Z stable but maybe drift slightly to player?
                    // Just lift and spin for now as requested
                    api.position.set(pos.x, newY, pos.z);
                    api.wakeUp();
                    
                    if (elapsed > 1.0) {
                        collectedRef.current = true;
                        collectLog(data.id);
                    }
                } else {
                    magnetizedStartRef.current = null;
                }
            }

            // Visual Feedback
            if (matRef.current) {
                if (!isCollectable) {
                    // Flash Yellow/Gold while invulnerable
                    const flash = Math.floor(age / 150) % 2 === 0;
                    matRef.current.opacity = flash ? 0.8 : 0.3;
                    matRef.current.transparent = true;
                    matRef.current.color.setHex(0xFFD700); 
                    matRef.current.emissive.setHex(0xFFD700);
                    matRef.current.emissiveIntensity = flash ? 0.5 : 0.1;
                } else {
                    // Normal state
                    matRef.current.opacity = 1;
                    matRef.current.transparent = false;
                    matRef.current.color.setHex(0x5D4037);
                    matRef.current.emissive.setHex(0x000000);
                    matRef.current.emissiveIntensity = 0;
                }
            }

            const inWater = pos.y < WATER_LEVEL + 0.5;
            
            if (isBeingMagnetized) {
                // Skip water/terrain physics if being magnetized
            } else if (inWater) {
                // Slower flow for placed logs so they can form a structure
                const riverW = getRiverWidth(pos.z);
                const flowSpeed = 40 / Math.max(1, riverW); 
                
                const surfaceY = WATER_LEVEL + 0.5;
                const displacement = surfaceY - pos.y;
                const gravity = 20;
                const mass = 30;
                
                // High buoyancy for heavy logs
                const buoyancyFactor = 1200; 
                const bop = Math.sin(state.clock.elapsedTime * 1.5 + pos.x) * 15;
                let uplift = (gravity * mass) + (displacement * buoyancyFactor) + bop;

                if (displacement > 1.0) uplift *= 2.0;

                api.applyForce([0, uplift, 0], [pos.x, pos.y, pos.z]);
                api.applyForce([0, 0, flowSpeed * 0.4], [pos.x, pos.y, pos.z]); 
                
                // Low damping while rising, high when at surface
                const damping = displacement > 0.5 ? 0.2 : 0.8;
                api.linearDamping.set(damping);
                api.angularDamping.set(0.5);

                if (matRef.current && isCollectable) {
                    matRef.current.color.setHex(0x2D1B18); // Wet look
                    matRef.current.roughness = 0.1;
                }
            } else {
                api.linearDamping.set(0.1);
                api.angularDamping.set(0.1);
                if (matRef.current && isCollectable) {
                    matRef.current.color.setHex(0x5D4037);
                    matRef.current.roughness = 0.8;
                }
            }
        }
    });

    return (
        <mesh ref={ref as any} castShadow receiveShadow>
            <cylinderGeometry args={[0.4, 0.4, 3, 8]} />
            <meshStandardMaterial ref={matRef} color="#5D4037" />
            <mesh position={[0, 1.51, 0]} rotation={[Math.PI/2, 0, 0]}>
                 <circleGeometry args={[0.4, 8]} />
                 <meshStandardMaterial color="#8D6E63" />
            </mesh>
            <mesh position={[0, -1.51, 0]} rotation={[Math.PI/2, 0, 0]}>
                 <circleGeometry args={[0.4, 8]} />
                 <meshStandardMaterial color="#8D6E63" />
            </mesh>
        </mesh>
    );
});

// A loose log floating down the river
// Demolition debris comes as bundles worth several logs: a bit bigger, tied with twine
const looseLogSize = (value: number) => value > 1 ? { radius: 0.45, length: 2.6, mass: 4 } : { radius: 0.3, length: 2, mass: 2 };

export const LooseLog = React.memo(({ data }: { data: LooseLogData }) => {
    const collectLooseLog = useGameStore(state => state.collectLooseLog);
    const expireLooseLog = useGameStore(state => state.expireLooseLog);
    const isPaused = useGameStore(state => state.isPaused);
    const collectedRef = useRef(false);
    const value = data.value ?? 1;
    const size = looseLogSize(value);
    // Only send damping to the physics worker when it changes (was 2 messages per log per frame)
    const dampingRef = useRef({ linear: -1, angular: -1 });
    
    const [ref, api] = useCylinder(() => ({
        mass: size.mass, 
        position: data.position,
        rotation: data.rotation,
        args: [size.radius, size.radius, size.length, 8],
        linearDamping: 0.1, 
        angularDamping: 0.1,
        onCollide: (e) => {
            if (e.body && e.body.userData && (e.body.userData as any).tag === 'player') {
                const age = Date.now() - data.createdAt;
                if (age > 2500 && !collectedRef.current) {
                    collectedRef.current = true;
                    collectLooseLog(data.id);
                }
            }
        }
    }));

    const matRef = useRef<THREE.MeshStandardMaterial>(null);
    const magnetizedStartRef = useRef<number | null>(null);
    const isLogPowerupActive = useGameStore(state => state.isLogPowerupActive);

    // Helpers
    const helper = useMemo(() => ({
        up: new THREE.Vector3(0, 1, 0),
        tempVec: new THREE.Vector3(),
        localY: new THREE.Vector3()
    }), []);

    // Register the live body so a save captures its real position
    useEffect(() => {
        const mesh = ref.current as THREE.Object3D | null;
        if (mesh) liveObjects.looseLogs.set(data.id, mesh);
        return () => { liveObjects.looseLogs.delete(data.id); };
    }, [data.id]);

    // Initial "Pop" Explosion (skipped for logs restored from a save)
    useEffect(() => {
        if (data.settled) return;
        const angle = Math.random() * Math.PI * 2;
        // Increased force to scatter more
        const force = 10 + Math.random() * 8; 
        const upForce = 8 + Math.random() * 6; 

        api.velocity.set(
            Math.cos(angle) * force, 
            upForce, 
            Math.sin(angle) * force
        );

        api.angularVelocity.set(
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 20
        );
    }, [api]);

    const setDamping = (linear: number, angular: number) => {
        if (dampingRef.current.linear !== linear) {
            dampingRef.current.linear = linear;
            api.linearDamping.set(linear);
        }
        if (dampingRef.current.angular !== angular) {
            dampingRef.current.angular = angular;
            api.angularDamping.set(angular);
        }
    };

    useFrame((state) => {
        if (isPaused) {
            api.velocity.set(0, 0, 0);
            api.angularVelocity.set(0, 0, 0);
            return;
        }
        
        // @ts-ignore
        const mesh = ref.current;
        if (mesh) {
            const pos = mesh.position;
            const now = Date.now();
            const age = now - data.createdAt;

            if (age > 120000) {
                expireLooseLog(data.id);
                return;
            }

            // Drifted off the map (down the river / over the edge): it's gone
            if (Math.abs(pos.x) > MAP_SIZE / 2 - 2 || Math.abs(pos.z) > MAP_SIZE / 2 - 2 || pos.y < -40) {
                expireLooseLog(data.id);
                return;
            }

            // Proximity pick-up
            if (!collectedRef.current && age > (isLogPowerupActive ? 500 : 2500)) {
                const pdx = currentWoodchuckPos.x - pos.x;
                const pdy = currentWoodchuckPos.y - pos.y;
                const pdz = currentWoodchuckPos.z - pos.z;
                if (pdx * pdx + pdy * pdy + pdz * pdz < PICKUP_RADIUS_SQ) {
                    collectedRef.current = true;
                    collectLooseLog(data.id);
                    return;
                }
            }

            // Log Magnet Powerup
            // Allow collection slightly earlier if magnet is active
            const magnetInvulnTime = 500; // Reduced further
            const normalInvulnTime = 2500;
            const effectiveInvuln = isLogPowerupActive ? magnetInvulnTime : normalInvulnTime;
            const isCollectable = age > effectiveInvuln;
            let isBeingMagnetized = false;

            if (isLogPowerupActive && isCollectable && !collectedRef.current) {
                // Use global position or fallback to store
                let targetX = 0;
                let targetY = 1.5;
                let targetZ = 0;
                
                const storePos = useGameStore.getState().woodchuckPosition;
                if (storePos) {
                    targetX = storePos[0];
                    targetY = storePos[1] + 1.5;
                    targetZ = storePos[2];
                }

                const dx = targetX - pos.x;
                const dy = targetY - pos.y;
                const dz = targetZ - pos.z;
                const distSq = dx*dx + dy*dy + dz*dz;
                
                if (distSq < 3600) { // 60 units radius
                    if (magnetizedStartRef.current === null) {
                        magnetizedStartRef.current = state.clock.elapsedTime;
                    }
                    const elapsed = state.clock.elapsedTime - magnetizedStartRef.current;
                    
                    isBeingMagnetized = true;
                    
                    // Disable physics velocity
                    api.velocity.set(0, 0, 0);
                    
                    // Accelerate spin
                    // Base spin 10, add acceleration
                    const spinSpeed = 10 + (elapsed * 40); 
                    api.angularVelocity.set(0, spinSpeed, 0);
                    
                    // Lift up to hover height
                    const hoverY = targetY + 1.0;
                    const newY = THREE.MathUtils.lerp(pos.y, hoverY, 0.05);
                    
                    // Keep X/Z stable
                    api.position.set(pos.x, newY, pos.z);
                    api.wakeUp();
                    
                    if (elapsed > 1.0) {
                        collectedRef.current = true;
                        collectLooseLog(data.id);
                    }
                } else {
                    magnetizedStartRef.current = null;
                }
            }

            // Visual Feedback
            if (matRef.current) {
                if (!isCollectable) {
                    // Flash Yellow/Gold while invulnerable
                    const flash = Math.floor(age / 150) % 2 === 0;
                    matRef.current.opacity = flash ? 0.8 : 0.3;
                    matRef.current.transparent = true;
                    matRef.current.color.setHex(0xFFD700); 
                    matRef.current.emissive.setHex(0xFFD700);
                    matRef.current.emissiveIntensity = flash ? 0.5 : 0.1;
                } else if (age > 110000) {
                    // Flash Red when about to expire
                    const flash = Math.floor(age / 250) % 2 === 0;
                    matRef.current.opacity = flash ? 0.9 : 0.4;
                    matRef.current.transparent = true;
                    matRef.current.color.setHex(0xFF0000);
                    matRef.current.emissive.setHex(0x550000);
                    matRef.current.emissiveIntensity = 0.2;
                } else {
                    // Normal state
                    matRef.current.opacity = 1;
                    matRef.current.transparent = false;
                    matRef.current.color.setHex(0x8D6E63);
                    matRef.current.emissive.setHex(0x000000);
                    matRef.current.emissiveIntensity = 0;
                }
            }

            // --- Improved Water Physics ---
            // Check intersection with water level
            const surfaceY = WATER_LEVEL + 0.6; // Higher target for loose logs
            const inWater = pos.y < surfaceY;

            if (isBeingMagnetized) {
                // Skip water/terrain physics if being magnetized
                // We already set velocity above
            } else if (inWater) { 
                 const riverW = getRiverWidth(pos.z);
                 const flowSpeed = 90 / Math.max(1, riverW); 

                 const displacement = surfaceY - pos.y;
                 
                 const gravity = 20;
                 const mass = size.mass;
                 // Force required to hold mass up = gravity * mass.
                 // High buoyancy factor for snappy surface return
                 const buoyancyFactor = 1000; // Even higher
                 
                 // Procedural bop function for surface floating
                 const bop = Math.sin(state.clock.elapsedTime * 3 + pos.x * 0.5) * 4 * mass;
                 let uplift = (gravity * mass) + (displacement * buoyancyFactor) + bop;
                 
                 // If very deep, apply a strong upward impulse to "pop" it up
                 if (displacement > 1.0) {
                    uplift *= 3.0;
                 }

                 api.applyForce([0, uplift * (mass / 2), 0], [pos.x, pos.y, pos.z]); 
                 api.applyForce([0, 0, flowSpeed * (mass / 2)], [pos.x, pos.y, pos.z]);

                 // Orientation Correction (Torque to Horizontal)
                 const localY = helper.localY.set(0, 1, 0).applyQuaternion(mesh.quaternion);
                 const alignment = localY.dot(helper.up); 

                 if (Math.abs(alignment) > 0.05) {
                    helper.tempVec.crossVectors(localY, helper.up).normalize();
                    if (helper.tempVec.lengthSq() < 0.01) {
                         helper.tempVec.set(1, 0, 0); 
                    }
                    const torqueStrength = 40 * mass * Math.abs(alignment);
                    api.applyTorque([
                        helper.tempVec.x * torqueStrength, 
                        0, 
                        helper.tempVec.z * torqueStrength
                    ]);
                 }

                 // Adaptive damping: Very low when submerged
                 setDamping(displacement > 0.4 ? 0.1 : 0.6, 0.3);

                 // Visual "Wet" look - Darker and shinier
                 if (matRef.current && isCollectable && age <= 110000) {
                     matRef.current.color.setHex(0x1A0F0E); // Deep wet wood
                     matRef.current.roughness = 0.02;
                     matRef.current.metalness = 0.6;
                     matRef.current.emissive.setHex(0x330000);
                     matRef.current.emissiveIntensity = 0.3;
                 }
            } else {
                 // Land physics
                 const terrainH = calculateTerrainHeight(pos.x, pos.z);
                 if (pos.y < -30) {
                    api.position.set(pos.x, terrainH + 2.0, pos.z);
                    api.velocity.set(0, 0, 0);
                 }
                 
                 setDamping(0.1, 0.1);
                 
                 // Normal wood look
                 if (matRef.current && isCollectable && age <= 110000) {
                    matRef.current.color.setHex(0x8D6E63);
                    matRef.current.roughness = 0.8;
                    matRef.current.metalness = 0;
                    matRef.current.emissive.setHex(0x000000);
                    matRef.current.emissiveIntensity = 0;
                 }
            }
        }
    });

    const half = size.length / 2 + 0.01;
    return (
        <mesh ref={ref as any} castShadow receiveShadow>
            <cylinderGeometry args={[size.radius, size.radius, size.length, 8]} />
            <meshStandardMaterial ref={matRef} color="#8D6E63" />
            <mesh position={[0, half, 0]} rotation={[Math.PI/2, 0, 0]}>
                 <circleGeometry args={[size.radius, 8]} />
                 <meshStandardMaterial color="#A1887F" />
            </mesh>
            <mesh position={[0, -half, 0]} rotation={[Math.PI/2, 0, 0]}>
                 <circleGeometry args={[size.radius, 8]} />
                 <meshStandardMaterial color="#A1887F" />
            </mesh>
            {value > 1 && (
                // Twine bands mark a bundle
                <>
                    <mesh position={[0, size.length * 0.25, 0]}>
                        <cylinderGeometry args={[size.radius + 0.03, size.radius + 0.03, 0.18, 8]} />
                        <meshStandardMaterial color="#D9B26F" />
                    </mesh>
                    <mesh position={[0, -size.length * 0.25, 0]}>
                        <cylinderGeometry args={[size.radius + 0.03, size.radius + 0.03, 0.18, 8]} />
                        <meshStandardMaterial color="#D9B26F" />
                    </mesh>
                </>
            )}
        </mesh>
    );
});

// =====================================================================
// Placed structures
// Rendering: ONE instanced draw call per structure (was 3 meshes per log -
// a 3,840-log structure meant ~11,500 meshes). Shared geometry/materials.
// Physics: cheap box shapes - one per log for small structures, one per
// layer for big ones (was a convex cylinder per log, which choked the
// physics worker). Chucky's own collision is handled in Woodchuck.tsx.
// =====================================================================
const STRUCTURE_LOG_RADIUS = 0.4;
const STRUCTURE_LOG_LENGTH = 3;
const PER_LOG_SHAPE_LIMIT = 24;   // Above this, approximate with one box per layer
const LAYER_HEIGHT = 0.35;        // Matches the blueprint generator in store.ts

// CylinderGeometry groups: 0 = side (bark), 1 = top cap, 2 = bottom cap (end grain)
const STRUCTURE_LOG_GEOMETRY = new THREE.CylinderGeometry(STRUCTURE_LOG_RADIUS, STRUCTURE_LOG_RADIUS, STRUCTURE_LOG_LENGTH, 8);
const BARK_MATERIAL = new THREE.MeshStandardMaterial({ color: '#5D4037' });
const END_GRAIN_MATERIAL = new THREE.MeshStandardMaterial({ color: '#8D6E63' });
const STRUCTURE_MATERIALS = [BARK_MATERIAL, END_GRAIN_MATERIAL, END_GRAIN_MATERIAL];
// Placement ghost: depth-tested so anything in front of it (Chucky, trees, terrain) hides it,
// and depth-writing so grass behind it doesn't show through. It's drawn before the water
// (PREVIEW_RENDER_ORDER), so parts below the river surface are still seen through the water.
const PREVIEW_VALID_MATERIAL = new THREE.MeshBasicMaterial({ color: '#00FFFF', transparent: true, opacity: 0.45, depthTest: true, depthWrite: true });
const PREVIEW_INVALID_MATERIAL = new THREE.MeshBasicMaterial({ color: '#FF3B30', transparent: true, opacity: 0.45, depthTest: true, depthWrite: true });
const PREVIEW_RENDER_ORDER = -1; // First of the see-through objects (water, grass are 0)

type BlueprintLog = Blueprint['logs'][number];

// One InstancedMesh for a list of logs (shared geometry + material, never disposed by R3F)
const InstancedLogs = ({ logs, material, castShadow = false, receiveShadow = false, renderOrder }: {
    logs: BlueprintLog[];
    material: THREE.Material | THREE.Material[];
    castShadow?: boolean;
    receiveShadow?: boolean;
    renderOrder?: number;
}) => {
    // The mesh is kept in state (callback ref): if React-Three-Fiber ever rebuilds it (its
    // args change, e.g. a different log count), the log positions are written again.
    // A rebuilt mesh starts with every instance at the same spot - which showed up as a
    // preview of a single log after the preview switched between cyan and red.
    const [mesh, setMesh] = useState<THREE.InstancedMesh | null>(null);

    useLayoutEffect(() => {
        if (!mesh) return;
        const dummy = new THREE.Object3D();
        logs.forEach((log, i) => {
            dummy.position.set(log.position[0], log.position[1], log.position[2]);
            dummy.rotation.set(log.rotation[0], log.rotation[1], log.rotation[2]);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere(); // Correct frustum culling for the whole structure
    }, [mesh, logs]);

    return (
        <instancedMesh
            ref={setMesh}
            // Only the log count is a constructor argument; the material is a normal prop so
            // switching it (cyan/red preview) doesn't rebuild the mesh
            args={[STRUCTURE_LOG_GEOMETRY, undefined, logs.length]}
            material={material as any}
            castShadow={castShadow}
            receiveShadow={receiveShadow}
            renderOrder={renderOrder}
            dispose={null}
        />
    );
};

// Physics shapes per blueprint (cached - blueprints never change within a world)
const shapeCache = new WeakMap<Blueprint, any[]>();
const _shapeEuler = new THREE.Euler();
const _shapeQuat = new THREE.Quaternion();
const _shapeAxis = new THREE.Vector3();

const buildStructureShapes = (blueprint: Blueprint) => {
    const cached = shapeCache.get(blueprint);
    if (cached) return cached;

    let shapes: any[];
    if (blueprint.logs.length <= PER_LOG_SHAPE_LIMIT) {
        // Small structures: one oriented box per log (logs are cylinders along local Y)
        shapes = blueprint.logs.map(log => ({
            type: 'Box',
            position: log.position,
            rotation: log.rotation,
            args: [STRUCTURE_LOG_RADIUS * 2, STRUCTURE_LOG_LENGTH, STRUCTURE_LOG_RADIUS * 2]
        }));
    } else {
        // Big structures: one axis-aligned box per layer covering that layer's logs
        const layers = new Map<number, { minX: number; maxX: number; minZ: number; maxZ: number; sumY: number; n: number }>();
        for (const log of blueprint.logs) {
            _shapeQuat.setFromEuler(_shapeEuler.set(log.rotation[0], log.rotation[1], log.rotation[2]));
            _shapeAxis.set(0, STRUCTURE_LOG_LENGTH / 2, 0).applyQuaternion(_shapeQuat);
            const ex = Math.abs(_shapeAxis.x) + STRUCTURE_LOG_RADIUS;
            const ez = Math.abs(_shapeAxis.z) + STRUCTURE_LOG_RADIUS;
            const key = Math.round(log.position[1] / LAYER_HEIGHT);
            const layer = layers.get(key) || { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, sumY: 0, n: 0 };
            layer.minX = Math.min(layer.minX, log.position[0] - ex);
            layer.maxX = Math.max(layer.maxX, log.position[0] + ex);
            layer.minZ = Math.min(layer.minZ, log.position[2] - ez);
            layer.maxZ = Math.max(layer.maxZ, log.position[2] + ez);
            layer.sumY += log.position[1];
            layer.n += 1;
            layers.set(key, layer);
        }
        shapes = Array.from(layers.values()).map(l => ({
            type: 'Box',
            position: [(l.minX + l.maxX) / 2, l.sumY / l.n, (l.minZ + l.maxZ) / 2],
            rotation: [0, 0, 0],
            args: [l.maxX - l.minX, STRUCTURE_LOG_RADIUS * 2, l.maxZ - l.minZ]
        }));
    }
    shapeCache.set(blueprint, shapes);
    return shapes;
};

export const PlacedStructureRenderer = React.memo(({ data, blueprints }: { data: PlacedStructure, blueprints: Blueprint[] }) => {
    const blueprint = blueprints.find(b => b.id === data.blueprintId);
    
    const shapes = useMemo(() => (blueprint ? buildStructureShapes(blueprint) : []), [blueprint]);

    // A structure never moves or changes shape (only its health), so the body is created once.
    // (The old code passed a deps array as the 2nd argument, which is actually the forwarded ref.)
    const [ref] = useCompoundBody(() => ({
        mass: 0, // Static
        type: 'Static',
        position: data.position,
        rotation: data.rotation,
        // @ts-ignore
        shapes: shapes,
        userData: { tag: 'structure', id: data.id }
    }));

    if (!blueprint) return null;

    return (
        <group ref={ref as any}>
            <InstancedLogs logs={blueprint.logs} material={STRUCTURE_MATERIALS} castShadow receiveShadow />
            {/* Health Bar Overlay if damaged */}
            {data.health < data.maxHealth && (
                <mesh position={[0, 5, 0]}>
                    <planeGeometry args={[4, 0.5]} />
                    <meshBasicMaterial color="red" />
                    <mesh position={[0, 0, 0.01]} scale={[data.health / data.maxHealth, 1, 1]}>
                        <planeGeometry args={[4, 0.5]} />
                        <meshBasicMaterial color="green" />
                    </mesh>
                </mesh>
            )}
        </group>
    );
});

// Placement ghost: one instanced, see-through mesh (was a mesh + Edges outline per log)
export const PreviewStructureOverlay = forwardRef<THREE.Group, { valid?: boolean }>(({ valid = true }, ref) => {
    const selectedBlueprintId = useGameStore(state => state.selectedBlueprintId);
    const blueprints = useGameStore(state => state.blueprints);
    const blueprint = blueprints.find(b => b.id === selectedBlueprintId);
    
    if (!blueprint) return null;

    return (
        <group ref={ref}>
            <InstancedLogs logs={blueprint.logs} material={valid ? PREVIEW_VALID_MATERIAL : PREVIEW_INVALID_MATERIAL} renderOrder={PREVIEW_RENDER_ORDER} />
        </group>
    );
});
