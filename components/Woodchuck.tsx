import React, { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useSphere } from '@react-three/cannon';
import * as THREE from 'three';
import { useGameStore, getRiverWidth, calculateTerrainHeight } from '../store';
import { currentWoodchuckPos } from '../globals';
import { PreviewStructureOverlay } from './WorldObjects';

const WATER_LEVEL = -1.5;

export const Woodchuck = () => {
    const isPaused = useGameStore(state => state.isPaused);
    const isTreePowerupActive = useGameStore(state => state.isTreePowerupActive);
    const isLogPowerupActive = useGameStore(state => state.isLogPowerupActive);
    const treePowerupEndTime = useGameStore(state => state.treePowerupEndTime);
    const logPowerupEndTime = useGameStore(state => state.logPowerupEndTime);
    
    // Physics Body
    const [ref, api] = useSphere(() => ({ 
        type: 'Kinematic',
        mass: 100, 
        position: [0, 10, 20], 
        args: [0.6], 
        fixedRotation: true, 
        userData: { tag: 'player' },
        onCollide: (e) => {
            if (e.body && e.body.userData && (e.body.userData as any).tag === 'structure') {
                useGameStore.getState().setDestroyTarget((e.body.userData as any).id);
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
        cameraMode, tickDestruction
    } = useGameStore();
    
    const pos = useRef([0, 10, 20]);
    
    useEffect(() => {
        // Initialize global position immediately
        currentWoodchuckPos.set(0, 10, 20);
        
        const sub = api.position.subscribe(v => {
            pos.current = v;
        });
        // @ts-ignore
        window.woodchuckApi = api;
        return () => sub();
    }, [api]);

    const lastAngle = useRef(0);
    const currentRotationY = useRef(Math.PI);
    const visualRef = useRef<THREE.Group>(null);
    const turnSpeed = useRef(0.05);

    const previewRef = useRef<THREE.Group>(null);
    const placementRotation = useGameStore(state => state.placementRotation);

    const isSwimmingRef = useRef(false);

    // Reusable vectors to avoid GC
    const moveVector = useMemo(() => new THREE.Vector3(), []);
    const terrainNormal = useMemo(() => new THREE.Vector3(), []);
    const projectedMove = useMemo(() => new THREE.Vector3(), []);
    const forward = useMemo(() => new THREE.Vector3(), []);
    const right = useMemo(() => new THREE.Vector3(), []);

    const internalPos = useRef([0, 10, 20]);

    useFrame((state, delta) => {
        if (isPaused) {
            api.velocity.set(0, 0, 0);
            api.angularVelocity.set(0, 0, 0);
            return;
        }
        
        // Use internal position to avoid double-movement from physics engine integrating velocity
        let [x, y, z] = internalPos.current;
        
        // Fallback: If somehow below world, respawn
        if (y < -20) {
            internalPos.current = [0, 10, 20];
            api.position.set(0, 10, 20);
            api.velocity.set(0, 0, 0);
            return;
        }
        
        // Sync to store
        if (state.clock.elapsedTime % 0.1 < 0.02) { 
             useGameStore.setState({ woodchuckPosition: [x, y, z] });
        }

        // @ts-ignore
        const input = window.woodchuckInput || { x: 0, y: 0 };
        const isMoving = Math.abs(input.x) > 0.1 || Math.abs(input.y) > 0.1;

        // Camera-relative movement
        const camera = state.camera;
        forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
        right.set(1, 0, 0).applyQuaternion(camera.quaternion);
        forward.y = 0;
        right.y = 0;
        forward.normalize();
        right.normalize();

        moveVector.set(0, 0, 0)
            .addScaledVector(right, input.x)
            .addScaledVector(forward, -input.y); 
            
        if (moveVector.lengthSq() > 0) {
            moveVector.normalize();
        }

        // Rotation Logic
        if (isMoving) {
            const targetAngle = Math.atan2(moveVector.x, moveVector.z);
            lastAngle.current = targetAngle; 
            
            let diff = targetAngle - currentRotationY.current;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            
            const maxTurnSpeed = 0.2;
            if (turnSpeed.current < maxTurnSpeed) turnSpeed.current += 0.01;
            
            currentRotationY.current += diff * turnSpeed.current;
        } else {
            turnSpeed.current = 0.05; 
        }

        // --- Custom Kinematic Movement ---
        const radius = 0.6;
        
        // 1. Calculate desired horizontal movement
        let nextX = x;
        let nextZ = z;
        
        const riverW = getRiverWidth(z);
        const flowSpeed = 80 / Math.max(1, riverW); 
        
        // Determine state
        const terrainH_current = calculateTerrainHeight(x, z);
        const inWater = terrainH_current < WATER_LEVEL;
        const touchingGround = (y - terrainH_current) < (radius + 0.2);

        if (isMoving) {
            const speed = (inWater && !touchingGround) ? 12 : 22;
            nextX += moveVector.x * speed * delta;
            nextZ += moveVector.z * speed * delta;
        }

        if (inWater && !touchingGround) {
            // Drift with river
            nextZ += flowSpeed * 0.5 * delta;
        }

        // 2. Manual Collision Detection (Trees, Boulders, Structures, Map Bounds)
        let allowedX = nextX;
        let allowedZ = nextZ;
        const playerRadius = 0.6;

        // Map Bounds
        const MAP_LIMIT = 145;
        if (allowedX > MAP_LIMIT) allowedX = MAP_LIMIT;
        if (allowedX < -MAP_LIMIT) allowedX = -MAP_LIMIT;
        if (allowedZ > MAP_LIMIT) allowedZ = MAP_LIMIT;
        if (allowedZ < -MAP_LIMIT) allowedZ = -MAP_LIMIT;

        const resolveCollision = (objX: number, objZ: number, minDist: number) => {
            const dx = allowedX - objX;
            const dz = allowedZ - objZ;
            const dist = Math.sqrt(dx*dx + dz*dz);
            if (dist < minDist) {
                if (dist > 0.001) {
                    const overlap = minDist - dist;
                    allowedX += (dx / dist) * overlap;
                    allowedZ += (dz / dist) * overlap;
                } else {
                    // Exact overlap fallback
                    allowedX += minDist;
                }
            }
        };

        trees.forEach(tree => {
            if (!tree.isFelled) resolveCollision(tree.position[0], tree.position[2], playerRadius + 0.8);
        });
        useGameStore.getState().boulders.forEach(boulder => {
            resolveCollision(boulder.position[0], boulder.position[2], playerRadius + boulder.scale);
        });
        placedStructures.forEach(struct => {
            resolveCollision(struct.position[0], struct.position[2], playerRadius + 1.5);
        });

        // 3. Calculate Y Position (Terrain following & Buoyancy)
        const terrainH_next = calculateTerrainHeight(allowedX, allowedZ);
        let targetY = terrainH_next + radius;
        
        if (terrainH_next < WATER_LEVEL) {
            // In water, float at surface, but don't go below terrain
            targetY = Math.max(terrainH_next + radius, WATER_LEVEL + 0.2);
        }

        // Smooth Y transition for walking up/down slopes and bobbing in water
        const finalY = THREE.MathUtils.lerp(y, targetY, 15 * delta);

        // 4. Apply to Physics Engine
        // We set velocity so the kinematic body moves to the exact desired position and can push dynamic objects (logs)
        const safeDelta = Math.max(0.001, delta);
        const vx_kinematic = (allowedX - x) / safeDelta;
        const vy_kinematic = (finalY - y) / safeDelta;
        const vz_kinematic = (allowedZ - z) / safeDelta;
        
        internalPos.current = [allowedX, finalY, allowedZ];
        currentWoodchuckPos.set(allowedX, finalY, allowedZ);
        tickDestruction(delta);
        
        api.position.set(allowedX, finalY, allowedZ);
        api.velocity.set(vx_kinematic, vy_kinematic, vz_kinematic);
        
        // Update Visual Position & Rotation
        if (visualRef.current) {
             visualRef.current.position.set(allowedX, finalY, allowedZ);
             
             visualRef.current.rotation.order = 'YXZ';
             if (inWater && !touchingGround) {
                 // Swim rotation (flat)
                 visualRef.current.rotation.set(-Math.PI / 2, currentRotationY.current, 0);
             } else {
                 // Walk rotation (upright)
                 visualRef.current.rotation.set(0, currentRotationY.current, 0);
             }
        }
        
        // Update Placement Preview
        if (isPlacementMode && previewRef.current) {
             const offset = 3.0;
             const previewX = allowedX + Math.sin(currentRotationY.current) * offset;
             const previewZ = allowedZ + Math.cos(currentRotationY.current) * offset;
             const previewY = calculateTerrainHeight(previewX, previewZ);
             
             previewRef.current.position.set(previewX, previewY, previewZ);
             previewRef.current.rotation.set(0, placementRotation, 0);
        }

        // Interaction Logic (Tree / Destroy)
        if (input.isBuilding) {
             if (destroyTargetId !== null) setDestroyTarget(null);
             if (isPlacementMode) {
                 const offset = 3.0;
                 const previewX = allowedX + Math.sin(currentRotationY.current) * offset;
                 const previewZ = allowedZ + Math.cos(currentRotationY.current) * offset;
                 const previewY = calculateTerrainHeight(previewX, previewZ);
                 
                 placeStructure({
                     position: [previewX, previewY, previewZ],
                     rotation: [0, placementRotation, 0]
                 });
                 // @ts-ignore
                 window.woodchuckInput.isBuilding = false;
             }
        } else {
            // Only check trees if not building
            let foundTree = false;
            trees.forEach(tree => {
                if (tree.isFelled) return;
                const dx = allowedX - tree.position[0];
                const dz = allowedZ - tree.position[2];
                if (dx*dx + dz*dz < 4.0) { 
                    foundTree = true;
                    setActiveTree(tree.id);
                }
            });
            if (!foundTree && activeTreeId !== null) setActiveTree(null);
            
            // Check structures for destroying
            let foundStruct = false;
            placedStructures.forEach(struct => {
                const dx = allowedX - struct.position[0];
                const dz = allowedZ - struct.position[2];
                if (dx*dx + dz*dz < 9.0) { // 3 units radius
                    foundStruct = true;
                    setDestroyTarget(struct.id);
                }
            });
            
            if (!foundStruct && destroyTargetId !== null) {
                const target = placedStructures.find(s => s.id === destroyTargetId);
                if (target) {
                    const dx = allowedX - target.position[0];
                    const dz = allowedZ - target.position[2];
                    if (dx*dx + dz*dz > 64) setDestroyTarget(null);
                } else {
                    setDestroyTarget(null);
                }
            }
        }
    });

    const lastChompTime = useGameStore(state => state.lastChompTime);
    const timeOfDay = useGameStore(state => state.timeOfDay);
    const isNight = timeOfDay > 0.45 && timeOfDay < 0.95;
    const isGhostLightActive = isNight && (Date.now() - lastChompTime < 30000);

    const lightRef = useRef<THREE.PointLight>(null);
    useFrame((state) => {
        if (lightRef.current && isGhostLightActive) {
            const time = state.clock.elapsedTime;
            lightRef.current.intensity = 2 + Math.sin(time * 5) * 1;
            lightRef.current.position.y = 1.5 + Math.sin(time * 2) * 0.5;
        }
    });

    return (
        <group>
            <group ref={ref as any} />
            <group ref={visualRef} position={[pos.current[0], pos.current[1], pos.current[2]]}>
                <mesh position={[0, 0, 0]} castShadow>
                    <capsuleGeometry args={[0.5, 1, 4, 8]} />
                    <meshStandardMaterial color={isTreePowerupActive ? "#FFD700" : "#795548"} />
                </mesh>
                <mesh position={[0, 0.8, 0]} castShadow>
                    <sphereGeometry args={[0.4, 16, 16]} />
                    <meshStandardMaterial color={isTreePowerupActive ? "#FFD700" : "#5D4037"} />
                </mesh>
                <mesh position={[0.15, 0.9, 0.3]} castShadow>
                    <sphereGeometry args={[0.08, 8, 8]} />
                    <meshStandardMaterial color="black" />
                </mesh>
                <mesh position={[-0.15, 0.9, 0.3]} castShadow>
                    <sphereGeometry args={[0.08, 8, 8]} />
                    <meshStandardMaterial color="black" />
                </mesh>
                <mesh position={[0, 0.7, 0.35]} castShadow>
                    <boxGeometry args={[0.2, 0.15, 0.05]} />
                    <meshStandardMaterial color="white" />
                </mesh>
                <mesh position={[0, -0.3, -0.5]} rotation={[-Math.PI/4, 0, 0]} castShadow>
                    <capsuleGeometry args={[0.15, 0.6, 4, 8]} />
                    <meshStandardMaterial color="#4E342E" />
                </mesh>
                {isTreePowerupActive && (
                    <mesh position={[0, 1.2, 0]}>
                        <torusGeometry args={[0.3, 0.05, 8, 16]} />
                        <meshStandardMaterial color="#FFD700" emissive="#FFD700" emissiveIntensity={0.5} />
                    </mesh>
                )}
            </group>
            {isGhostLightActive && (
                <pointLight
                    ref={lightRef}
                    position={[0, 2, 0]}
                    color="#00FFFF"
                    distance={10}
                    decay={2}
                />
            )}
            {isPlacementMode && (
                <group ref={previewRef}>
                     <PreviewStructureOverlay />
                </group>
            )}
        </group>
    );
};
