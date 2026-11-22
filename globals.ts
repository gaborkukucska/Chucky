import * as THREE from 'three';

export const currentWoodchuckPos = new THREE.Vector3(0, 0, 0);

// Live physics objects, registered by their components so a save can capture
// where logs and fruit actually are (the store only knows their spawn position).
export const liveObjects = {
    looseLogs: new Map<string, THREE.Object3D>(),
    food: new Map<string, THREE.Object3D>(),
    // Wolves/bears: their physics object + what happens when something hits them
    mobs: new Map<string, MobHandle>(),
};

export interface MobHandle {
    object: THREE.Object3D;
    type: 'wolf' | 'bear' | 'piranha';
    /** A thrown log, the Log Shield or a magpie's swoop: dazed and knocked back; counts one hit */
    hit: (dirX: number, dirZ: number) => void;
    /** A tail-slap wave: washed away hard (power 0..1); also counts one hit */
    shove: (dirX: number, dirZ: number, power: number) => void;
}

// Chucky's abilities, from a button or key (store.tailSlap / store.callMagpies), picked up by
// the scene (components/TailSlap.tsx, components/Magpies.tsx)
export type AbilityKind = 'slap' | 'magpies';
export const abilityEvents = {
    queue: [] as { kind: AbilityKind; x: number; y: number; z: number }[],
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
    steering: 0,       // rad/s Chucky is turning at (3rd-person steering); the camera settles fast at 0
    // Knock-back from a thrown log (joint games), added to Chucky's velocity next frame
    impulseX: 0,
    impulseZ: 0,
};

// Particle bursts (wood chips, splashes, sparkles...). Anything can queue one; the Effects
// component in the scene drains the queue every frame. Cheap: no React, no store.
export type FxKind = 'chips' | 'fell' | 'splash' | 'sparkle' | 'confetti' | 'bonk';
export const fx = {
    queue: [] as { kind: FxKind; x: number; y: number; z: number; count?: number }[],
    emit(kind: FxKind, x: number, y: number, z: number, count?: number) {
        if (this.queue.length < 64) this.queue.push({ kind, x, y, z, count });
    },
};
