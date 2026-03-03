import React from 'react';
import { MeshDistortMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { MAP_SIZE } from '../store';

const WATER_LEVEL = -1.5;

export const Water = () => {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, WATER_LEVEL, 0]} receiveShadow frustumCulled={false}>
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
