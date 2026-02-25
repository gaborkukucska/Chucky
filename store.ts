import { create } from 'zustand';
import { GamePhase, CameraMode, TreeData, LogData, LooseLogData, BoulderData, Blueprint, PlacedStructure, ComboState, Notification } from './types';
import { audioService } from './services/audio';

export const MAP_SIZE = 300; 

interface GameState {
  phase: GamePhase;
  cameraMode: CameraMode;
  woodCount: number;
  score: number;
  totalLogsCollected: number;
  notification: Notification | null;
  damIntegrity: number; 
  trees: TreeData[];
  logs: LogData[]; 
  looseLogs: LooseLogData[]; 
  boulders: BoulderData[];
  woodchuckPosition: [number, number, number];
  activeTreeId: string | null;
  
  // Blueprints & Structures
  blueprints: Blueprint[];
  placedStructures: PlacedStructure[];
  
  // Placement Mode
  isPlacementMode: boolean;
  isBuildMenuOpen: boolean;
  selectedBlueprintId: string | null;
  placementRotation: [number, number, number]; // Euler angles
  
  // Destruction Mode
  destroyTargetId: string | null;
  isDestroying: boolean;
  isPaused: boolean;
  lastPauseStartTime: number;
  
  // Combo System
  combo: ComboState;

  lastChompTime: number;

  // Powerups
  treesChomped: number[];
  isTreePowerupActive: boolean;
  treePowerupEndTime: number;
  hasSeenTreePowerupPopup: boolean;

  isLogPowerupActive: boolean;
  logPowerupEndTime: number;
  hasSeenLogPowerupPopup: boolean;

  // Time & Mobs
  timeOfDay: number; // 0 to 1 (0 = start of day, 0.5 = noon, 1 = end of day)
  dayDuration: number; // in seconds (300s = 5m)
  mobs: MobData[];
  food: FoodData[];
  health: number;
  maxHealth: number;
  
  updateTime: (delta: number, playerPos: [number, number, number]) => void;
  spawnMob: (playerPos: [number, number, number]) => void;
  removeMob: (id: string) => void;

  startGame: () => void;
  endGame: () => void;
  addWood: () => void;
  placeLog: (position: [number, number, number], rotation: [number, number, number]) => void;
  damageTree: (id: string, amount: number) => void;
  setActiveTree: (id: string | null) => void;
  collectLooseLog: (id: string) => void;
  collectLog: (id: string) => void;
  collectFood: (id: string) => void;
  expireLooseLog: (id: string) => void;
  updateDamIntegrity: (val: number) => void;
  endCombo: () => void;
  dismissNotification: () => void;
  takeDamage: (amount: number) => void;
  heal: (amount: number) => void;
  
  // New Actions
  openBuildMenu: () => void;
  closeBuildMenu: () => void;
  selectBlueprint: (id: string) => void;
  updatePlacementRotation: (x: number, y: number) => void; // Joystick input
  placeStructure: (position: [number, number, number]) => void;
  setDestroyTarget: (id: string | null) => void;
  startDestroying: () => void;
  stopDestroying: () => void;
  tickDestruction: (delta: number) => void;
  
  // Combo Logic
  startChompingSession: () => void;
  checkCombo: () => void;
  cycleCameraMode: () => void;
}

// --- Terrain Helpers ---
// (Keep existing terrain helpers unchanged)
export const getRiverX = (z: number) => {
    return 20 * Math.sin(z * 0.02) + 10 * Math.sin(z * 0.05 + 2);
};

export const getRiverWidth = (z: number) => {
    return 8 + 3 * Math.cos(z * 0.03) + 2 * Math.sin(z * 0.1); 
};

export const calculateTerrainHeight = (x: number, z: number) => {
    const riverCenter = getRiverX(z);
    const riverW = getRiverWidth(z);
    const distToRiver = Math.abs(x - riverCenter);
    
    let height = 0;
    
    // Rolling hills base
    height += 4 * Math.sin(x * 0.08) * Math.cos(z * 0.08);
    height += 2 * Math.sin(x * 0.04 + z * 0.08);
    
    // Mountains at edges
    const distFromCenter = Math.sqrt(x*x + z*z);
    const mountainStart = MAP_SIZE / 2 - 40;
    if (distFromCenter > mountainStart) {
        height += (distFromCenter - mountainStart) * 1.5;
    }

    // Carve River
    const bankWidth = 8;
    
    if (distToRiver < riverW) {
        // River bed
        height = -6; 
    } else if (distToRiver < riverW + bankWidth) {
        // Banks
        const t = (distToRiver - riverW) / bankWidth;
        const smoothT = t * t * (3 - 2 * t);
        height = -6 + smoothT * (height + 6);
    }

    return height;
};

export const isLand = (x: number, z: number) => {
    return calculateTerrainHeight(x, z) > 0.5;
};

// --- Blueprint Generation ---
const generateBlueprints = (): Blueprint[] => {
    const blueprints: Blueprint[] = [];
    const baseCosts = [7, 15, 30, 60, 120, 240, 480, 960, 1920, 3840];
    const names = [
        "Small Pile", "Log Line", "Corner Wall", "Box Frame", "River Gate", 
        "Dam Segment", "Fortress Wall", "Tower Base", "Mega Dam", "Woodchuck Palace"
    ];

    const thresholds = [0, 150, 300, 500, 750, 1050, 1400, 1800, 2250, 2750];

    for (let i = 0; i < 10; i++) {
        const cost = baseCosts[i];
        const logs: { position: [number, number, number], rotation: [number, number, number] }[] = [];
        
        // Procedurally generate log positions based on cost/complexity
        // Make it more chaotic and natural pile-like
        const rows = Math.ceil(Math.sqrt(cost));
        const cols = Math.ceil(cost / rows);
        
        let count = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (count >= cost) break;
                
                // Base grid position
                let x = (c - cols/2) * 0.7; // Spread out a bit more
                let y = r * 0.35;
                let z = (Math.random() - 0.5) * 0.4; // More Z variation
                
                // Add SIGNIFICANT chaos
                x += (Math.random() - 0.5) * 0.8;
                y += (Math.random() - 0.5) * 0.2;
                z += (Math.random() - 0.5) * 0.8;
                
                // Rotation chaos
                // Base rotation alternates per layer, but add random tilt
                let rotY = r % 2 === 0 ? 0 : Math.PI / 2;
                rotY += (Math.random() - 0.5) * 1.5; // +/- ~45 degrees
                
                const rotX = (Math.random() - 0.5) * 0.5; // More tilt
                const rotZ = (Math.random() - 0.5) * 0.5; // More tilt
                
                logs.push({ 
                    position: [x, y, z], 
                    rotation: [rotX, rotY, rotZ] 
                });
                count++;
            }
        }

        blueprints.push({
            id: `bp-${i}`,
            name: names[i],
            cost: cost,
            logs: logs,
            unlocked: false, // All locked initially
            unlockScore: i === 0 ? 0 : thresholds[i] // 0 is special case for 3 logs
        });
    }
    return blueprints;
};

export const useGameStore = create<GameState>((set, get) => ({
  phase: 'START',
  woodCount: 0,
  score: 0,
  totalLogsCollected: 0,
  notification: null,
  damIntegrity: 0,
  trees: Array.from({ length: 250 }).map((_, i) => { 
    let x = 0, z = 0;
    let attempts = 0;
    do {
        z = (Math.random() - 0.5) * MAP_SIZE * 0.9; 
        const side = Math.random() > 0.5 ? 1 : -1;
        const rX = getRiverX(z);
        const rW = getRiverWidth(z);
        // Ensure trees don't spawn in water or on steep banks
        x = rX + side * (rW + 10 + Math.random() * (MAP_SIZE * 0.4)); 
        attempts++;
    } while (attempts < 20 && !isLand(x, z));

    const rand = Math.random();
    let size: 'small' | 'medium' | 'large' = 'medium';
    let maxHealth = 200;

    if (rand < 0.3) {
        size = 'small';
        maxHealth = 100;
    } else if (rand > 0.7) {
        size = 'large';
        maxHealth = 300;
    }

    return {
        id: `tree-${i}`,
        position: [x, 0, z] as [number, number, number],
        health: maxHealth,
        maxHealth: maxHealth,
        size: size,
        isFelled: false
    };
  }), 
  logs: [],
  looseLogs: [],
  boulders: Array.from({ length: 80 }).map((_, i) => { 
      const z = (Math.random() - 0.5) * MAP_SIZE * 0.95;
      const rX = getRiverX(z);
      const offset = (Math.random() - 0.5) * getRiverWidth(z) * 0.8;
      return {
          id: `boulder-${i}`,
          position: [rX + offset, -3, z],
          scale: 1 + Math.random() * 2.0
      };
  }),
  woodchuckPosition: [0, 5, 0],
  activeTreeId: null,
  
  // Blueprints
  blueprints: generateBlueprints(),
  placedStructures: [],
  cameraMode: 'BEHIND',
  isPlacementMode: false,
  isBuildMenuOpen: false,
  selectedBlueprintId: null,
  placementRotation: [0, 0, 0],
  
  // Destruction
  destroyTargetId: null,
  isDestroying: false,
  isPaused: false,
  lastPauseStartTime: 0,
  
  // Combo
  combo: {
      active: false,
      startTime: 0,
      logsCollected: 0,
      multiplier: 1,
      lastLogTime: 0,
      logsSinceLastLevel: 0,
      levelStartTime: 0
  },

  // Powerups
  lastChompTime: 0,
  treesChomped: [],
  isTreePowerupActive: false,
  treePowerupEndTime: 0,
  hasSeenTreePowerupPopup: false,

  isLogPowerupActive: false,
  logPowerupEndTime: 0,
  hasSeenLogPowerupPopup: false,

  // Time & Mobs
  timeOfDay: 0,
  dayDuration: 300,
  mobs: [],
  food: [],
  health: 100,
  maxHealth: 100,

  startGame: () => set((state) => ({ 
      phase: 'PLAYING', 
      woodCount: 0, 
      score: 0,
      totalLogsCollected: 0,
      notification: null,
      damIntegrity: 0, 
      logs: [],
      looseLogs: [],
      activeTreeId: null,
      trees: state.trees.map(t => ({...t, health: t.maxHealth, isFelled: false})),
      placedStructures: [],
      combo: { active: false, startTime: 0, logsCollected: 0, multiplier: 1, lastLogTime: 0, logsSinceLastLevel: 0, levelStartTime: 0 },
      isBuildMenuOpen: false,
      isPlacementMode: false,
      isPaused: false,
      lastPauseStartTime: 0,
      timeOfDay: 0,
      mobs: [],
      food: [],
      health: 100,
      maxHealth: 100
  })),
  endGame: () => set({ phase: 'GAMEOVER', isPaused: true }),
  
  cycleCameraMode: () => set((state) => {
      const modes: CameraMode[] = ['FOLLOW', 'TOP_DOWN', 'BEHIND', 'CINEMATIC'];
      const currentIndex = modes.indexOf(state.cameraMode);
      const nextIndex = (currentIndex + 1) % modes.length;
      return { cameraMode: modes[nextIndex] };
  }),
  
  addWood: () => set((state) => ({ woodCount: state.woodCount + 1 })),
  
  endCombo: () => set((state) => ({
      combo: { ...state.combo, active: false, multiplier: 1 }
  })),

  dismissNotification: () => set((state) => {
      const pauseDuration = Date.now() - state.lastPauseStartTime;
      return { 
          notification: null, 
          isPaused: false,
          combo: {
              ...state.combo,
              startTime: state.combo.startTime + (state.combo.active ? pauseDuration : 0),
              levelStartTime: state.combo.levelStartTime + (state.combo.active ? pauseDuration : 0),
              lastLogTime: state.combo.lastLogTime + (state.combo.active ? pauseDuration : 0)
          }
      };
  }),

  collectLooseLog: (id: string) => set((state) => {
      const now = Date.now();
      const log = state.looseLogs.find(l => l.id === id);
      if (!log) return {};

      // 1. Check Invulnerability (0.5s)
      if (now - log.createdAt < 500) return {};

      audioService.playSuccess();
      
      // Update Combo
      let newCombo = { ...state.combo };
      let pointsGained = 0;
      let notification: Notification | null = state.notification;
      let shouldPause = false;
      
      if (!newCombo.active) {
          newCombo = {
              active: true,
              startTime: now,
              logsCollected: 0,
              multiplier: 1,
              lastLogTime: now,
              logsSinceLastLevel: 0,
              levelStartTime: now
          };
      }

      newCombo.logsCollected++;
      newCombo.logsSinceLastLevel++;
      newCombo.lastLogTime = now;
      
      // Points for Combo Multiplier
      if (newCombo.multiplier > 1) {
          pointsGained += (newCombo.multiplier - 1);
      }

      // Check for Level Up
      // Relaxed difficulty
      // Level 1 (2x): 2 logs in < 40s total
      if (newCombo.multiplier === 1) {
          if (newCombo.logsCollected >= 2 && (now - newCombo.startTime < 40000)) {
              newCombo.multiplier = 2;
              newCombo.logsSinceLastLevel = 0;
              newCombo.levelStartTime = now;
              pointsGained += 1;
          }
      }
      // Level 2 (3x): 2 logs in < 30s
      else if (newCombo.multiplier === 2) {
          if (newCombo.logsSinceLastLevel >= 2 && (now - newCombo.levelStartTime < 30000)) {
              newCombo.multiplier = 3;
              newCombo.logsSinceLastLevel = 0;
              newCombo.levelStartTime = now;
              pointsGained += 2;
          }
      }
      // Level 3 (4x): 2 logs in < 25s
      else if (newCombo.multiplier === 3) {
          if (newCombo.logsSinceLastLevel >= 2 && (now - newCombo.levelStartTime < 25000)) {
              newCombo.multiplier = 4;
              newCombo.logsSinceLastLevel = 0;
              newCombo.levelStartTime = now;
              pointsGained += 3;
          }
      }
      
      // Reset logic if too slow
      if (newCombo.multiplier >= 2) {
          const timeout = newCombo.multiplier === 2 ? 30000 : 25000;
          if (now - newCombo.levelStartTime > timeout) {
               newCombo.logsSinceLastLevel = 1; 
               newCombo.levelStartTime = now;
          }
      }
      
      // Log Powerup Logic
      let isLogPowerupActive = state.isLogPowerupActive;
      let logPowerupEndTime = state.logPowerupEndTime;
      let hasSeenLogPowerupPopup = state.hasSeenLogPowerupPopup;

      if (newCombo.multiplier >= 3 && !isLogPowerupActive) {
          isLogPowerupActive = true;
          logPowerupEndTime = now + 30000; // 30 seconds duration (+50%)
          audioService.playLevelUp();
          if (!hasSeenLogPowerupPopup) {
              hasSeenLogPowerupPopup = true;
              notification = {
                  title: "MAGNETIC LOGS ACTIVATED!",
                  message: "You reached a 3x Multiplier! For the next 30 seconds, your collection radius is massive! Gather everything!",
                  type: "info"
              };
              shouldPause = true;
          }
      }

      // Update Total Logs & Milestones
      const newTotalLogs = state.totalLogsCollected + 1;
      if (newTotalLogs % 50 === 0) {
          pointsGained += 10;
          notification = {
              id: `log-milestone-${newTotalLogs}`,
              title: "LOG MASTER!",
              message: `Collected ${newTotalLogs} logs! +10 Points`,
              type: 'achievement'
          };
          shouldPause = true;
      }
      
      let newScore = state.score + pointsGained;
      let newBlueprints = [...state.blueprints];
      
      // Blueprint Unlocking Logic
      // BP 0: 3 Logs Total (Initial Drive)
      if (!newBlueprints[0].unlocked && newTotalLogs >= 3) {
          newBlueprints[0] = { ...newBlueprints[0], unlocked: true };
          newScore += 100;
          notification = {
              id: `unlock-bp-0`,
              title: "NEW BLUEPRINT!",
              message: `Unlocked: ${newBlueprints[0].name}`,
              type: 'unlock',
              blueprintId: newBlueprints[0].id
          };
          shouldPause = true;
      }
      
      // Subsequent BPs: Score Thresholds
      // Adjusted to prevent cascading unlocks from bonuses
      const thresholds = [0, 150, 300, 500, 750, 1050, 1400, 1800, 2250, 2750];
      
      for (let i = 1; i < thresholds.length; i++) {
          if (!newBlueprints[i].unlocked && newScore >= thresholds[i]) {
              newBlueprints[i] = { ...newBlueprints[i], unlocked: true };
              newScore += 100; // Bonus for unlocking
              notification = {
                  id: `unlock-bp-${i}`,
                  title: "NEW BLUEPRINT!",
                  message: `Unlocked: ${newBlueprints[i].name}`,
                  type: 'unlock',
                  blueprintId: newBlueprints[i].id
              };
              shouldPause = true;
          }
      }

      return {
          woodCount: state.woodCount + (1 * newCombo.multiplier),
          score: newScore,
          totalLogsCollected: newTotalLogs,
          looseLogs: state.looseLogs.filter(l => l.id !== id),
          combo: newCombo,
          blueprints: newBlueprints,
          notification: notification,
          isPaused: shouldPause,
          lastPauseStartTime: shouldPause ? Date.now() : state.lastPauseStartTime,
          isLogPowerupActive,
          logPowerupEndTime,
          hasSeenLogPowerupPopup
      };
  }),

  collectLog: (id: string) => set((state) => {
      const now = Date.now();
      const log = state.logs.find(l => l.id === id);
      if (!log) return {};

      // 1. Check Invulnerability (0.5s)
      if (now - log.createdAt < 500) return {};

      audioService.playSuccess();
      
      // Update Combo (same logic)
      let newCombo = { ...state.combo };
      let pointsGained = 0;
      let notification: Notification | null = state.notification;
      let shouldPause = false;
      
      if (!newCombo.active) {
          newCombo = {
              active: true,
              startTime: now,
              logsCollected: 0,
              multiplier: 1,
              lastLogTime: now,
              logsSinceLastLevel: 0,
              levelStartTime: now
          };
      }

      newCombo.logsCollected++;
      newCombo.logsSinceLastLevel++;
      newCombo.lastLogTime = now;
      
      if (newCombo.multiplier > 1) pointsGained += (newCombo.multiplier - 1);

      if (newCombo.multiplier === 1) {
          if (newCombo.logsCollected >= 2 && (now - newCombo.startTime < 40000)) {
              newCombo.multiplier = 2;
              newCombo.logsSinceLastLevel = 0;
              newCombo.levelStartTime = now;
              pointsGained += 1;
          }
      } else if (newCombo.multiplier === 2) {
          if (newCombo.logsSinceLastLevel >= 2 && (now - newCombo.levelStartTime < 30000)) {
              newCombo.multiplier = 3;
              newCombo.logsSinceLastLevel = 0;
              newCombo.levelStartTime = now;
              pointsGained += 2;
          }
      } else if (newCombo.multiplier === 3) {
          if (newCombo.logsSinceLastLevel >= 2 && (now - newCombo.levelStartTime < 25000)) {
              newCombo.multiplier = 4;
              newCombo.logsSinceLastLevel = 0;
              newCombo.levelStartTime = now;
              pointsGained += 3;
          }
      }
      
      if (newCombo.multiplier >= 2) {
          const timeout = newCombo.multiplier === 2 ? 30000 : 25000;
          if (now - newCombo.levelStartTime > timeout) {
               newCombo.logsSinceLastLevel = 1;
               newCombo.levelStartTime = now;
          }
      }
      
      // Log Powerup Logic
      let isLogPowerupActive = state.isLogPowerupActive;
      let logPowerupEndTime = state.logPowerupEndTime;
      let hasSeenLogPowerupPopup = state.hasSeenLogPowerupPopup;

      if (newCombo.multiplier >= 3 && !isLogPowerupActive) {
          isLogPowerupActive = true;
          logPowerupEndTime = now + 30000; // 30 seconds duration (+50%)
          audioService.playLevelUp();
          if (!hasSeenLogPowerupPopup) {
              hasSeenLogPowerupPopup = true;
              notification = {
                  title: "MAGNETIC LOGS ACTIVATED!",
                  message: "You reached a 3x Multiplier! For the next 30 seconds, your collection radius is massive! Gather everything!",
                  type: "info"
              };
              shouldPause = true;
          }
      }

      const newTotalLogs = state.totalLogsCollected + 1;
      if (newTotalLogs % 50 === 0) {
          pointsGained += 10;
          notification = {
              id: `log-milestone-${newTotalLogs}`,
              title: "LOG MASTER!",
              message: `Collected ${newTotalLogs} logs! +10 Points`,
              type: 'achievement'
          };
          shouldPause = true;
      }
      
      let newScore = state.score + pointsGained;
      let newBlueprints = [...state.blueprints];
      
      if (!newBlueprints[0].unlocked && newTotalLogs >= 3) {
          newBlueprints[0] = { ...newBlueprints[0], unlocked: true };
          newScore += 100;
          notification = {
              id: `unlock-bp-0`,
              title: "NEW BLUEPRINT!",
              message: `Unlocked: ${newBlueprints[0].name}`,
              type: 'unlock',
              blueprintId: newBlueprints[0].id
          };
          shouldPause = true;
      }
      
      const thresholds = [0, 150, 300, 500, 750, 1050, 1400, 1800, 2250, 2750];
      for (let i = 1; i < thresholds.length; i++) {
          if (!newBlueprints[i].unlocked && newScore >= thresholds[i]) {
              newBlueprints[i] = { ...newBlueprints[i], unlocked: true };
              newScore += 100;
              notification = {
                  id: `unlock-bp-${i}`,
                  title: "NEW BLUEPRINT!",
                  message: `Unlocked: ${newBlueprints[i].name}`,
                  type: 'unlock',
                  blueprintId: newBlueprints[i].id
              };
              shouldPause = true;
          }
      }

      return {
          woodCount: state.woodCount + (1 * newCombo.multiplier),
          score: newScore,
          totalLogsCollected: newTotalLogs,
          logs: state.logs.filter(l => l.id !== id),
          combo: newCombo,
          blueprints: newBlueprints,
          notification: notification,
          isPaused: shouldPause,
          lastPauseStartTime: shouldPause ? Date.now() : state.lastPauseStartTime,
          isLogPowerupActive,
          logPowerupEndTime,
          hasSeenLogPowerupPopup
      };
  }),

  expireLooseLog: (id: string) => set((state) => ({
      looseLogs: state.looseLogs.filter(l => l.id !== id)
  })),

  placeLog: (position, rotation) => set((state) => {
    if (state.woodCount <= 0) return {};
    const newLog: LogData = {
      id: `log-${Date.now()}`,
      position: position,
      rotation: rotation,
      isLocked: false,
      createdAt: Date.now()
    };
    return { 
      woodCount: state.woodCount - 1,
      logs: [...state.logs, newLog]
    };
  }),

  damageTree: (id, amount) => set((state) => {
    const tree = state.trees.find(t => t.id === id);
    if (!tree || tree.isFelled) return {};

    const newHealth = Math.max(0, tree.health - amount);
    const isFelled = newHealth === 0;
    
    let newLooseLogs: LooseLogData[] = [];
        if (isFelled) {
        // Spawn multiple logs based on tree size
        const logCount = tree.size === 'large' ? 3 : tree.size === 'medium' ? 2 : 1;
        
        for (let i = 0; i < logCount; i++) {
            // Scatter logs more widely
            const angle = (Math.PI * 2 * i) / logCount + Math.random();
            const distance = 2.0 + Math.random() * 2.5;
            
            const lx = tree.position[0] + Math.cos(angle) * distance;
            const lz = tree.position[2] + Math.sin(angle) * distance;
            const lh = calculateTerrainHeight(lx, lz);

            newLooseLogs.push({
                id: `loose-${id}-${Date.now()}-${i}`,
                position: [lx, lh + 3.0, lz],
                rotation: [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI],
                createdAt: Date.now() + (i * 100) // Slight stagger in creation time
            });
        }

        // Drop Food (30% chance)
        let newFood: FoodData[] = [];
        if (Math.random() < 0.3) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 1.5 + Math.random();
            const fx = tree.position[0] + Math.cos(angle) * dist;
            const fz = tree.position[2] + Math.sin(angle) * dist;
            const fh = calculateTerrainHeight(fx, fz);
            
            newFood.push({
                id: `food-${id}-${Date.now()}`,
                position: [fx, fh + 2.0, fz],
                rotation: [0, Math.random() * Math.PI * 2, 0],
                createdAt: Date.now(),
                type: Math.random() > 0.5 ? 'apple' : 'berry'
            });
        }
        
        audioService.playChomp();

        // Tree Powerup Logic
        const now = Date.now();
        
        // Update Last Chomp Time for Ghost Light
        const updates: Partial<GameState> = { lastChompTime: now };
        
        // 30 seconds window for 3 trees (eased from 10s)
        let newTreesChomped = [...state.treesChomped.filter(t => now - t <= 30000), now];
        let isTreePowerupActive = state.isTreePowerupActive;
        let treePowerupEndTime = state.treePowerupEndTime;
        let hasSeenTreePowerupPopup = state.hasSeenTreePowerupPopup;
        let notification = state.notification;
        let isPaused = state.isPaused;
        let lastPauseStartTime = state.lastPauseStartTime;
        
        if (newTreesChomped.length >= 3 && !isTreePowerupActive) {
            isTreePowerupActive = true;
            treePowerupEndTime = now + 22500; // 22.5 seconds duration (+50%)
            audioService.playLevelUp(); 
            if (!hasSeenTreePowerupPopup) {
                hasSeenTreePowerupPopup = true;
                notification = { 
                    title: "MEGA CHOMP ACTIVATED!", 
                    message: "You chomped 3 trees in 30 seconds! For the next 22.5 seconds, you can chomp multiple trees at once! Get to work!", 
                    type: "info" 
                };
                isPaused = true;
                lastPauseStartTime = now;
            }
        }

        return {
          activeTreeId: isFelled ? null : id,
          trees: state.trees.map(t => t.id === id ? { ...t, health: newHealth, isFelled } : t),
          looseLogs: [...state.looseLogs, ...newLooseLogs],
          food: [...state.food, ...newFood],
          treesChomped: newTreesChomped,
          isTreePowerupActive,
          treePowerupEndTime,
          hasSeenTreePowerupPopup,
          notification,
          isPaused,
          lastPauseStartTime,
          ...updates
        };
    }

    return {
      activeTreeId: isFelled ? null : id,
      trees: state.trees.map(t => t.id === id ? { ...t, health: newHealth, isFelled } : t),
      looseLogs: [...state.looseLogs, ...newLooseLogs]
    };
  }),

  setActiveTree: (id) => set((state) => {
      if (state.activeTreeId === id) return {};
      return { activeTreeId: id };
  }),

  updateDamIntegrity: (val) => set({ damIntegrity: val }),
  
  takeDamage: (amount) => set((state) => {
      if (state.phase === 'GAMEOVER') return {};
      const newHealth = Math.max(0, state.health - amount);
      if (newHealth === 0) {
          state.endGame();
          return { health: 0 };
      }
      return { health: newHealth };
  }),

  heal: (amount) => set((state) => ({
      health: Math.min(state.maxHealth, state.health + amount)
  })),

  collectFood: (id) => set((state) => {
      const food = state.food.find(f => f.id === id);
      if (!food) return {};
      
      audioService.playSuccess(); // Or a crunch sound
      
      // Heal - Allow Overheal up to 200%
      const healAmount = food.type === 'apple' ? 20 : 10;
      const maxOverheal = state.maxHealth * 2;
      const newHealth = Math.min(maxOverheal, state.health + healAmount);
      
      return {
          food: state.food.filter(f => f.id !== id),
          health: newHealth
      };
  }),

  // --- New Actions ---
  
  openBuildMenu: () => set((state) => ({ 
      isPlacementMode: false, 
      isBuildMenuOpen: true,
      isPaused: true,
      lastPauseStartTime: Date.now(),
      // Close combo session
      combo: { ...state.combo, active: false, multiplier: 1 }
  })),
  
  closeBuildMenu: () => set((state) => {
      const pauseDuration = Date.now() - state.lastPauseStartTime;
      return { 
          isPlacementMode: false, 
          isBuildMenuOpen: false, 
          selectedBlueprintId: null, 
          isPaused: false,
          combo: {
              ...state.combo,
              startTime: state.combo.startTime + (state.combo.active ? pauseDuration : 0),
              levelStartTime: state.combo.levelStartTime + (state.combo.active ? pauseDuration : 0),
              lastLogTime: state.combo.lastLogTime + (state.combo.active ? pauseDuration : 0)
          }
      };
  }),
  
  selectBlueprint: (id) => set((state) => {
      const pauseDuration = Date.now() - state.lastPauseStartTime;
      return { 
          selectedBlueprintId: id, 
          isPlacementMode: true,
          isBuildMenuOpen: false,
          isPaused: false,
          placementRotation: [0, 0, 0],
          combo: {
              ...state.combo,
              startTime: state.combo.startTime + (state.combo.active ? pauseDuration : 0),
              levelStartTime: state.combo.levelStartTime + (state.combo.active ? pauseDuration : 0),
              lastLogTime: state.combo.lastLogTime + (state.combo.active ? pauseDuration : 0)
          }
      };
  }),
  
  updatePlacementRotation: (x, y) => set((state) => {
      // Joystick input modifies rotation/tilt
      // x -> rotate around Y (yaw)
      // y -> rotate around X (pitch/tilt)
      const speed = 0.05;
      return {
          placementRotation: [
              state.placementRotation[0] + y * speed,
              state.placementRotation[1] + x * speed,
              state.placementRotation[2]
          ]
      };
  }),
  
  placeStructure: (position) => set((state) => {
      if (!state.selectedBlueprintId) return {};
      const blueprint = state.blueprints.find(b => b.id === state.selectedBlueprintId);
      if (!blueprint) return {};
      
      if (state.woodCount < blueprint.cost) return {}; // Should be checked in UI too
      
      const newStructure: PlacedStructure = {
          id: `struct-${Date.now()}`,
          blueprintId: blueprint.id,
          position: position,
          rotation: state.placementRotation,
          health: blueprint.cost * 10, // Arbitrary health based on cost
          maxHealth: blueprint.cost * 10
      };
      
      audioService.playSplash(); // Sound effect for placement
      
      return {
          woodCount: state.woodCount - blueprint.cost,
          placedStructures: [...state.placedStructures, newStructure],
          isPlacementMode: false,
          selectedBlueprintId: null
      };
  }),
  
  setDestroyTarget: (id) => set({ destroyTargetId: id }),
  
  startDestroying: () => set({ isDestroying: true }),
  
  stopDestroying: () => set({ isDestroying: false }),
  
  tickDestruction: (delta) => set((state) => {
      if (!state.isDestroying || !state.destroyTargetId) return {};
      
      const structure = state.placedStructures.find(s => s.id === state.destroyTargetId);
      if (!structure) return { isDestroying: false, destroyTargetId: null };
      
      const damageRate = structure.maxHealth / (2.0 + (structure.maxHealth / 1000));
      
      const newHealth = Math.max(0, structure.health - damageRate * delta);
      
      if (newHealth <= 0) {
          // Destroyed!
          audioService.playChomp();
          
          // Spawn 80% of logs
          const blueprint = state.blueprints.find(b => b.id === structure.blueprintId);
          const cost = blueprint ? blueprint.cost : 10;
          const logsToSpawn = Math.floor(cost * 0.8);
          
          const newLooseLogs: LooseLogData[] = [];
          for (let i = 0; i < logsToSpawn; i++) {
              // Scatter around structure position
              const angle = Math.random() * Math.PI * 2;
              const dist = Math.random() * 4;
              const lx = structure.position[0] + Math.cos(angle) * dist;
              const lz = structure.position[2] + Math.sin(angle) * dist;
              const lh = calculateTerrainHeight(lx, lz);
              
              newLooseLogs.push({
                  id: `loose-struct-${structure.id}-${Date.now()}-${i}`,
                  position: [lx, lh + 5 + Math.random() * 5, lz], // Drop from height
                  rotation: [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI],
                  createdAt: Date.now() + (i * 50)
              });
          }

          return {
              placedStructures: state.placedStructures.filter(s => s.id !== state.destroyTargetId),
              looseLogs: [...state.looseLogs, ...newLooseLogs],
              isDestroying: false,
              destroyTargetId: null
          };
      }
      
      return {
          placedStructures: state.placedStructures.map(s => s.id === state.destroyTargetId ? { ...s, health: newHealth } : s)
      };
  }),
  
  checkPowerups: () => set((state) => {
      const now = Date.now();
      let updates: Partial<GameState> = {};
      
      if (state.isTreePowerupActive && now > state.treePowerupEndTime) {
          updates.isTreePowerupActive = false;
          // Do NOT reset hasSeenTreePowerupPopup so it doesn't popup again
          updates.treesChomped = []; // Clear history
      }
      
      if (state.isLogPowerupActive && now > state.logPowerupEndTime) {
          updates.isLogPowerupActive = false;
          // Do NOT reset hasSeenLogPowerupPopup so it doesn't popup again
      }
      
      return updates;
  }),

  startChompingSession: () => set((state) => {
      if (state.combo.active) return {};
      return {
          combo: {
              active: true,
              startTime: Date.now(),
              logsCollected: 0,
              multiplier: 1,
              lastLogTime: Date.now(),
              logsSinceLastLevel: 0,
              levelStartTime: Date.now()
          }
      };
  }),

  // Time & Mobs
  updateTime: (delta, playerPos) => set((state) => {
      if (state.isPaused) return {};
      
      const dayProgress = delta / state.dayDuration;
      let newTime = state.timeOfDay + dayProgress;
      if (newTime >= 1) newTime -= 1; // Loop day
      
      // Mob Spawning Logic (Night time: 0.75 to 0.25)
      const isNight = newTime > 0.75 || newTime < 0.25;
      
      let newMobs = [...state.mobs];
      
      if (isNight) {
          // Chance to spawn mob
          if (state.mobs.length < 8 && Math.random() < 0.01) { // Increased chance
             const angle = Math.random() * Math.PI * 2;
             const dist = 30 + Math.random() * 20; // Spawn away from player
             
             newMobs.push({
                 id: `mob-${Date.now()}`,
                 position: [playerPos[0] + Math.cos(angle) * dist, 0, playerPos[2] + Math.sin(angle) * dist],
                 velocity: [0, 0, 0],
                 type: Math.random() > 0.5 ? 'wolf' : 'bear',
                 createdAt: Date.now()
             });
          }
      } else {
          // Despawn mobs during day
          if (newMobs.length > 0 && Math.random() < 0.02) {
              newMobs.pop();
          }
      }
      
      // Overheal Decay
      let newHealth = state.health;
      if (newHealth > state.maxHealth) {
          // Decay rate: 1 HP per 5 seconds = 0.2 HP per second
          newHealth = Math.max(state.maxHealth, newHealth - 0.2 * delta);
      }
      
      return { timeOfDay: newTime, mobs: newMobs, health: newHealth };
  }),
  
  spawnMob: (playerPos) => set((state) => {
      const angle = Math.random() * Math.PI * 2;
      const dist = 25 + Math.random() * 15;
      return {
          mobs: [...state.mobs, {
             id: `mob-${Date.now()}`,
             position: [playerPos[0] + Math.cos(angle) * dist, 0, playerPos[2] + Math.sin(angle) * dist],
             velocity: [0, 0, 0],
             type: Math.random() > 0.5 ? 'wolf' : 'bear',
             createdAt: Date.now()
          }]
      };
  }),
  removeMob: (id) => set((state) => ({ mobs: state.mobs.filter(m => m.id !== id) })),
  
  checkCombo: () => set((state) => {
      // Check if combo should expire (e.g. no logs for too long?)
      // The prompt says "A doubler stays active as long as the log collection speed of the next 5 logs is >= 30 seconds"
      // This implies if it takes longer than 30s, we might lose the multiplier?
      // Let's implement a timeout check here if needed, but for now we rely on collection events.
      return {};
  })
}));