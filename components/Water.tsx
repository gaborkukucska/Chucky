import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MAP_SIZE, useGameStore, getRiverWidth } from '../store';
import { BASE_WATER, getWaterLevel, hydrology, updateHydrology } from '../services/hydrology';
import { currentWoodchuckPos, fx } from '../globals';

// The water: one surface over the whole map that follows the river's height (services/
// hydrology.ts). Where a dam holds the water back, the surface steps down over it - the
// water pouring over the dam - and spray flies off the bottom of the fall.
const SEGMENTS = 120;               // 2.5 m grid
const SPRAY_DISTANCE = 70;          // m - spray only near Chucky
const SPRAY_EVERY = 0.12;           // s between spray bursts per dam

// A gentle ripple on top of the river's shape (the old drei distort material scaled every vertex
// by up to 9%, which would tear a stepped surface apart)
const makeMaterial = () => {
    const m = new THREE.MeshStandardMaterial({
        color: '#00BFFF', transparent: true, opacity: 0.65, roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide,
    });
    const time = { value: 0 };
    m.onBeforeCompile = (shader) => {
        shader.uniforms.time = time;
        shader.vertexShader = 'uniform float time;\n' + shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            transformed.z += sin(position.x * 0.35 + time * 1.3) * 0.06 + sin(position.y * 0.27 - time * 1.7) * 0.05;`,
        );
    };
    m.userData.time = time;
    return m;
};

export const Water = () => {
    const geometry = useMemo(() => new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, SEGMENTS, SEGMENTS), []);
    const material = useMemo(makeMaterial, []);
    useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
    const shownVersion = useRef(-1);
    const lastSpray = useRef(0);

    useFrame((state, rawDelta) => {
        const s = useGameStore.getState();
        const delta = s.isPaused ? 0 : Math.min(rawDelta, 0.1);
        updateHydrology(s.placedStructures, s.blueprints, delta, `${s.worldSeed}-${s.terrainVersion}`);
        material.userData.time.value = state.clock.elapsedTime;

        // Reshape the surface when the water moved
        if (shownVersion.current !== hydrology.version) {
            shownVersion.current = hydrology.version;
            const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
            for (let i = 0; i < pos.count; i++) {
                // The plane is turned flat: its local Y is world -Z, local Z is height
                pos.setZ(i, getWaterLevel(pos.getX(i), -pos.getY(i)) - BASE_WATER);
            }
            pos.needsUpdate = true;
            geometry.computeVertexNormals();
            geometry.computeBoundingSphere();
        }

        // Spray where water pours over a dam (only once the river runs lower below it)
        const t = state.clock.elapsedTime;
        if (hydrology.dams.length && !s.isPaused && t - lastSpray.current > SPRAY_EVERY) {
            lastSpray.current = t;
            const p = currentWoodchuckPos;
            for (const d of hydrology.dams) {
                const z = d.z1 + 0.8;
                if (Math.hypot(d.x - p.x, z - p.z) > SPRAY_DISTANCE) continue;
                const fall = getWaterLevel(d.x, d.z0 - 1) - getWaterLevel(d.x, d.z1 + 2);
                if (fall < 0.4) continue;
                const w = getRiverWidth(z);
                const x = d.x + (Math.random() - 0.5) * 2 * w * 0.8;
                fx.emit('splash', x, getWaterLevel(x, z + 1.5), z, 3 + Math.round(fall * 2));
            }
        }
    });

    return (
        <mesh geometry={geometry} material={material} rotation={[-Math.PI / 2, 0, 0]} position={[0, BASE_WATER, 0]} receiveShadow frustumCulled={false} />
    );
};
