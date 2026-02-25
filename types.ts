export type GamePhase = 'START' | 'PLAYING' | 'GAMEOVER';
export type CameraMode = 'FOLLOW' | 'TOP_DOWN' | 'BEHIND' | 'CINEMATIC';

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
}

export interface BoulderData {
  id: string;
  position: [number, number, number];
  scale: number;
}

export interface Blueprint {
    id: string;
    name: string;
    cost: number;
    logs: { position: [number, number, number], rotation: [number, number, number] }[]; // Relative offsets
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