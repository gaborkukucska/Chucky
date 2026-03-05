import React, { useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Physics } from '@react-three/cannon';
import { Sky, Stars, Cloud, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore } from '../store';
import { audioService } from '../services/audio';
import { Terrain } from './Terrain';
import { Water } from './Water';
import { Boulder, Tree, Log, LooseLog, PlacedStructureRenderer } from './WorldObjects';
import { Woodchuck } from './Woodchuck';

import { currentWoodchuckPos } from '../globals';

// --- Camera Controller ---
const CameraController = () => {
    const { camera } = useThree();
    // Use global ref for smooth 60fps updates instead of store
    const cameraMode = useGameStore(state => state.cameraMode);
    
    useFrame((state, delta) => {
        const { x, y, z } = currentWoodchuckPos;
        if (x === 0 && y === 0 && z === 0) return; // Skip init

        const targetPos = new THREE.Vector3(x, y, z);
        
        if (cameraMode === 'FOLLOW') {
             // Standard follow - Zoomed out
             camera.position.lerp(new THREE.Vector3(x, y + 15, z + 25), delta * 3);
             camera.lookAt(targetPos);
        } else if (cameraMode === 'BEHIND') {
             // Action view - Zoomed out
             camera.position.lerp(new THREE.Vector3(x, y + 8, z + 15), delta * 5);
             camera.lookAt(targetPos);
        } else if (cameraMode === 'TOP_DOWN') {
             // Reverted to original height as requested
             camera.position.lerp(new THREE.Vector3(x, 40, z + 5), delta * 2);
             camera.lookAt(targetPos);
        } else if (cameraMode === 'CINEMATIC') {
             // Side view - Zoomed out
             camera.position.lerp(new THREE.Vector3(x + 35, y + 10, z), delta * 2);
             camera.lookAt(targetPos);
        }
    });
    return null;
};

// --- Main Game Component ---
export const Game3D = () => {
    const trees = useGameStore(state => state.trees);
    const logs = useGameStore(state => state.logs);
    const looseLogs = useGameStore(state => state.looseLogs);
    const boulders = useGameStore(state => state.boulders);
    const placedStructures = useGameStore(state => state.placedStructures);
    const blueprints = useGameStore(state => state.blueprints);
    
    // Audio Init
    useEffect(() => {
        const handleInteract = () => {
            audioService.init();
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
                <Sky sunPosition={[100, 20, 100]} turbidity={0.5} rayleigh={0.5} mieCoefficient={0.005} mieDirectionalG={0.8} />
                <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
                <Cloud opacity={0.5} speed={0.4} width={10} depth={1.5} segments={20} position={[0, 20, -10]} />
                <ambientLight intensity={0.4} />
                <pointLight position={[10, 10, 10]} intensity={0.8} castShadow />
                <directionalLight 
                    position={[50, 50, 25]} 
                    intensity={1.5} 
                    castShadow 
                    shadow-mapSize-width={2048} 
                    shadow-mapSize-height={2048}
                    shadow-camera-left={-50}
                    shadow-camera-right={50}
                    shadow-camera-top={50}
                    shadow-camera-bottom={-50}
                />
                
                <Physics gravity={[0, -20, 0]}>
                    <Terrain />
                    <Water />
                    
                    {/* World Objects */}
                    {boulders.map(b => <Boulder key={b.id} data={b} />)}
                    {trees.map(t => <Tree key={t.id} data={t} />)}
                    {logs.map(l => <Log key={l.id} data={l} />)}
                    {looseLogs.map(l => <LooseLog key={l.id} data={l} />)}
                    {placedStructures.map(s => <PlacedStructureRenderer key={s.id} data={s} blueprints={blueprints} />)}
                    
                    {/* Player */}
                    <Woodchuck />
                </Physics>
                
                <CameraController />
                
                {/* Effects */}
                <Sparkles count={50} scale={12} size={4} speed={0.4} opacity={0.5} color="#FFD700" position={[0, 5, 0]} />
            </Canvas>
        </div>
    );
};
