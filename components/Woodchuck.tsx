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
        mass: 100, 
        position: [0, 10, 20], 
        args: [0.6], 
        fixedRotation: true, 
        linearDamping: 0.1, 
        friction: 0.0,
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
        cameraMode
    } = useGameStore();
    
    const pos = useRef([0, 10, 20]);
    const lastChopTime = useRef(0);
    
    useEffect(() => {
        // Initialize global position immediately
        currentWoodchuckPos.set(0, 10, 20);
        
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
    const cameraAngle = useRef(0); 

    const previewRef = useRef<THREE.Group>(null);
    const placementRotation = useGameStore(state => state.placementRotation);

    const isSwimmingRef = useRef(false);

    useFrame((state, delta) => {
        if (isPaused) {
            api.velocity.set(0, 0, 0);
            api.angularVelocity.set(0, 0, 0);
            return;
        }
        
        const [x, y, z] = pos.current;
        const [vx, vy, vz] = velocity.current;
        currentWoodchuckPos.set(x, y, z);
        
        // Sync to store
        if (state.clock.elapsedTime % 0.1 < 0.02) { 
             useGameStore.setState({ woodchuckPosition: [x, y, z] });
        }

        // @ts-ignore
        const input = window.woodchuckInput || { x: 0, y: 0 };
        const isMoving = Math.abs(input.x) > 0.1 || Math.abs(input.y) > 0.1;

        // Camera-relative movement
        const camera = state.camera;
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        forward.y = 0;
        right.y = 0;
        forward.normalize();
        right.normalize();

        const moveVector = new THREE.Vector3()
            .addScaledVector(right, input.x)
            .addScaledVector(forward, -input.y); 
            
        // Normalize moveVector if it has length to ensure consistent force application
        if (moveVector.lengthSq() > 0) {
            moveVector.normalize();
        }

        if (isMoving) {
            const targetAngle = Math.atan2(moveVector.x, moveVector.z);
            lastAngle.current = targetAngle; 
            
            let diff = targetAngle - currentRotationY.current;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            
            const baseTurnSpeed = 0.1; 
            const maxTurnSpeed = 0.3;
            
            if (turnSpeed.current < maxTurnSpeed) {
                turnSpeed.current += 0.01;
            }
            
            currentRotationY.current += diff * turnSpeed.current;
        } else {
            turnSpeed.current = 0.05; 
        }

        // --- Physics & Movement ---
        
        // Check for Tree Interaction
        let foundTree = false;
        if (input.isBuilding) {
             if (isPlacementMode) {
                 const offset = 3.0;
                 const previewX = x + Math.sin(currentRotationY.current) * offset;
                 const previewZ = z + Math.cos(currentRotationY.current) * offset;
                 const previewY = calculateTerrainHeight(previewX, previewZ);
                 
                 placeStructure({
                     position: [previewX, previewY, previewZ],
                     rotation: [0, placementRotation, 0]
                 });
                 
                 // @ts-ignore
                 window.woodchuckInput.isBuilding = false;
             }
        } else {
            trees.forEach(tree => {
                if (tree.isFelled) return;
                const dx = x - tree.position[0];
                const dz = z - tree.position[2];
                const distSq = dx*dx + dz*dz;
                
                if (distSq < 4.0) { 
                    foundTree = true;
                    setActiveTree(tree.id);
                }
            });
        }
        
        if (!foundTree && activeTreeId !== null) {
            setActiveTree(null);
        }
        
        if (destroyTargetId) {
            const target = placedStructures.find(s => s.id === destroyTargetId);
            if (target) {
                const dx = x - target.position[0];
                const dz = z - target.position[2];
                const distSq = dx*dx + dz*dz;
                if (distSq > 64) {
                    setDestroyTarget(null);
                }
            } else {
                setDestroyTarget(null);
            }
        }

        // --- Unified Physics Logic ---
        
        // 1. Determine State
        const terrainH = calculateTerrainHeight(x, z);
        const distToGround = y - terrainH; // Distance from center to terrain
        const radius = 0.6;
        const touchingGround = distToGround < (radius + 0.2); // Slightly generous ground check
        
        const waterSurface = WATER_LEVEL;
        const submergedAmount = waterSurface - (y - radius); // How much of the body is below water level
        const inWater = submergedAmount > 0;
        
        // Hysteresis for swimming state
        // Enter swim if significantly submerged and not touching ground (or deep enough)
        if (!isSwimmingRef.current) {
            if (inWater && submergedAmount > radius * 1.2 && !touchingGround) {
                isSwimmingRef.current = true;
            }
        } else {
            // Exit swim if we touch ground in shallow water
            if (touchingGround && submergedAmount < radius) {
                isSwimmingRef.current = false;
            }
        }
        
        const isSwimming = isSwimmingRef.current;

        // 2. Buoyancy & Drag
        if (inWater) {
             // Buoyancy
             // Calculate displacement ratio (0 to 1)
             // Full buoyancy when fully submerged, partial when wading
             const immersionRatio = Math.min(1, Math.max(0, submergedAmount / (radius * 2)));
             
             let buoyancyForce = 2500 * immersionRatio; // Base buoyancy
             
             // Reduce buoyancy significantly when wading/exiting to allow traction
             if (!isSwimming && touchingGround) {
                 buoyancyForce *= 0.3; 
             }

             api.applyForce([0, buoyancyForce, 0], [x, y, z]); 
             
             // Drag (Vertical & Horizontal)
             const dragFactor = 200 * immersionRatio;
             api.applyForce(
                 [-velocity.current[0] * dragFactor, -velocity.current[1] * dragFactor, -velocity.current[2] * dragFactor], 
                 [x, y, z]
             );
        }

        // 3. Movement Control
        if (isSwimming) {
             // --- Swimming Movement ---
             const riverW = getRiverWidth(z);
             const flowSpeed = 80 / Math.max(1, riverW); 
             
             api.linearDamping.set(0.5); // Higher damping in water
             
             const swimSpeed = 20;
             
             if (isMoving) {
                 const targetVx = moveVector.x * swimSpeed;
                 const targetVz = moveVector.z * swimSpeed + flowSpeed * 0.5;
                 
                 const currentVx = velocity.current[0];
                 const currentVz = velocity.current[2];
                 
                 const diffX = targetVx - currentVx;
                 const diffZ = targetVz - currentVz;
                 
                 const forceFactor = 200; 
                 api.applyForce([diffX * forceFactor, 0, diffZ * forceFactor], [x, y, z]);

                 // Vertical swim control (Surface sticking)
                 // If deep, push up slightly to stay near surface
                 if (y < waterSurface - 0.5) {
                     api.applyForce([0, 500, 0], [x, y, z]);
                 }
             } else {
                 // Drift with flow
                 const targetVz = flowSpeed * 0.5;
                 const diffZ = targetVz - velocity.current[2];
                 api.applyForce([0, 0, diffZ * 50], [x, y, z]);
             }
             
        } else {
             // --- Walking / Land Movement ---
             api.linearDamping.set(0.1); 
             
             const walkSpeed = 25;
             
             // Safety net - Reset if fallen through world
             if (y < terrainH - 10) {
                 api.position.set(x, terrainH + 2, z);
                 api.velocity.set(0, 0, 0);
             } else {
                 
                 if (isMoving) {
                     const targetVx = moveVector.x * walkSpeed;
                     const targetVz = moveVector.z * walkSpeed;
                     
                     const currentVx = velocity.current[0];
                     const currentVz = velocity.current[2];
                     
                     const diffX = targetVx - currentVx;
                     const diffZ = targetVz - currentVz;
                     
                     const forceFactor = 400; 
                     api.applyForce([diffX * forceFactor, 0, diffZ * forceFactor], [x, y, z]);
                     
                     // Helper force for slopes:
                     // If moving and touching ground, apply a slight upward force to help step over geometry
                     // This replaces the "Jump" - it's a continuous "step up" force
                     if (touchingGround) {
                         // Only apply if we are actually trying to move
                         api.applyForce([0, 500, 0], [x, y, z]);
                     }
                     
                     // Flow effect while wading (reduced)
                     if (inWater) {
                         const riverW = getRiverWidth(z);
                         const flowZ = (80 / Math.max(1, riverW)) * 0.1; 
                         api.applyForce([0, 0, flowZ * 50], [x, y, z]);
                     }
                     
                 } else {
                     // Stop quickly (Braking)
                     const currentVx = velocity.current[0];
                     const currentVz = velocity.current[2];
                     const brakeForce = 300;
                     api.applyForce([-currentVx * brakeForce, 0, -currentVz * brakeForce], [x, y, z]);
                 }
             }
        }
        
        // Update Visual Position & Rotation (Runs for both states)
        if (visualRef.current) {
             const smoothFactor = 0.4;
             visualRef.current.position.lerp(new THREE.Vector3(x, y, z), smoothFactor);
             
             // Update global position from smoothed visual position so camera follows smoothly
             currentWoodchuckPos.copy(visualRef.current.position);

             visualRef.current.rotation.order = 'YXZ';
             if (isSwimming) {
                 visualRef.current.rotation.set(-Math.PI / 2, currentRotationY.current, 0);
             } else {
                 visualRef.current.rotation.set(0, currentRotationY.current, 0);
             }
        }
        if (isPlacementMode && previewRef.current) {
             const offset = 3.0;
             const previewX = x + Math.sin(currentRotationY.current) * offset;
             const previewZ = z + Math.cos(currentRotationY.current) * offset;
             const previewY = calculateTerrainHeight(previewX, previewZ);
             
             previewRef.current.position.set(previewX, previewY, previewZ);
             previewRef.current.rotation.set(0, placementRotation, 0);
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
            lightRef.current.intensity = 2 + Math.sin(time * 5) * 1;
            lightRef.current.position.y = 1.5 + Math.sin(time * 2) * 0.5;
        }
    });

    return (
        <group>
            {/* Physics Body - Invisible Group */}
            <group ref={ref as any} />
            
            {/* Visual Model (Rotated independently) */}
            <group ref={visualRef} position={[pos.current[0], pos.current[1], pos.current[2]]}>
                {/* Body */}
                <mesh position={[0, 0, 0]} castShadow>
                    <capsuleGeometry args={[0.5, 1, 4, 8]} />
                    <meshStandardMaterial color={isTreePowerupActive ? "#FFD700" : "#795548"} />
                </mesh>
                {/* Head */}
                <mesh position={[0, 0.8, 0]} castShadow>
                    <sphereGeometry args={[0.4, 16, 16]} />
                    <meshStandardMaterial color={isTreePowerupActive ? "#FFD700" : "#5D4037"} />
                </mesh>
                {/* Eyes */}
                <mesh position={[0.15, 0.9, 0.3]} castShadow>
                    <sphereGeometry args={[0.08, 8, 8]} />
                    <meshStandardMaterial color="black" />
                </mesh>
                <mesh position={[-0.15, 0.9, 0.3]} castShadow>
                    <sphereGeometry args={[0.08, 8, 8]} />
                    <meshStandardMaterial color="black" />
                </mesh>
                {/* Teeth */}
                <mesh position={[0, 0.7, 0.35]} castShadow>
                    <boxGeometry args={[0.2, 0.15, 0.05]} />
                    <meshStandardMaterial color="white" />
                </mesh>
                {/* Tail */}
                <mesh position={[0, -0.3, -0.5]} rotation={[-Math.PI/4, 0, 0]} castShadow>
                    <capsuleGeometry args={[0.15, 0.6, 4, 8]} />
                    <meshStandardMaterial color="#4E342E" />
                </mesh>
                
                {/* Powerup Visuals */}
                {isTreePowerupActive && (
                    <mesh position={[0, 1.2, 0]}>
                        <torusGeometry args={[0.3, 0.05, 8, 16]} />
                        <meshStandardMaterial color="#FFD700" emissive="#FFD700" emissiveIntensity={0.5} />
                    </mesh>
                )}
            </group>

            {/* Ghost Light */}
            {isGhostLightActive && (
                <pointLight
                    ref={lightRef}
                    position={[0, 2, 0]}
                    color="#00FFFF"
                    distance={10}
                    decay={2}
                />
            )}
            
            {/* Placement Preview */}
            {isPlacementMode && (
                <group ref={previewRef}>
                     <PreviewStructureOverlay />
                </group>
            )}
        </group>
    );
};
