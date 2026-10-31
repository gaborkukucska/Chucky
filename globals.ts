import * as THREE from 'three';

export const currentWoodchuckPos = new THREE.Vector3(0, 0, 0);

// Live physics objects, registered by their components so a save can capture
// where logs and fruit actually are (the store only knows their spawn position).
export const liveObjects = {
    looseLogs: new Map<string, THREE.Object3D>(),
    food: new Map<string, THREE.Object3D>(),
    // Wolves/bears: their physics object + what happens when a thrown log hits them
    mobs: new Map<string, { object: THREE.Object3D; hit: (dirX: number, dirZ: number) => void }>(),
};

// @react-three/cannon moves a body by writing its object's MATRIX (matrixAutoUpdate = false);
// object.position / .quaternion keep the SPAWN values. Always read live transforms here.
const _scale = new THREE.Vector3();
export const readBodyPosition = (obj: THREE.Object3D, out: THREE.Vector3) =>
    obj.matrixAutoUpdate ? out.copy(obj.position) : out.setFromMatrixPosition(obj.matrix);
export const readBodyTransform = (obj: THREE.Object3D, pos: THREE.Vector3, quat: THREE.Quaternion) => {
    if (obj.matrixAutoUpdate) {
        pos.copy(obj.position);
        quat.copy(obj.quaternion);
    } else {
        obj.matrix.decompose(pos, quat, _scale);
    }
};

// Aiming a throw: held since startedAt (performance.now()); read by the trajectory guide
export const throwAim = {
    charging: false,
    startedAt: 0,
};

// Per-frame player state that must not live in the store
export const playerState = {
    facing: Math.PI / 2,
    // Knock-back from a thrown log (joint games), added to Chucky's velocity next frame
    impulseX: 0,
    impulseZ: 0,
};
