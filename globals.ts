import * as THREE from 'three';

export const currentWoodchuckPos = new THREE.Vector3(0, 0, 0);

// Live physics objects, registered by their components so a save can capture
// where logs and fruit actually are (the store only knows their spawn position).
export const liveObjects = {
    looseLogs: new Map<string, THREE.Object3D>(),
    food: new Map<string, THREE.Object3D>(),
};

// Per-frame player state that must not live in the store
export const playerState = {
    facing: Math.PI / 2,
};
