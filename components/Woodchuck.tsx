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
        const terrainH = calculateTerrainHeight(x, z);
        const distToGround = y - terrainH;
        
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
        
        // 1. Buoyancy (Always active if in water)
        const inWater = y < WATER_LEVEL + 0.5;
        if (inWater) {
             const depth = (WATER_LEVEL + 0.5) - y;
             // Stronger buoyancy to ensure floating
             // Mass 100 * Gravity 20 = 2000 weight.
             // Base buoyancy 1500 + depth factor.
             // If depth > 0.2 (chest deep), force > 2000.
             const buoyancyForce = 1500 + (depth * 3000);
             api.applyForce([0, buoyancyForce, 0], [x, y, z]); 
             
             // Drag (Vertical)
             const drag = velocity.current[1] * 200;
             api.applyForce([0, -drag, 0], [x, y, z]);
        }

        // 2. State Determination
        // Swimming if deep enough AND not grounded
        const isSwimming = inWater && (distToGround > 0.8);

        if (isSwimming) {
             // --- Swimming Movement ---
             const riverW = getRiverWidth(z);
             const flowSpeed = 80 / Math.max(1, riverW); 
             
             api.linearDamping.set(0.9); // High damping for control
             
             const swimSpeed = 18;
             if (isMoving) {
                 api.velocity.set(moveVector.x * swimSpeed, velocity.current[1], moveVector.z * swimSpeed + flowSpeed * 0.5);
             } else {
                 api.velocity.set(0, velocity.current[1], flowSpeed * 0.5);
             }
             
             if (visualRef.current) {
                 visualRef.current.rotation.order = 'YXZ';
                 visualRef.current.rotation.set(-Math.PI / 2, currentRotationY.current, 0);
             }
        } else {
             // --- Walking / Wading Movement ---
             api.linearDamping.set(0.1); 
             
             const walkSpeed = 25;
             const acceleration = 3.0; 
             
             // Safety net for falling through map
             if (y < terrainH - 5) {
                 api.position.set(x, terrainH + 2, z);
                 api.velocity.set(0, 0, 0);
             } else {
                 // Gravity Assist (only if not swimming/floating strongly)
                 // If wading, buoyancy might be lifting us, so don't apply extra gravity unless we really want to stick.
                 // But we want to be able to walk out.
                 if (distToGround > 0.5 && !inWater) {
                     api.applyForce([0, -2000, 0], [x, y, z]); 
                 }

                 if (isMoving) {
                     const targetVx = moveVector.x * walkSpeed;
                     const targetVz = moveVector.z * walkSpeed;
                     
                     const currentVx = velocity.current[0];
                     const currentVz = velocity.current[2];
                     
                     const newVx = THREE.MathUtils.lerp(currentVx, targetVx, delta * acceleration);
                     const newVz = THREE.MathUtils.lerp(currentVz, targetVz, delta * acceleration);
                     
                     // Flow effect while wading
                     let flowZ = 0;
                     if (inWater) {
                         const riverW = getRiverWidth(z);
                         flowZ = (80 / Math.max(1, riverW)) * 0.2; 
                     }

                     api.velocity.set(newVx, velocity.current[1], newVz + flowZ);
                     
                     // Downward force to stick to slopes
                     if (distToGround < 2.0 && velocity.current[1] > -1 && !inWater) {
                         api.applyForce([0, -500, 0], [x, y, z]);
                     }
                 } else {
                     const currentVx = velocity.current[0];
                     const currentVz = velocity.current[2];
                     
                     const newVx = THREE.MathUtils.lerp(currentVx, 0, delta * acceleration * 2);
                     const newVz = THREE.MathUtils.lerp(currentVz, 0, delta * acceleration * 2);
                     
                     api.velocity.set(newVx, velocity.current[1], newVz);
                 }
             }
             
             if (visualRef.current) {
                 visualRef.current.rotation.order = 'YXZ';
                 visualRef.current.rotation.set(0, currentRotationY.current, 0);
             }
        }
        
        // Update Preview Position
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
            {/* Physics Body - HIDDEN VISUALLY */}
            <mesh ref={ref as any} castShadow receiveShadow visible={false}>
                <sphereGeometry args={[0.6, 32, 32]} />
                <meshStandardMaterial color={isTreePowerupActive ? "#FFD700" : "#8D6E63"} />
            </mesh>
            
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
