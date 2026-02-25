import React, { useEffect, useRef, useMemo, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Physics, usePlane, useBox, useCylinder, useSphere, useHeightfield } from '@react-three/cannon';
import { Sky, MeshDistortMaterial, Stars, Cloud, Text, Float, Icosahedron, Edges, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore, getRiverX, getRiverWidth, calculateTerrainHeight, MAP_SIZE } from '../store';
import { audioService } from '../services/audio';
import { TreeData, LogData, LooseLogData, BoulderData, PlacedStructure, Blueprint } from '../types';

// Constants
const MAP_RES = 128; // Higher res for larger map
const WATER_LEVEL = -1.5;

// Global tracker for Woodchuck position
const currentWoodchuckPos = new THREE.Vector3(0, 0, 0);

// --- Procedural Generation Helpers ---

const generateTerrainData = () => {
    const data: number[][] = [];
    const scale = MAP_SIZE / (MAP_RES - 1);

    for (let x = 0; x < MAP_RES; x++) {
        const row: number[] = [];
        for (let z = 0; z < MAP_RES; z++) {
            const worldX = (x - MAP_RES / 2) * scale;
            const worldZ = (z - MAP_RES / 2) * scale;
            row.push(calculateTerrainHeight(worldX, -worldZ)); 
        }
        data.push(row);
    }
    return { data, elementSize: scale };
};

// --- Components ---

const Terrain = () => {
  const { data, elementSize } = useMemo(() => generateTerrainData(), []);
  
  useHeightfield(() => ({
    args: [data, { elementSize }],
    rotation: [-Math.PI / 2, 0, 0], 
    position: [-(MAP_SIZE)/2, 0, (MAP_SIZE)/2], 
  }));

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, MAP_RES - 1, MAP_RES - 1);
    const posAttribute = geo.attributes.position;
    
    for (let i = 0; i < posAttribute.count; i++) {
        const x = posAttribute.getX(i);
        const y = posAttribute.getY(i); 
        const h = calculateTerrainHeight(x, -y);
        posAttribute.setZ(i, h); 
    }
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
       <meshStandardMaterial color="#5D9C59" flatShading roughness={0.8} />
    </mesh>
  );
};

const Water = () => {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, WATER_LEVEL, 0]} receiveShadow>
      <planeGeometry args={[MAP_SIZE, MAP_SIZE, 32, 32]} />
      <MeshDistortMaterial 
        color="#00BFFF" 
        speed={1.5} 
        distort={0.3} 
        radius={1} 
        transparent 
        opacity={0.65} 
        roughness={0.1}
        metalness={0.1}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

const Boulder = React.memo(({ data }: { data: BoulderData }) => {
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

const Tree = React.memo(({ data }: { data: TreeData }) => {
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
const Log = React.memo(({ data }: { data: LogData }) => {
    const collectLog = useGameStore(state => state.collectLog);
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
    const collectedRef = useRef(false);
    const magnetizedStartRef = useRef<number | null>(null);
    const isLogPowerupActive = useGameStore(state => state.isLogPowerupActive);

    useFrame((state) => {
        // @ts-ignore
        const mesh = ref.current;
        if (mesh) {
            const pos = mesh.position;
            const now = Date.now();
            const age = now - data.createdAt;
            // Log Magnet Powerup
            // Allow collection slightly earlier if magnet is active
            const magnetInvulnTime = 500; // Reduced further
            const normalInvulnTime = 2500;
            const effectiveInvuln = isLogPowerupActive ? magnetInvulnTime : normalInvulnTime;
            const isCollectable = age > effectiveInvuln;
            let isBeingMagnetized = false;

            if (isLogPowerupActive && isCollectable && !collectedRef.current) {
                // Use global position or fallback to store
                let targetX = currentWoodchuckPos.x;
                let targetY = currentWoodchuckPos.y + 1.5; // Chest height
                let targetZ = currentWoodchuckPos.z;
                
                if (targetX === 0 && targetY === 1.5 && targetZ === 0) {
                    const storePos = useGameStore.getState().woodchuckPosition;
                    if (storePos) {
                        targetX = storePos[0];
                        targetY = storePos[1] + 1.5;
                        targetZ = storePos[2];
                    }
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
const LooseLog = React.memo(({ data }: { data: LooseLogData }) => {
    const collectLooseLog = useGameStore(state => state.collectLooseLog);
    const expireLooseLog = useGameStore(state => state.expireLooseLog);
    const isPaused = useGameStore(state => state.isPaused);
    
    const [ref, api] = useCylinder(() => ({
        mass: 2, 
        position: data.position,
        rotation: data.rotation,
        args: [0.3, 0.3, 2, 8],
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
    const collectedRef = useRef(false);
    const magnetizedStartRef = useRef<number | null>(null);
    const isLogPowerupActive = useGameStore(state => state.isLogPowerupActive);

    // Helpers
    const helper = useMemo(() => ({
        up: new THREE.Vector3(0, 1, 0),
        tempVec: new THREE.Vector3()
    }), []);

    // Initial "Pop" Explosion
    useEffect(() => {
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

            // Log Magnet Powerup
            // Allow collection slightly earlier if magnet is active
            const magnetInvulnTime = 500; // Reduced further
            const normalInvulnTime = 2500;
            const effectiveInvuln = isLogPowerupActive ? magnetInvulnTime : normalInvulnTime;
            const isCollectable = age > effectiveInvuln;
            let isBeingMagnetized = false;

            if (isLogPowerupActive && isCollectable && !collectedRef.current) {
                // Use global position or fallback to store
                let targetX = currentWoodchuckPos.x;
                let targetY = currentWoodchuckPos.y + 1.5; // Chest height
                let targetZ = currentWoodchuckPos.z;
                
                if (targetX === 0 && targetY === 1.5 && targetZ === 0) {
                    const storePos = useGameStore.getState().woodchuckPosition;
                    if (storePos) {
                        targetX = storePos[0];
                        targetY = storePos[1] + 1.5;
                        targetZ = storePos[2];
                    }
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
                 const mass = 2; 
                 // Force required to hold mass up = gravity * mass = 40.
                 // High buoyancy factor for snappy surface return
                 const buoyancyFactor = 1000; // Even higher
                 
                 // Procedural bop function for surface floating
                 const bop = Math.sin(state.clock.elapsedTime * 3 + pos.x * 0.5) * 8;
                 let uplift = (gravity * mass) + (displacement * buoyancyFactor) + bop;
                 
                 // If very deep, apply a strong upward impulse to "pop" it up
                 if (displacement > 1.0) {
                    uplift *= 3.0;
                 }

                 api.applyForce([0, uplift, 0], [pos.x, pos.y, pos.z]); 
                 api.applyForce([0, 0, flowSpeed], [pos.x, pos.y, pos.z]);

                 // Orientation Correction (Torque to Horizontal)
                 const quaternion = new THREE.Quaternion().copy(mesh.quaternion);
                 const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
                 const alignment = localY.dot(helper.up); 

                 if (Math.abs(alignment) > 0.05) {
                    helper.tempVec.crossVectors(localY, helper.up).normalize();
                    if (helper.tempVec.lengthSq() < 0.01) {
                         helper.tempVec.set(1, 0, 0); 
                    }
                    const torqueStrength = 80 * Math.abs(alignment);
                    api.applyTorque([
                        helper.tempVec.x * torqueStrength, 
                        0, 
                        helper.tempVec.z * torqueStrength
                    ]);
                 }

                 // Adaptive damping: Very low when submerged
                 const damping = displacement > 0.4 ? 0.1 : 0.6;
                 api.linearDamping.set(damping); 
                 api.angularDamping.set(0.3);

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
                 
                 api.linearDamping.set(0.1);
                 api.angularDamping.set(0.1);
                 
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

    return (
        <mesh ref={ref as any} castShadow receiveShadow>
            <cylinderGeometry args={[0.3, 0.3, 2, 8]} />
            <meshStandardMaterial ref={matRef} color="#8D6E63" />
            <mesh position={[0, 1.01, 0]} rotation={[Math.PI/2, 0, 0]}>
                 <circleGeometry args={[0.3, 8]} />
                 <meshStandardMaterial color="#A1887F" />
            </mesh>
            <mesh position={[0, -1.01, 0]} rotation={[Math.PI/2, 0, 0]}>
                 <circleGeometry args={[0.3, 8]} />
                 <meshStandardMaterial color="#A1887F" />
            </mesh>
        </mesh>
    );
});

const StructureLog = ({ position, rotation }: { position: [number, number, number], rotation: [number, number, number] }) => {
    return (
        <mesh position={position} rotation={rotation} castShadow receiveShadow>
            <cylinderGeometry args={[0.4, 0.4, 3, 8]} />
            <meshStandardMaterial color="#5D4037" />
            <mesh position={[0, 1.51, 0]} rotation={[Math.PI/2, 0, 0]}>
                 <circleGeometry args={[0.4, 8]} />
                 <meshStandardMaterial color="#8D6E63" />
            </mesh>
            <mesh position={[0, -1.51, 0]} rotation={[Math.PI/2, 0, 0]}>
                 <circleGeometry args={[0.4, 8]} />
                 <meshStandardMaterial color="#8D6E63" />
            </mesh>
        </mesh>
    )
}

const PlacedStructureRenderer = React.memo(({ data, blueprints }: { data: PlacedStructure, blueprints: Blueprint[] }) => {
    const blueprint = blueprints.find(b => b.id === data.blueprintId);
    
    // We use a compound body for the structure
    // Since it's static, we can just use a single body or multiple.
    // For simplicity and performance, let's use a static body for the whole group if possible,
    // but Cannon works best with primitive shapes. 
    // We will map each log to a cylinder shape in the physics world.
    
    // However, creating physics bodies for 7000 logs is too much.
    // We should approximate the physics shape.
    // For now, let's just make it a static object that blocks movement.
    // We'll use a simple box or cylinder approximation for physics if it's large,
    // OR we iterate the logs if it's small.
    // Given the constraints, let's just render the visual logs and add a simplified physics collider.
    
    // Actually, the prompt says "Logs need to be held in place... impact water flow".
    // Individual log physics is best for "impact water flow" if we want loose logs to get stuck on them.
    // But for performance, let's try to just use the visual mesh for small structures,
    // and maybe a simplified hull for large ones?
    // Let's stick to individual physics bodies for now but static.
    
    // Optimization: Only create physics bodies for the logs.
    // Since useCylinder hook creates a body, we can map over blueprint logs.
    
    // BUT, we can't call hooks inside a loop if the loop length changes.
    // Blueprint logs length is constant per blueprint type, but we are in a component that takes `data`.
    // So we should be fine if we split this into a sub-component per log? No, that's too much overhead.
    
    // Better approach: Use a single compound body for the whole structure.
    const shapes = useMemo(() => {
        if (!blueprint) return [];
        return blueprint.logs.map(log => ({
            type: 'Cylinder',
            position: log.position,
            rotation: log.rotation,
            args: [0.4, 0.4, 3, 8]
        }));
    }, [blueprint]);

    const [ref] = useCylinder(() => ({
        mass: 0, // Static
        type: 'Static',
        position: data.position,
        rotation: data.rotation,
        // @ts-ignore
        shapes: shapes,
        userData: { tag: 'structure', id: data.id }
    }), [data.position, data.rotation, shapes]);

    if (!blueprint) return null;

    // Visuals
    return (
        <group ref={ref as any}>
            {blueprint.logs.map((log, i) => (
                <StructureLog key={i} position={log.position} rotation={log.rotation} />
            ))}
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

const PreviewStructure = () => {
    const selectedBlueprintId = useGameStore(state => state.selectedBlueprintId);
    const blueprints = useGameStore(state => state.blueprints);
    const placementRotation = useGameStore(state => state.placementRotation);
    const groupRef = useRef<THREE.Group>(null);
    
    const blueprint = blueprints.find(b => b.id === selectedBlueprintId);
    
    useFrame(() => {
        if (groupRef.current) {
            // Position preview in front of player
            // We can use the global currentWoodchuckPos
            // And maybe project it forward based on camera or just place it at player pos
            // The prompt said "tiltable by joystick", so it's likely fixed relative to player or camera?
            // Let's place it exactly at player position but raised slightly
            groupRef.current.position.set(
                currentWoodchuckPos.x,
                currentWoodchuckPos.y, // Keep it grounded? Or player height?
                currentWoodchuckPos.z
            );
            
            // Apply rotation from store
            groupRef.current.rotation.set(
                placementRotation[0],
                placementRotation[1],
                placementRotation[2]
            );
        }
    });
    
    if (!blueprint) return null;

    return (
        <group ref={groupRef}>
            {blueprint.logs.map((log, i) => (
                <mesh key={i} position={log.position} rotation={log.rotation}>
                    <cylinderGeometry args={[0.4, 0.4, 3, 8]} />
                    <meshBasicMaterial color="#4FC3F7" transparent opacity={0.4} depthWrite={false} />
                    <Edges color="yellow" threshold={15} />
                </mesh>
            ))}
        </group>
    );
};

const Woodchuck = () => {
    const isPaused = useGameStore(state => state.isPaused);
    const isTreePowerupActive = useGameStore(state => state.isTreePowerupActive);
    const isLogPowerupActive = useGameStore(state => state.isLogPowerupActive);
    const treePowerupEndTime = useGameStore(state => state.treePowerupEndTime);
    const logPowerupEndTime = useGameStore(state => state.logPowerupEndTime);
    
    const [ref, api] = useSphere(() => ({ 
        mass: 50, 
        position: [0, 10, 20], 
        args: [0.6], 
        fixedRotation: true, 
        linearDamping: 0.5, 
        friction: 0.0,
        userData: { tag: 'player' },
        onCollide: (e) => {
            if (e.body && e.body.userData && (e.body.userData as any).tag === 'structure') {
                setDestroyTarget((e.body.userData as any).id);
            }
        }
    }));

    const velocity = useRef([0, 0, 0]);
    useEffect(() => {
        const unsub = api.velocity.subscribe((v) => (velocity.current = v));
        return unsub;
    }, [api.velocity]);

    const { 
        trees, damageTree, activeTreeId, setActiveTree, 
        setDestroyTarget, destroyTargetId, placedStructures,
        isPlacementMode, updatePlacementRotation, placeStructure,
        cameraMode
    } = useGameStore();
    
    const pos = useRef([0, 10, 20]);
    const lastChopTime = useRef(0);
    
    useEffect(() => {
        const sub = api.position.subscribe(v => {
            pos.current = v;
            currentWoodchuckPos.set(v[0], v[1], v[2]);
        });
        // @ts-ignore
        window.woodchuckApi = api;
        return () => sub();
    }, [api]);

    const lastAngle = useRef(0);
    const currentRotationY = useRef(Math.PI);
    const visualRef = useRef<THREE.Group>(null);
    const turnSpeed = useRef(0.005);

    useFrame((state, delta) => {
        if (isPaused) {
            api.velocity.set(0, 0, 0);
            api.angularVelocity.set(0, 0, 0);
            return;
        }
        
        const [x, y, z] = pos.current;
        const [vx, vy, vz] = velocity.current;
        currentWoodchuckPos.set(x, y, z);
        
        // Sync to store for other components if needed
        if (state.clock.elapsedTime % 0.1 < 0.02) { // Throttle updates
             useGameStore.setState({ woodchuckPosition: [x, y, z] });
        }

        // @ts-ignore
        const input = window.woodchuckInput || { x: 0, y: 0 };
        const isMoving = Math.abs(input.x) > 0.1 || Math.abs(input.y) > 0.1;

        // Camera-relative movement calculation
        const camera = state.camera;
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        forward.y = 0;
        right.y = 0;
        forward.normalize();
        right.normalize();

        const moveVector = new THREE.Vector3()
            .addScaledVector(right, input.x)
            .addScaledVector(forward, -input.y); // input.y is positive when moving down on screen

            if (isMoving) {
                const targetAngle = Math.atan2(moveVector.x, moveVector.z);
                lastAngle.current = targetAngle; // For camera tracking
                
                // "Starts moving before turning" logic:
                // We want the character to move in the input direction immediately,
                // while the model rotates to face that direction smoothly.
                // This prevents "spinning in place" because movement happens alongside rotation.
                
                let diff = targetAngle - currentRotationY.current;
                while (diff < -Math.PI) diff += Math.PI * 2;
                while (diff > Math.PI) diff -= Math.PI * 2;
                
                // Ramp up turn speed
                // Start slow (0.005) and ramp to max (0.025) over time
                // User requested faster sync: Increase max speed and acceleration
                if (turnSpeed.current < 0.1) {
                    turnSpeed.current += 0.005; 
                }
                
                // Direct rotation if difference is small to snap
                if (Math.abs(diff) < 0.1) {
                    currentRotationY.current = targetAngle;
                } else {
                    currentRotationY.current += diff * turnSpeed.current;
                }
            } else {
                // Reset turn speed when stopped
                turnSpeed.current = 0.005;
            }
        
        // Placement Mode Logic
        if (isPlacementMode) {
            // Joystick controls rotation/tilt
            if (Math.abs(input.x) > 0.01 || Math.abs(input.y) > 0.01) {
                updatePlacementRotation(input.x, input.y);
            }
            
            // Stop movement physics
            api.velocity.set(0, 0, 0);
            api.angularVelocity.set(0, 0, 0);
            
            // Update camera to look at placement
            const targetCamPos = new THREE.Vector3(x, y + 10, z + 15);
            state.camera.position.lerp(targetCamPos, 0.1);
            state.camera.lookAt(x, y, z);
            
            // Allow placement trigger
            // @ts-ignore
            if (window.woodchuckInput.isBuilding) {
                placeStructure([x, y, z]);
                // @ts-ignore
                window.woodchuckInput.isBuilding = false;
            }
            
            return; // Skip normal movement logic
        }

        const terrainH = calculateTerrainHeight(x, z);
        const distToGround = y - terrainH;

        let foundTree = false;
        
        for (const tree of trees) {
            if (!tree.isFelled) {
                const dx = x - tree.position[0];
                const dz = z - tree.position[2];
                const distSq = dx*dx + dz*dz;
                
                // Increase radius if powerup is active
                // Much bigger radius for Mega Chomp (12m radius = 144 sq)
                const chopRadiusSq = isTreePowerupActive ? 144.0 : 4.5;
                
                if (distSq < chopRadiusSq) { 
                    foundTree = true;
                    
                    const damage = 100 * delta;
                    damageTree(tree.id, damage);
                    
                    const now = state.clock.elapsedTime;
                    if (now - lastChopTime.current > 0.25) {
                        audioService.playChop();
                        lastChopTime.current = now;
                    }
                    
                    if (!isTreePowerupActive) {
                        break; // Only chop one tree unless powerup is active
                    }
                }
            }
        }

        if (!foundTree && activeTreeId !== null) {
            setActiveTree(null);
        }
        
        // Handle Destroy Target Distance Check
        if (destroyTargetId) {
            const target = placedStructures.find(s => s.id === destroyTargetId);
            if (target) {
                const dx = x - target.position[0];
                const dz = z - target.position[2];
                const distSq = dx*dx + dz*dz;
                // If we move too far away (e.g. > 8 units), clear the target
                if (distSq > 64) {
                    setDestroyTarget(null);
                }
            } else {
                setDestroyTarget(null);
            }
        }

        const zoomFactor = isMoving ? 1.4 : 1.0;
        let targetOffset = new THREE.Vector3(0, 8 * zoomFactor, 14 * zoomFactor);
        let lookAtOffset = new THREE.Vector3(0, 4, 0);

        if (cameraMode === 'TOP_DOWN') {
            targetOffset.set(0, 30, 0.1); // Slight Z offset to avoid gimbal lock
            lookAtOffset.set(0, 0, 0);
        } else if (cameraMode === 'BEHIND') {
            // Get player rotation from last angle
            const angle = lastAngle.current;
            const dist = 12 * zoomFactor;
            const height = 6 * zoomFactor;
            targetOffset.set(
                -Math.sin(angle) * dist,
                height,
                -Math.cos(angle) * dist
            );
            lookAtOffset.set(0, 2, 0);
        } else if (cameraMode === 'CINEMATIC') {
            const time = state.clock.elapsedTime * 0.15;
            const dist = 25 * zoomFactor;
            targetOffset.set(
                Math.sin(time) * dist,
                12,
                Math.cos(time) * dist
            );
            lookAtOffset.set(0, 2, 0);
        }

        const targetCamPos = new THREE.Vector3(x + targetOffset.x, terrainH + targetOffset.y, z + targetOffset.z);
        
        const camTerrainH = calculateTerrainHeight(targetCamPos.x, targetCamPos.z);
        if (targetCamPos.y < camTerrainH + 2) {
            targetCamPos.y = camTerrainH + 2;
        }

        state.camera.position.lerp(targetCamPos, 0.1); 
        state.camera.lookAt(x + lookAtOffset.x, y + lookAtOffset.y, z + lookAtOffset.z); 

        // Physics & Movement Logic
        // Determine if swimming or walking
        const inWater = y < WATER_LEVEL + 0.5; // Slightly lenient
        // "Swimming" means in water and floating significantly above ground
        const isSwimming = inWater && distToGround > 1.0; 

        if (isSwimming) {
             const riverW = getRiverWidth(z);
             const flowSpeed = 80 / Math.max(1, riverW); 
             
             // High damping in water
             api.linearDamping.set(0.9);
             
             // Buoyancy Logic
             const depth = WATER_LEVEL - y;
             
             // Mass = 50, Gravity = 20. Weight = 1000.
             // Need force > 1000 to rise.
             if (depth > 0.0) {
                 // Apply upward force for buoyancy
                 // Base force to counteract gravity (1000) + extra to rise (proportional to depth)
                 const buoyancyForce = 1000 + (depth * 2500);
                 api.applyForce([0, buoyancyForce, 0], [x, y, z]); 
                 
                 // Apply drag to prevent shooting out of water
                 const drag = velocity.current[1] * 150;
                 api.applyForce([0, -drag, 0], [x, y, z]);
             }
             
             // Movement in water
             const swimSpeed = 18;
             if (isMoving) {
                 // Move in direction of INPUT (moveVector), not facing
                 api.velocity.set(moveVector.x * swimSpeed, velocity.current[1], moveVector.z * swimSpeed + flowSpeed * 0.5);
             } else {
                 // Drift with flow
                 api.velocity.set(0, velocity.current[1], flowSpeed * 0.5);
             }
             
             // Visual rotation for swimming
             if (visualRef.current) {
                 visualRef.current.rotation.order = 'YXZ';
                 visualRef.current.rotation.set(-Math.PI / 2, currentRotationY.current, 0);
             }
        } else {
             // Walking
             const walkSpeed = 25;
             
             // Low damping on land (less floaty)
             api.linearDamping.set(0.1);
             
             if (y < terrainH - 5) {
                 // Safety net
                 api.position.set(x, terrainH + 2, z);
                 api.velocity.set(0, 0, 0);
             } else {
                 if (isMoving) {
                     // Move in direction of INPUT (moveVector), not facing
                     api.velocity.set(moveVector.x * walkSpeed, velocity.current[1], moveVector.z * walkSpeed);
                 } else {
                     api.velocity.set(0, velocity.current[1], 0);
                 }
             }
             
             if (visualRef.current) {
                 visualRef.current.rotation.order = 'YXZ';
                 visualRef.current.rotation.set(0, currentRotationY.current, 0);
             }
        }
    });

    const lastChompTime = useGameStore(state => state.lastChompTime);
    const timeOfDay = useGameStore(state => state.timeOfDay);
    const isNight = timeOfDay > 0.45 && timeOfDay < 0.95;
    const isGhostLightActive = isNight && (Date.now() - lastChompTime < 30000);

    // Ghost Light Animation
    const lightRef = useRef<THREE.PointLight>(null);
    useFrame((state) => {
        if (lightRef.current && isGhostLightActive) {
            const time = state.clock.elapsedTime;
            // Sparkle/Flicker
            const flicker = Math.sin(time * 15) * 0.3 + Math.cos(time * 27) * 0.3;
            lightRef.current.intensity = 4 + flicker; 
            
            // Hover motion
            lightRef.current.position.y = 3.5 + Math.sin(time * 2) * 0.2;
            lightRef.current.position.x = Math.sin(time * 1.3) * 0.2;
            lightRef.current.position.z = Math.cos(time * 1.7) * 0.2;
        }
    });

    return (
        <group ref={ref as any}>
            {isGhostLightActive && (
                <group position={[0, 0, 0]}>
                    <pointLight 
                        ref={lightRef}
                        position={[0, 3.5, 0]} 
                        intensity={4} 
                        distance={20} 
                        decay={2}
                        color="#FFD700" 
                        castShadow 
                        shadow-bias={-0.0001}
                    />
                    {/* Visual Orb */}
                    <mesh position={[0, 3.5, 0]}>
                        <sphereGeometry args={[0.15, 8, 8]} />
                        <meshBasicMaterial color="#FFFFE0" transparent opacity={0.6} />
                    </mesh>
                    {/* Sparkles */}
                    <Sparkles 
                        count={15} 
                        scale={1.5} 
                        size={4} 
                        speed={0.4} 
                        opacity={0.8} 
                        color="#FFFF00" 
                        position={[0, 3.5, 0]} 
                    />
                </group>
            )}
            {/* Powerup Visuals - Attached to player position but NOT rotation */}
            {isTreePowerupActive && (
                <group>
                    {/* Territory Sphere Grid */}
                    <mesh position={[0, 0, 0]}>
                        <sphereGeometry args={[12, 32, 32]} />
                        <meshBasicMaterial color="#FF4500" wireframe transparent opacity={0.15} />
                    </mesh>
                    <mesh position={[0, 0, 0]}>
                        <sphereGeometry args={[11.8, 32, 32]} />
                        <meshBasicMaterial color="#FF4500" transparent opacity={0.05} side={THREE.DoubleSide} />
                    </mesh>
                </group>
            )}
            {isLogPowerupActive && (
                <group>
                    {/* Territory Sphere Grid */}
                    <mesh position={[0, 0, 0]}>
                        <sphereGeometry args={[30, 32, 32]} />
                        <meshBasicMaterial color="#00BFFF" wireframe transparent opacity={0.15} />
                    </mesh>
                    <mesh position={[0, 0, 0]}>
                        <sphereGeometry args={[29.8, 32, 32]} />
                        <meshBasicMaterial color="#00BFFF" transparent opacity={0.05} side={THREE.DoubleSide} />
                    </mesh>
                </group>
            )}

            <group ref={visualRef}>
                <mesh castShadow receiveShadow position={[0, -0.2, 0]}>
                    <capsuleGeometry args={[0.5, 0.8, 4, 8]} />
                    <meshStandardMaterial color="#8D6E63" />
                </mesh>
                <mesh position={[0, 0.6, 0.2]} castShadow>
                    <sphereGeometry args={[0.35, 16, 16]} />
                    <meshStandardMaterial color="#795548" />
                </mesh>
                <mesh position={[0, 0.55, 0.5]} castShadow>
                    <boxGeometry args={[0.2, 0.15, 0.15]} />
                    <meshStandardMaterial color="#3E2723" />
                </mesh>
                <mesh position={[-0.05, 0.45, 0.55]}>
                    <boxGeometry args={[0.08, 0.12, 0.02]} />
                    <meshStandardMaterial color="white" />
                </mesh>
                <mesh position={[0.05, 0.45, 0.55]}>
                    <boxGeometry args={[0.08, 0.12, 0.02]} />
                    <meshStandardMaterial color="white" />
                </mesh>
                <mesh position={[0, -0.6, -0.4]} rotation={[-0.5, 0, 0]}>
                    <cylinderGeometry args={[0.1, 0.05, 0.6]} />
                    <meshStandardMaterial color="#5D4037" />
                </mesh>
            </group>
        </group>
    );
};

const DestructionManager = () => {
    const tickDestruction = useGameStore(state => state.tickDestruction);
    const checkPowerups = useGameStore(state => state.checkPowerups);
    const isPaused = useGameStore(state => state.isPaused);
    
    useFrame((state, delta) => {
        if (!isPaused) {
            tickDestruction(delta);
            checkPowerups();
        }
    });
    return null;
};

const TimeManager = () => {
    const updateTime = useGameStore(state => state.updateTime);
    const isPaused = useGameStore(state => state.isPaused);
    
    useFrame((state, delta) => {
        if (!isPaused) {
            updateTime(delta, [currentWoodchuckPos.x, currentWoodchuckPos.y, currentWoodchuckPos.z]);
        }
    });
    return null;
};

const Food = React.memo(({ data }: { data: any }) => {
    const collectFood = useGameStore(state => state.collectFood);
    const [ref] = useSphere(() => ({
        mass: 1,
        position: data.position,
        args: [0.3],
        type: 'Dynamic',
        onCollide: (e) => {
            if (e.body && e.body.userData && (e.body.userData as any).tag === 'player') {
                collectFood(data.id);
            }
        }
    }));

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

const MobRenderer = React.memo(({ data }: { data: any }) => {
    const takeDamage = useGameStore(state => state.takeDamage);
    const [ref, api] = useSphere(() => ({
        mass: 10,
        position: data.position,
        args: [0.5],
        type: 'Dynamic',
        linearDamping: 0.5,
        fixedRotation: true,
        onCollide: (e) => {
            if (e.body && e.body.userData && (e.body.userData as any).tag === 'player') {
                // Damage player on contact
                const damage = data.type === 'bear' ? 30 : 15;
                takeDamage(damage);
                
                // Knockback
                const dx = currentWoodchuckPos.x - data.position[0];
                const dz = currentWoodchuckPos.z - data.position[2];
                const dist = Math.sqrt(dx*dx + dz*dz);
                if (dist > 0) {
                    const force = 20;
                    api.applyImpulse([-dx/dist * force, 0, -dz/dist * force], [0, 0, 0]);
                }
            }
        }
    }));
    
    const velocity = useRef([0, 0, 0]);
    useEffect(() => api.velocity.subscribe((v) => (velocity.current = v)), [api.velocity]);
    
    // Simple AI: Move towards player
    useFrame(() => {
        // @ts-ignore
        const pos = ref.current?.position;
        if (pos) {
            const dx = currentWoodchuckPos.x - pos.x;
            const dz = currentWoodchuckPos.z - pos.z;
            const dist = Math.sqrt(dx*dx + dz*dz);
            
            // Aggro range check (infinite for now as per request "pursue more")
            // But let's make them faster
            if (dist > 1) {
                let speed = data.type === 'wolf' ? 18 : 12; // Much faster
                
                // Lunge if close
                if (dist < 8) speed *= 1.5;
                
                api.velocity.set(
                    (dx / dist) * speed,
                    velocity.current[1], // Keep Y velocity (gravity)
                    (dz / dist) * speed
                );
                
                // Look at player
                const angle = Math.atan2(dx, dz);
                api.rotation.set(0, angle, 0);
            }
        }
    });

    return (
        <mesh ref={ref as any} castShadow>
            <sphereGeometry args={[0.5, 16, 16]} />
            <meshStandardMaterial color={data.type === 'wolf' ? '#555' : '#3E2723'} />
            {/* Eyes */}
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

// Grass Component with Sway and Displacement
const Grass = () => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const materialRef = useRef<THREE.MeshStandardMaterial>(null);
    
    // Generate instances
    const instances = useMemo(() => {
        const temp = [];
        const count = 40000; // Doubled again
        const dummy = new THREE.Object3D();
        
        for (let i = 0; i < count; i++) {
            // Random position within map bounds
            const x = (Math.random() - 0.5) * MAP_SIZE;
            const z = (Math.random() - 0.5) * MAP_SIZE;
            
            // Patchy logic: Use simple clustering
            // 30% chance to be in a "patch"
            // Or use a simple noise approximation: sin(x*0.1) * sin(z*0.1) > 0
            const noise = Math.sin(x * 0.1) * Math.cos(z * 0.1) + Math.sin(x * 0.3 + z * 0.2);
            if (noise < -0.5) continue; // Skip some areas for patchiness
            
            const y = calculateTerrainHeight(x, z);
            
            // Only on land (above water level)
            if (y > WATER_LEVEL + 0.2) {
                dummy.position.set(x, y + 0.5, z); 
                dummy.position.y = y + 0.5; 
                
                dummy.rotation.y = Math.random() * Math.PI;
                
                // Varying lengths
                const scaleY = 0.5 + Math.random() * 1.0; // 0.5 to 1.5 height
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
            instances.forEach((matrix, i) => {
                meshRef.current!.setMatrixAt(i, matrix);
            });
            meshRef.current.instanceMatrix.needsUpdate = true;
        }
    }, [instances]);

    const uniforms = useMemo(() => ({
        time: { value: 0 },
        playerPos: { value: new THREE.Vector3() }
    }), []);

    useFrame((state) => {
        if (materialRef.current && materialRef.current.userData.shader) {
            materialRef.current.userData.shader.uniforms.time.value = state.clock.elapsedTime;
            materialRef.current.userData.shader.uniforms.playerPos.value.copy(currentWoodchuckPos);
        }
    });

    const onBeforeCompile = (shader: THREE.Shader) => {
        shader.uniforms.time = uniforms.time;
        shader.uniforms.playerPos = uniforms.playerPos;
        
        shader.vertexShader = `
            uniform float time;
            uniform vec3 playerPos;
            ${shader.vertexShader}
        `;
        
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `
            #include <begin_vertex>
            
            // World pos for noise/sway (approximate using instanceMatrix)
            // Note: transformed is local position.
            // We need world position for noise continuity, but displacement is local deformation.
            
            vec4 worldPos = instanceMatrix * vec4(position, 1.0);
            
            // Sway
            float sway = sin(time * 2.0 + worldPos.x * 0.5 + worldPos.z * 0.5) * 0.2;
            transformed.x += sway * uv.y; // Only top moves (uv.y 1 at top)
            
            // Displacement
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
        
        materialRef.current!.userData.shader = shader;
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

export const Game3D = () => {
  const trees = useGameStore(state => state.trees);
  const logs = useGameStore(state => state.logs);
  const looseLogs = useGameStore(state => state.looseLogs);
  const boulders = useGameStore(state => state.boulders);
  const placedStructures = useGameStore(state => state.placedStructures);
  const blueprints = useGameStore(state => state.blueprints);
  const isPlacementMode = useGameStore(state => state.isPlacementMode);
  const timeOfDay = useGameStore(state => state.timeOfDay);
  const mobs = useGameStore(state => state.mobs);

  // Calculate Sun Position based on time
  // 0 = Sunrise (East), 0.25 = Noon (Top), 0.5 = Sunset (West), 0.75 = Midnight (Bottom)
  // Sky component expects sunPosition vector.
  // Let's map time 0..1 to an angle.
  // 0.25 (Noon) -> High Y.
  // 0.75 (Midnight) -> Low Y.
  
  const sunAngle = (timeOfDay - 0.25) * Math.PI * 2; // Noon at top
  const sunX = Math.cos(sunAngle) * 100;
  const sunY = Math.sin(sunAngle) * 100 * -1; // Invert to match Sky component logic usually
  // Actually, Sky component:
  // sunPosition=[x, y, z]
  // Let's try simple orbit.
  const sunPos: [number, number, number] = [
      Math.sin(timeOfDay * Math.PI * 2) * 100,
      Math.cos(timeOfDay * Math.PI * 2) * 100, // Noon (0) -> 100, Midnight (0.5) -> -100?
      // Wait, timeOfDay 0 = start. Let's say 0 is sunrise.
      // 0 = Sunrise (X=100, Y=0)
      // 0.25 = Noon (X=0, Y=100)
      // 0.5 = Sunset (X=-100, Y=0)
      // 0.75 = Midnight (X=0, Y=-100)
  ];
  
  // Time 0 -> Sunrise
  // Time 0.25 -> Noon
  // Time 0.5 -> Sunset
  // Time 0.75 -> Midnight
  
  const r = 100;
  const theta = timeOfDay * Math.PI * 2; // 0 to 2PI
  
  const sX = Math.cos(theta) * r;
  const sY = Math.sin(theta) * r;
  const sZ = -50; 
  
  const mX = Math.cos(theta + Math.PI) * r;
  const mY = Math.sin(theta + Math.PI) * r;
  const mZ = -50;

  const isNight = timeOfDay > 0.45 && timeOfDay < 0.95; // Rough night check for stars
  
  // Lighting
  // Sun is bright when Y > 0
  const sunIntensity = Math.max(0, Math.sin(theta) * 1.5);
  // Moon is active when Sun Y < 0
  const moonIntensity = Math.max(0, Math.sin(theta + Math.PI) * 0.5); // Moon light
  
  // Ambient is base + contribution from sun/moon
  const ambientIntensity = 0.4 + sunIntensity * 0.2 + moonIntensity * 0.2;

  const food = useGameStore(state => state.food);

  return (
    <Canvas shadows camera={{ position: [0, 10, 20], fov: 60 }}>
      <TimeManager />
      <DestructionManager />
      <Sky 
        sunPosition={[sX, sY, sZ]} 
        turbidity={0.5} 
        rayleigh={0.5} 
        inclination={0.6} 
        azimuth={0.25} 
        mieCoefficient={0.005}
        mieDirectionalG={0.8}
      />
      
      {/* Moon Mesh - Orbiting opposite to sun, far away */}
      <group position={[mX * 4, mY * 4, 0]}>
          <mesh>
              <sphereGeometry args={[20, 32, 32]} />
              <meshStandardMaterial color="#DDDDDD" emissive="#222222" />
          </mesh>
      </group>

      {isNight && <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />}
      
      <ambientLight intensity={ambientIntensity} />
      
      {/* Sun Light */}
      <directionalLight 
        position={[sX, sY, sZ]} 
        intensity={sunIntensity} 
        castShadow 
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0005}
      >
          <orthographicCamera attach="shadow-camera" args={[-150, 150, 150, -150]} />
      </directionalLight>

      {/* Moon Light */}
      <directionalLight 
        position={[mX, mY, 0]} 
        intensity={moonIntensity} 
        color="#AACCEE"
        castShadow 
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
      >
          <orthographicCamera attach="shadow-camera" args={[-150, 150, 150, -150]} />
      </directionalLight>
      
      <Physics gravity={[0, -20, 0]} allowSleep={false}>
        <Terrain />
        <Grass />
        
        {trees.map(tree => (
            <Tree key={`${tree.id}-${tree.isFelled}`} data={tree} />
        ))}

        {boulders.map(b => (
            <Boulder key={b.id} data={b} />
        ))}
        
        {logs.map(log => (
            <Log key={log.id} data={log} />
        ))}

        {looseLogs.map(log => (
            <LooseLog key={log.id} data={log} />
        ))}
        
        {food.map(f => (
            <Food key={f.id} data={f} />
        ))}
        
        {placedStructures.map(struct => (
            <PlacedStructureRenderer key={struct.id} data={struct} blueprints={blueprints} />
        ))}
        
        {mobs.map(mob => (
            <MobRenderer key={mob.id} data={mob} />
        ))}

        <Woodchuck />
      </Physics>
      
      {isPlacementMode && <PreviewStructure />}

      <Water />

      <Cloud opacity={0.5} speed={0.2} width={40} depth={15} segments={20} position={[0, 30, -80]} />
      <Stars radius={150} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      
      <Float speed={1} rotationIntensity={0} floatIntensity={0}>
        <Cloud opacity={0.3} speed={0.1} width={50} depth={20} segments={10} position={[40, 25, -50]} />
      </Float>
    </Canvas>
  );
};