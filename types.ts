export type GamePhase = 'START' | 'PLAYING' | 'GAMEOVER';
export type CameraMode = 'FOLLOW' | 'TOP_DOWN' | 'BEHIND' | 'CINEMATIC';
export type GraphicsQuality = 'LOW' | 'MEDIUM' | 'HIGH';
export type MagicType = 'shield' | 'triple' | 'bubble' | 'double';

// A magic item dropped by a chased-off wolf, bear or piranha
export interface MagicItemData {
  id: string;
  type: MagicType;
  position: [number, number, number];
  createdAt: number;
}

export interface PiranhaData {
  id: string;
  position: [number, number, number]; // Where it starts; it then swims on its own
}

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface TreeData {
  id: string;
  position: [number, number, number];
  health: number; // Current health
  maxHealth: number; // Total health (determines chomp time)
  size: 'small' | 'medium' | 'large';
  isFelled: boolean;
}

export interface LogData {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  isLocked: boolean;
  createdAt: number;
}

export interface LooseLogData {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  createdAt: number;
  settled?: boolean; // Restored from a save: no spawn "pop", keep the resting position
  value?: number;    // Logs this pickup is worth (demolition debris is bundled). Default 1
  velocity?: [number, number, number]; // Launch velocity (thrown) instead of the spawn "pop"
  spin?: [number, number, number];     // Thrown: random spin while it flies (rad/s)
  fleeting?: boolean; // Triple Chuck's magic extra logs: can't be picked up, vanish after landing
  thrown?: boolean;  // Thrown by a Chucky: hurts what it hits while flying; pick-up = wood only, no score
  // Joint games
  owner?: string;    // Player whose game simulates it and sends position corrections
  thrownBy?: string; // Player who threw it
  team?: string;     // Thrower's team (team mates catch it instead of getting hurt)
  woodOnly?: boolean; // Pick-up gives wood only (knock-out drops)
}

export interface BoulderData {
  id: string;
  position: [number, number, number];
  scale: number;
}

// One log of a blueprint, relative to the structure's origin (see blueprints.ts)
export interface BlueprintLog {
    position: [number, number, number];
    rotation: [number, number, number];
    scale?: number; // 1 = a 3 m log, 0.8 m thick; smaller = a stick (length and thickness)
}

// Mud plastered on a structure: a squashed sphere, for looks only (no collisions)
export interface BlueprintMud {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
}

export interface Blueprint {
    id: string;
    name: string;
    icon?: string;
    description?: string;
    cost: number;       // Logs it takes = number of logs in it
    logs: BlueprintLog[];
    mud?: BlueprintMud[];
    unlocked: boolean;
    unlockScore?: number;
}

export interface PlacedStructure {
    id: string;
    blueprintId: string;
    position: [number, number, number];
    rotation: [number, number, number]; // Base rotation of the whole structure
    health: number;
    maxHealth: number;
    points?: number; // Score awarded for building it (taken back if demolished)
    ownerId?: string; // Joint games: who built it
    team?: string;    // Joint games: the builder's team
}

export interface ComboState {
    active: boolean;
    startTime: number;
    logsCollected: number;
    multiplier: number;
    lastLogTime: number;
    // For tracking the "next 5 logs" requirement
    logsSinceLastLevel: number;
    levelStartTime: number;
}

export interface Notification {
    id: string;
    title: string;
    message: string;
    type: 'unlock' | 'achievement' | 'info';
    blueprintId?: string;
}

export interface MobData {
    id: string;
    position: [number, number, number];
    velocity: [number, number, number];
    type: 'wolf' | 'bear';
    createdAt: number;
}

export interface FoodData {
    id: string;
    position: [number, number, number];
    rotation: [number, number, number];
    createdAt: number;
    type: 'apple' | 'berry';
}