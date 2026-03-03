import React, { useMemo } from 'react';
import { useHeightfield } from '@react-three/cannon';
import * as THREE from 'three';
import { calculateTerrainHeight, MAP_SIZE } from '../store';

const MAP_RES = 128;

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

export const Terrain = () => {
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
