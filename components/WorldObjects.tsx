import React, { useMemo, useRef, useEffect, forwardRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useSphere, useCylinder, useCompoundBody } from '@react-three/cannon';
import { Edges } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore, getRiverWidth, calculateTerrainHeight } from '../store';
import { TreeData, LogData, LooseLogData, BoulderData, PlacedStructure, Blueprint } from '../types';
import { currentWoodchuckPos } from '../globals';

const WATER_LEVEL = -1.5;

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
export const LooseLog = React.memo(({ data }: { data: LooseLogData }) => {
    const collectLooseLog = useGameStore(state => state.collectLooseLog);
    const expireLooseLog = useGameStore(state => state.expireLooseLog);
    const isPaused = useGameStore(state => state.isPaused);
    const collectedRef = useRef(false);
    
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

export const StructureLog = ({ position, rotation }: { position: [number, number, number], rotation: [number, number, number] }) => {
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

export const PlacedStructureRenderer = React.memo(({ data, blueprints }: { data: PlacedStructure, blueprints: Blueprint[] }) => {
    const blueprint = blueprints.find(b => b.id === data.blueprintId);
    
    const shapes = useMemo(() => {
        if (!blueprint) return [];
        return blueprint.logs.map(log => ({
            type: 'Cylinder',
            position: log.position,
            rotation: log.rotation,
            args: [0.4, 0.4, 3, 8]
        }));
    }, [blueprint]);

    const [ref] = useCompoundBody(() => ({
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

export const PreviewStructureOverlay = forwardRef<THREE.Group, {}>((props, ref) => {
    const selectedBlueprintId = useGameStore(state => state.selectedBlueprintId);
    const blueprints = useGameStore(state => state.blueprints);
    const blueprint = blueprints.find(b => b.id === selectedBlueprintId);
    
    if (!blueprint) return null;

    return (
        <group ref={ref}>
            {blueprint.logs.map((log, i) => (
                <mesh key={i} position={log.position} rotation={log.rotation}>
                    <cylinderGeometry args={[0.4, 0.4, 3, 8]} />
                    <meshBasicMaterial color="#00FFFF" transparent opacity={0.6} depthTest={false} depthWrite={false} />
                    <Edges color="white" threshold={15} />
                </mesh>
            ))}
        </group>
    );
});
