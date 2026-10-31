import { create } from 'zustand';
import { GamePhase, CameraMode, TreeData, LogData, LooseLogData, BoulderData, Blueprint, PlacedStructure, ComboState, Notification, MobData, FoodData } from './types';
import { audioService } from './services/audio';
import { persistence, SaveData, SAVE_VERSION, sanitizeName } from './services/persistence';
import { currentWoodchuckPos, liveObjects, playerState } from './globals';

export const MAP_SIZE = 300;

// =====================================================================
// Tuning
// =====================================================================
const WATER_LEVEL = -1.5;
const START_TIME_OF_DAY = 0.08;   // Early morning - sun already up
const MAX_MOBS = 5;
const MOB_SPAWN_RATE = 0.3;       // Average spawns per second at night (below MAX_MOBS)
const MOB_DESPAWN_RATE = 1.2;     // Average despawns per second during the day

const TREE_COUNT = 250;
const BOULDER_COUNT = 80;
const FOOD_DROP_CHANCE = 0.4;     // Chance a felled tree drops a fruit (apple or berry, 50/50)

const TREE_POWERUP_DURATION = 22500;   // Mega Chomp
const LOG_POWERUP_DURATION = 30000;    // Magnet
export const BERRIES_FOR_ZOOMIES = 3;  // Berries to eat to trigger Zoomies
const SPEED_POWERUP_DURATION = 20000;  // Zoomies

// Score needed to unlock each blueprint (index 0 = unlocked by collecting 3 logs)
const BLUEPRINT_THRESHOLDS = [0, 150, 300, 500, 750, 1050, 1400, 1800, 2250, 2750];

type Vec3 = [number, number, number];

export interface ActionResult {
    ok: boolean;
    message: string;
}

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
  woodchuckPosition: Vec3;
  activeTreeId: string | null;

  // World (deterministic from the seed: trees, boulders, blueprint shapes)
  worldSeed: number;
  runId: number;                 // Incremented on every new/loaded game so the player respawns
  spawnPoint: Vec3 | null;       // Set when loading a save; null = default river-bank spawn
  spawnFacing: number;

  // Blueprints & Structures
  blueprints: Blueprint[];
  placedStructures: PlacedStructure[];

  // Placement Mode
  isPlacementMode: boolean;
  isBuildMenuOpen: boolean;
  selectedBlueprintId: string | null;
  placementRotation: Vec3; // Euler angles

  // Game menu (pause menu: new / save / load / leaderboard)
  isGameMenuOpen: boolean;
  scoreSubmitted: boolean;

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

  berriesEaten: number;          // Progress towards Zoomies
  isSpeedPowerupActive: boolean;
  speedPowerupEndTime: number;
  hasSeenSpeedPowerupPopup: boolean;

  // Water / diving
  isInWater: boolean;
  breath: number;                // 0..1

  // Time & Mobs
  timeOfDay: number; // 0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight
  dayDuration: number; // in seconds (300s = 5m)
  day: number;
  mobs: MobData[];
  food: FoodData[];
  health: number;
  maxHealth: number;

  updateTime: (delta: number, playerPos: Vec3) => void;
  spawnMob: (playerPos: Vec3) => void;
  removeMob: (id: string) => void;

  startGame: (seed?: number) => void;
  endGame: () => void;
  addWood: () => void;
  placeLog: (position: Vec3, rotation: Vec3) => void;
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
  setWaterState: (isInWater: boolean, breath: number) => void;

  // Building
  openBuildMenu: () => void;
  closeBuildMenu: () => void;
  selectBlueprint: (id: string) => void;
  cancelPlacement: () => void;
  updatePlacementRotation: (x: number, y: number) => void; // Joystick input
  placeStructure: (position: Vec3, rotation?: Vec3) => void;
  setDestroyTarget: (id: string | null) => void;
  startDestroying: () => void;
  stopDestroying: () => void;
  tickDestruction: (delta: number) => void;
  checkPowerups: () => void;

  // Game menu / persistence
  openGameMenu: () => void;
  closeGameMenu: () => void;
  saveGame: (slot: number) => ActionResult;
  loadGame: (slot: number) => ActionResult;
  submitScore: (name: string) => number;

  // Combo Logic
  startChompingSession: () => void;
  checkCombo: () => void;
  cycleCameraMode: () => void;
}

// =====================================================================
// Terrain Helpers (unchanged)
// =====================================================================
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

// --- Day / Night ---
// timeOfDay: 0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight.
// The sun is below the horizon for the second half of the cycle.
// Single source of truth for lighting, mob spawning and the ghost light.
export const isNightTime = (t: number) => t >= 0.5;

// =====================================================================
// Seeded world generation
// The same seed always produces the same trees, boulders and blueprint shapes,
// which keeps save files tiny (seed + per-tree state) and saved structures intact.
// =====================================================================
const mulberry32 = (seed: number) => () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const newWorldSeed = () => Math.floor(Math.random() * 2147483647);

const generateBlueprints = (rand: () => number): Blueprint[] => {
    const blueprints: Blueprint[] = [];
    const baseCosts = [7, 15, 30, 60, 120, 240, 480, 960, 1920, 3840];
    const names = [
        "Small Pile", "Log Line", "Corner Wall", "Box Frame", "River Gate",
        "Dam Segment", "Fortress Wall", "Tower Base", "Mega Dam", "Woodchuck Palace"
    ];

    for (let i = 0; i < 10; i++) {
        const cost = baseCosts[i];
        const logs: { position: Vec3, rotation: Vec3 }[] = [];

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
                let z = (rand() - 0.5) * 0.4; // More Z variation

                // Add SIGNIFICANT chaos
                x += (rand() - 0.5) * 0.8;
                y += (rand() - 0.5) * 0.2;
                z += (rand() - 0.5) * 0.8;

                // Rotation chaos
                // Base rotation alternates per layer, but add random tilt
                let rotY = r % 2 === 0 ? 0 : Math.PI / 2;
                rotY += (rand() - 0.5) * 1.5; // +/- ~45 degrees

                const rotX = (rand() - 0.5) * 0.5; // More tilt
                const rotZ = (rand() - 0.5) * 0.5; // More tilt

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
            unlockScore: i === 0 ? 0 : BLUEPRINT_THRESHOLDS[i] // 0 is special case for 3 logs
        });
    }
    return blueprints;
};

const generateTrees = (seed: number, rand: () => number): TreeData[] =>
    Array.from({ length: TREE_COUNT }).map((_, i) => {
        let x = 0, z = 0;
        let attempts = 0;
        do {
            z = (rand() - 0.5) * MAP_SIZE * 0.9;
            const side = rand() > 0.5 ? 1 : -1;
            const rX = getRiverX(z);
            const rW = getRiverWidth(z);
            // Ensure trees don't spawn in water or on steep banks
            x = rX + side * (rW + 10 + rand() * (MAP_SIZE * 0.4));
            attempts++;
        } while (attempts < 20 && !isLand(x, z));

        const r = rand();
        let size: 'small' | 'medium' | 'large' = 'medium';
        let maxHealth = 200;

        if (r < 0.3) {
            size = 'small';
            maxHealth = 100;
        } else if (r > 0.7) {
            size = 'large';
            maxHealth = 300;
        }

        // The seed is part of the id so a new world never reuses an old physics body
        return {
            id: `tree-${seed}-${i}`,
            position: [x, 0, z] as Vec3,
            health: maxHealth,
            maxHealth: maxHealth,
            size: size,
            isFelled: false
        };
    });

const generateBoulders = (seed: number, rand: () => number): BoulderData[] =>
    Array.from({ length: BOULDER_COUNT }).map((_, i) => {
        const z = (rand() - 0.5) * MAP_SIZE * 0.95;
        const rX = getRiverX(z);
        const offset = (rand() - 0.5) * getRiverWidth(z) * 0.8;
        return {
            id: `boulder-${seed}-${i}`,
            position: [rX + offset, -3, z] as Vec3,
            scale: 1 + rand() * 2.0
        };
    });

const generateWorld = (seed: number) => {
    const rand = mulberry32(seed);
    const trees = generateTrees(seed, rand);
    const boulders = generateBoulders(seed, rand);
    const blueprints = generateBlueprints(rand);
    return { worldSeed: seed, trees, boulders, blueprints };
};

// =====================================================================
// Pause helpers
// Several things pause the game (notifications, build menu, game menu).
// The pause start is kept from the FIRST pause, and resuming shifts every
// time-based timer (combo, powerups) so paused time is not "lost".
// =====================================================================
const pauseFields = (state: GameState): Partial<GameState> =>
    state.isPaused ? { isPaused: true } : { isPaused: true, lastPauseStartTime: Date.now() };

const resumeFields = (state: GameState): Partial<GameState> => {
    if (!state.isPaused) return {};
    const d = Date.now() - state.lastPauseStartTime;
    return {
        isPaused: false,
        combo: state.combo.active
            ? {
                ...state.combo,
                startTime: state.combo.startTime + d,
                levelStartTime: state.combo.levelStartTime + d,
                lastLogTime: state.combo.lastLogTime + d
              }
            : state.combo,
        treePowerupEndTime: state.isTreePowerupActive ? state.treePowerupEndTime + d : state.treePowerupEndTime,
        logPowerupEndTime: state.isLogPowerupActive ? state.logPowerupEndTime + d : state.logPowerupEndTime,
        speedPowerupEndTime: state.isSpeedPowerupActive ? state.speedPowerupEndTime + d : state.speedPowerupEndTime,
    };
};

// A pausing notification (unlock, milestone, powerup tutorial)
const notifyAndPause = (state: GameState, notification: Notification): Partial<GameState> => ({
    notification,
    ...pauseFields(state),
});

const EMPTY_COMBO: ComboState = { active: false, startTime: 0, logsCollected: 0, multiplier: 1, lastLogTime: 0, logsSinceLastLevel: 0, levelStartTime: 0 };

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const roundVec = (v: Vec3 | number[]): Vec3 => [round3(v[0]), round3(v[1]), round3(v[2])];

// =====================================================================
// Log collection (shared by loose logs and placed logs)
// =====================================================================
const applyLogCollected = (state: GameState): Partial<GameState> => {
    const now = Date.now();
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
        logPowerupEndTime = now + LOG_POWERUP_DURATION;
        audioService.playLevelUp();
        if (!hasSeenLogPowerupPopup) {
            hasSeenLogPowerupPopup = true;
            notification = {
                id: `magnet-${now}`,
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
    const newBlueprints = [...state.blueprints];

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
    for (let i = 1; i < BLUEPRINT_THRESHOLDS.length; i++) {
        if (!newBlueprints[i].unlocked && newScore >= BLUEPRINT_THRESHOLDS[i]) {
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
        combo: newCombo,
        blueprints: newBlueprints,
        notification: notification,
        isLogPowerupActive,
        logPowerupEndTime,
        hasSeenLogPowerupPopup,
        // Never un-pause here: a physics collision can fire while a menu is open
        ...(shouldPause ? pauseFields(state) : {})
    };
};

// =====================================================================
// Store
// =====================================================================
const initialWorld = generateWorld(newWorldSeed());

export const useGameStore = create<GameState>((set, get) => ({
  phase: 'START',
  woodCount: 0,
  score: 0,
  totalLogsCollected: 0,
  notification: null,
  damIntegrity: 0,
  worldSeed: initialWorld.worldSeed,
  trees: initialWorld.trees,
  logs: [],
  looseLogs: [],
  boulders: initialWorld.boulders,
  woodchuckPosition: [0, 5, 0],
  activeTreeId: null,
  runId: 0,
  spawnPoint: null,
  spawnFacing: Math.PI / 2,

  // Blueprints
  blueprints: initialWorld.blueprints,
  placedStructures: [],
  cameraMode: 'BEHIND',
  isPlacementMode: false,
  isBuildMenuOpen: false,
  selectedBlueprintId: null,
  placementRotation: [0, 0, 0],

  isGameMenuOpen: false,
  scoreSubmitted: false,

  // Destruction
  destroyTargetId: null,
  isDestroying: false,
  isPaused: false,
  lastPauseStartTime: 0,

  // Combo
  combo: { ...EMPTY_COMBO },

  // Powerups
  lastChompTime: 0,
  treesChomped: [],
  isTreePowerupActive: false,
  treePowerupEndTime: 0,
  hasSeenTreePowerupPopup: false,

  isLogPowerupActive: false,
  logPowerupEndTime: 0,
  hasSeenLogPowerupPopup: false,

  berriesEaten: 0,
  isSpeedPowerupActive: false,
  speedPowerupEndTime: 0,
  hasSeenSpeedPowerupPopup: false,

  isInWater: false,
  breath: 1,

  // Time & Mobs
  timeOfDay: START_TIME_OF_DAY,
  dayDuration: 300,
  day: 1,
  mobs: [],
  food: [],
  health: 100,
  maxHealth: 100,

  // A brand new run in a brand new (seeded) world
  startGame: (seed) => set((state) => {
      const world = generateWorld(seed ?? newWorldSeed());
      return {
          phase: 'PLAYING',
          runId: state.runId + 1,
          spawnPoint: null,
          spawnFacing: Math.PI / 2,
          worldSeed: world.worldSeed,
          trees: world.trees,
          boulders: world.boulders,
          blueprints: world.blueprints,
          woodCount: 0,
          score: 0,
          totalLogsCollected: 0,
          notification: null,
          damIntegrity: 0,
          logs: [],
          looseLogs: [],
          activeTreeId: null,
          placedStructures: [],
          combo: { ...EMPTY_COMBO },
          isBuildMenuOpen: false,
          isPlacementMode: false,
          selectedBlueprintId: null,
          placementRotation: [0, 0, 0],
          isGameMenuOpen: false,
          scoreSubmitted: false,
          destroyTargetId: null,
          isDestroying: false,
          isPaused: false,
          lastPauseStartTime: 0,
          lastChompTime: 0,
          treesChomped: [],
          isTreePowerupActive: false,
          treePowerupEndTime: 0,
          isLogPowerupActive: false,
          logPowerupEndTime: 0,
          berriesEaten: 0,
          isSpeedPowerupActive: false,
          speedPowerupEndTime: 0,
          isInWater: false,
          breath: 1,
          timeOfDay: START_TIME_OF_DAY,
          day: 1,
          mobs: [],
          food: [],
          health: 100,
          maxHealth: 100
      };
  }),
  endGame: () => set({ phase: 'GAMEOVER', isPaused: true, isGameMenuOpen: false, isBuildMenuOpen: false }),

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
      // Stay paused if a menu is still open
      if (state.isBuildMenuOpen || state.isGameMenuOpen || state.phase !== 'PLAYING') {
          return { notification: null };
      }
      return { notification: null, ...resumeFields(state) };
  }),

  collectLooseLog: (id: string) => set((state) => {
      const log = state.looseLogs.find(l => l.id === id);
      if (!log) return state;
      // Invulnerability (0.5s)
      if (Date.now() - log.createdAt < 500) return state;
      return {
          ...applyLogCollected(state),
          looseLogs: state.looseLogs.filter(l => l.id !== id)
      };
  }),

  collectLog: (id: string) => set((state) => {
      const log = state.logs.find(l => l.id === id);
      if (!log) return state;
      // Invulnerability (0.5s)
      if (Date.now() - log.createdAt < 500) return state;
      return {
          ...applyLogCollected(state),
          logs: state.logs.filter(l => l.id !== id)
      };
  }),

  expireLooseLog: (id: string) => set((state) => ({
      looseLogs: state.looseLogs.filter(l => l.id !== id)
  })),

  placeLog: (position, rotation) => set((state) => {
    if (state.woodCount <= 0) return state;
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
    if (!tree || tree.isFelled) return state;

    const newHealth = Math.max(0, tree.health - amount);
    const isFelled = newHealth === 0;

    if (!isFelled) {
        return {
          activeTreeId: id,
          trees: state.trees.map(t => t.id === id ? { ...t, health: newHealth } : t)
        };
    }

    // --- Felled ---
    const now = Date.now();

    // Spawn multiple logs based on tree size
    const newLooseLogs: LooseLogData[] = [];
    const logCount = tree.size === 'large' ? 3 : tree.size === 'medium' ? 2 : 1;
    for (let i = 0; i < logCount; i++) {
        // Scatter logs more widely
        const angle = (Math.PI * 2 * i) / logCount + Math.random();
        const distance = 2.0 + Math.random() * 2.5;

        const lx = tree.position[0] + Math.cos(angle) * distance;
        const lz = tree.position[2] + Math.sin(angle) * distance;
        const lh = calculateTerrainHeight(lx, lz);

        newLooseLogs.push({
            id: `loose-${id}-${now}-${i}`,
            position: [lx, lh + 3.0, lz],
            rotation: [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI],
            createdAt: now + (i * 100) // Slight stagger in creation time
        });
    }

    // Drop Food
    const newFood: FoodData[] = [];
    if (Math.random() < FOOD_DROP_CHANCE) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 1.5 + Math.random();
        const fx = tree.position[0] + Math.cos(angle) * dist;
        const fz = tree.position[2] + Math.sin(angle) * dist;
        const fh = calculateTerrainHeight(fx, fz);

        newFood.push({
            id: `food-${id}-${now}`,
            position: [fx, fh + 2.0, fz],
            rotation: [0, Math.random() * Math.PI * 2, 0],
            createdAt: now,
            type: Math.random() > 0.5 ? 'apple' : 'berry'
        });
    }

    audioService.playChomp();

    // Tree Powerup Logic - 3 trees within 30 seconds
    const newTreesChomped = [...state.treesChomped.filter(t => now - t <= 30000), now];
    let isTreePowerupActive = state.isTreePowerupActive;
    let treePowerupEndTime = state.treePowerupEndTime;
    let hasSeenTreePowerupPopup = state.hasSeenTreePowerupPopup;
    let popup: Partial<GameState> = {};

    if (newTreesChomped.length >= 3 && !isTreePowerupActive) {
        isTreePowerupActive = true;
        treePowerupEndTime = now + TREE_POWERUP_DURATION;
        audioService.playLevelUp();
        if (!hasSeenTreePowerupPopup) {
            hasSeenTreePowerupPopup = true;
            popup = notifyAndPause(state, {
                id: `mega-chomp-${now}`,
                title: "MEGA CHOMP ACTIVATED!",
                message: "You chomped 3 trees in 30 seconds! For the next 22.5 seconds, you can chomp multiple trees at once! Get to work!",
                type: "info"
            });
        }
    }

    return {
      activeTreeId: null,
      trees: state.trees.map(t => t.id === id ? { ...t, health: 0, isFelled: true } : t),
      looseLogs: [...state.looseLogs, ...newLooseLogs],
      food: [...state.food, ...newFood],
      treesChomped: newTreesChomped,
      isTreePowerupActive,
      treePowerupEndTime,
      hasSeenTreePowerupPopup,
      lastChompTime: now, // Ghost light
      ...popup
    };
  }),

  setActiveTree: (id) => set((state) => {
      if (state.activeTreeId === id) return state;
      return { activeTreeId: id };
  }),

  updateDamIntegrity: (val) => set({ damIntegrity: val }),

  takeDamage: (amount) => set((state) => {
      if (state.phase !== 'PLAYING') return state;
      const newHealth = Math.max(0, state.health - amount);
      if (newHealth === 0) {
          return { health: 0, phase: 'GAMEOVER', isPaused: true, isGameMenuOpen: false, isBuildMenuOpen: false, isPlacementMode: false };
      }
      return { health: newHealth };
  }),

  heal: (amount) => set((state) => ({
      health: Math.min(state.maxHealth, state.health + amount)
  })),

  collectFood: (id) => set((state) => {
      const food = state.food.find(f => f.id === id);
      if (!food) return state;

      audioService.playSuccess();

      // Heal - Allow Overheal up to 200%
      const healAmount = food.type === 'apple' ? 20 : 10;
      const maxOverheal = state.maxHealth * 2;
      const updates: Partial<GameState> = {
          food: state.food.filter(f => f.id !== id),
          health: Math.min(maxOverheal, state.health + healAmount)
      };

      // Berries charge up Zoomies (speed boost)
      if (food.type === 'berry') {
          const berries = state.berriesEaten + 1;
          if (berries >= BERRIES_FOR_ZOOMIES) {
              const now = Date.now();
              updates.berriesEaten = 0;
              updates.isSpeedPowerupActive = true;
              // Eating more berries while active extends it
              updates.speedPowerupEndTime = Math.max(state.isSpeedPowerupActive ? state.speedPowerupEndTime : 0, now) + SPEED_POWERUP_DURATION;
              audioService.playLevelUp();
              if (!state.hasSeenSpeedPowerupPopup) {
                  updates.hasSeenSpeedPowerupPopup = true;
                  Object.assign(updates, notifyAndPause(state, {
                      id: `zoomies-${now}`,
                      title: "ZOOMIES!",
                      message: `${BERRIES_FOR_ZOOMIES} berries = sugar rush! Chucky runs and swims much faster for ${SPEED_POWERUP_DURATION / 1000} seconds!`,
                      type: 'info'
                  }));
              }
          } else {
              updates.berriesEaten = berries;
          }
      }
      return updates;
  }),

  setWaterState: (isInWater, breath) => set((state) => {
      if (state.isInWater === isInWater && state.breath === breath) return state;
      return { isInWater, breath };
  }),

  // --- Building ---

  openBuildMenu: () => set((state) => ({
      isPlacementMode: false,
      isBuildMenuOpen: true,
      ...pauseFields(state),
      // Close combo session
      combo: { ...state.combo, active: false, multiplier: 1 }
  })),

  closeBuildMenu: () => set((state) => ({
      isPlacementMode: false,
      isBuildMenuOpen: false,
      selectedBlueprintId: null,
      ...(state.isGameMenuOpen || state.notification ? {} : resumeFields(state))
  })),

  selectBlueprint: (id) => set((state) => ({
      selectedBlueprintId: id,
      isPlacementMode: true,
      isBuildMenuOpen: false,
      placementRotation: [0, 0, 0],
      ...(state.isGameMenuOpen || state.notification ? {} : resumeFields(state))
  })),

  cancelPlacement: () => set({ isPlacementMode: false, selectedBlueprintId: null, placementRotation: [0, 0, 0] }),

  updatePlacementRotation: (x, y) => set((state) => {
      // x -> rotate around Y (yaw), y -> rotate around X (pitch/tilt)
      const speed = 0.05;
      return {
          placementRotation: [
              state.placementRotation[0] + y * speed,
              state.placementRotation[1] + x * speed,
              state.placementRotation[2]
          ]
      };
  }),

  placeStructure: (position, rotation) => set((state) => {
      if (!state.selectedBlueprintId) return state;
      const blueprint = state.blueprints.find(b => b.id === state.selectedBlueprintId);
      if (!blueprint) return state;

      if (state.woodCount < blueprint.cost) return state; // Should be checked in UI too

      const newStructure: PlacedStructure = {
          id: `struct-${Date.now()}`,
          blueprintId: blueprint.id,
          position: position,
          rotation: rotation ?? state.placementRotation,
          health: blueprint.cost * 10, // Arbitrary health based on cost
          maxHealth: blueprint.cost * 10
      };

      audioService.playSplash(); // Sound effect for placement

      return {
          woodCount: state.woodCount - blueprint.cost,
          placedStructures: [...state.placedStructures, newStructure],
          isPlacementMode: false,
          selectedBlueprintId: null,
          placementRotation: [0, 0, 0]
      };
  }),

  setDestroyTarget: (id) => set((state) => state.destroyTargetId === id ? state : { destroyTargetId: id }),

  startDestroying: () => set({ isDestroying: true }),

  stopDestroying: () => set((state) => state.isDestroying ? { isDestroying: false } : state),

  tickDestruction: (delta) => set((state) => {
      if (!state.isDestroying || !state.destroyTargetId) return state;

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
      const updates: Partial<GameState> = {};

      if (state.isTreePowerupActive && now > state.treePowerupEndTime) {
          updates.isTreePowerupActive = false;
          updates.treesChomped = []; // Clear history
      }
      if (state.isLogPowerupActive && now > state.logPowerupEndTime) {
          updates.isLogPowerupActive = false;
      }
      if (state.isSpeedPowerupActive && now > state.speedPowerupEndTime) {
          updates.isSpeedPowerupActive = false;
      }

      // Return the untouched state when nothing changed so subscribers are not woken every frame
      return Object.keys(updates).length > 0 ? updates : state;
  }),

  // --- Game menu ---

  openGameMenu: () => set((state) => {
      if (state.phase !== 'PLAYING' || state.isGameMenuOpen) return state;
      return { isGameMenuOpen: true, isDestroying: false, ...pauseFields(state) };
  }),

  closeGameMenu: () => set((state) => {
      if (!state.isGameMenuOpen) return state;
      return {
          isGameMenuOpen: false,
          ...(state.isBuildMenuOpen || state.notification ? {} : resumeFields(state))
      };
  }),

  saveGame: (slot) => {
      const s = get();
      if (s.phase !== 'PLAYING') return { ok: false, message: 'Start a game before saving.' };
      if (!persistence.isAvailable()) return { ok: false, message: 'Saving is not available in this browser (private mode?).' };

      // Timers are frozen while paused (the menu is open), so measure from the pause start
      const ref = s.isPaused ? s.lastPauseStartTime : Date.now();
      const remaining = (active: boolean, end: number) => active ? Math.max(0, end - ref) : 0;

      const data: SaveData = {
          version: SAVE_VERSION,
          savedAt: Date.now(),
          worldSeed: s.worldSeed,
          day: s.day,
          timeOfDay: s.timeOfDay,
          woodCount: s.woodCount,
          score: s.score,
          totalLogsCollected: s.totalLogsCollected,
          health: s.health,
          maxHealth: s.maxHealth,
          berriesEaten: s.berriesEaten,
          cameraMode: s.cameraMode,
          trees: s.trees.map(t => [Math.round(t.health), t.isFelled ? 1 : 0] as [number, 0 | 1]),
          unlockedBlueprints: s.blueprints.map(b => b.unlocked),
          placedStructures: s.placedStructures.map(p => ({ ...p, position: roundVec(p.position), rotation: roundVec(p.rotation) })),
          // Live physics positions, so logs/fruit come back where they actually are
          looseLogs: s.looseLogs.map(l => {
              const obj = liveObjects.looseLogs.get(l.id);
              return {
                  position: roundVec(obj ? [obj.position.x, obj.position.y, obj.position.z] : l.position),
                  rotation: roundVec(obj ? [obj.rotation.x, obj.rotation.y, obj.rotation.z] : l.rotation),
                  age: Math.max(0, ref - l.createdAt)
              };
          }),
          food: s.food.map(f => {
              const obj = liveObjects.food.get(f.id);
              return { position: roundVec(obj ? [obj.position.x, obj.position.y, obj.position.z] : f.position), type: f.type };
          }),
          player: {
              position: roundVec([currentWoodchuckPos.x, currentWoodchuckPos.y, currentWoodchuckPos.z]),
              facing: round3(playerState.facing)
          },
          powerups: {
              treeMs: remaining(s.isTreePowerupActive, s.treePowerupEndTime),
              logMs: remaining(s.isLogPowerupActive, s.logPowerupEndTime),
              speedMs: remaining(s.isSpeedPowerupActive, s.speedPowerupEndTime)
          },
          seenPopups: { tree: s.hasSeenTreePowerupPopup, log: s.hasSeenLogPowerupPopup, speed: s.hasSeenSpeedPowerupPopup }
      };

      const ok = persistence.writeSlot(slot, data);
      return ok
          ? { ok: true, message: `Saved to slot ${slot}.` }
          : { ok: false, message: 'Could not save (storage full or blocked).' };
  },

  loadGame: (slot) => {
      const data = persistence.readSlot(slot);
      if (!data) return { ok: false, message: `Slot ${slot} is empty or from an older version.` };

      try {
          const now = Date.now();
          const world = generateWorld(data.worldSeed);
          const tag = `L${now}`; // Fresh ids so React/physics create new bodies

          set((state) => ({
              phase: 'PLAYING',
              runId: state.runId + 1,
              spawnPoint: data.player.position,
              spawnFacing: data.player.facing,
              worldSeed: world.worldSeed,
              boulders: world.boulders,
              trees: world.trees.map((t, i) => {
                  const saved = data.trees[i];
                  return saved ? { ...t, health: saved[0], isFelled: saved[1] === 1 } : t;
              }),
              blueprints: world.blueprints.map((b, i) => ({ ...b, unlocked: !!data.unlockedBlueprints[i] })),
              placedStructures: data.placedStructures,
              looseLogs: data.looseLogs.map((l, i) => ({
                  id: `loose-${tag}-${i}`,
                  position: l.position,
                  rotation: l.rotation,
                  createdAt: now - l.age,
                  settled: true
              })),
              food: data.food.map((f, i) => ({
                  id: `food-${tag}-${i}`,
                  position: f.position,
                  rotation: [0, 0, 0],
                  createdAt: now,
                  type: f.type
              })),
              logs: [],
              woodCount: data.woodCount,
              score: data.score,
              totalLogsCollected: data.totalLogsCollected,
              health: data.health,
              maxHealth: data.maxHealth,
              day: data.day,
              timeOfDay: data.timeOfDay,
              berriesEaten: data.berriesEaten,
              cameraMode: data.cameraMode || state.cameraMode,
              isTreePowerupActive: data.powerups.treeMs > 0,
              treePowerupEndTime: now + data.powerups.treeMs,
              isLogPowerupActive: data.powerups.logMs > 0,
              logPowerupEndTime: now + data.powerups.logMs,
              isSpeedPowerupActive: data.powerups.speedMs > 0,
              speedPowerupEndTime: now + data.powerups.speedMs,
              hasSeenTreePowerupPopup: data.seenPopups.tree,
              hasSeenLogPowerupPopup: data.seenPopups.log,
              hasSeenSpeedPowerupPopup: data.seenPopups.speed,
              treesChomped: [],
              lastChompTime: 0,
              combo: { ...EMPTY_COMBO },
              mobs: [],
              activeTreeId: null,
              notification: null,
              isBuildMenuOpen: false,
              isPlacementMode: false,
              selectedBlueprintId: null,
              placementRotation: [0, 0, 0],
              isGameMenuOpen: false,
              scoreSubmitted: false,
              destroyTargetId: null,
              isDestroying: false,
              isPaused: false,
              lastPauseStartTime: 0,
              isInWater: false,
              breath: 1
          }));
          return { ok: true, message: `Loaded slot ${slot}.` };
      } catch (e) {
          console.error('[Chucky] Load failed:', e);
          return { ok: false, message: 'That save could not be loaded.' };
      }
  },

  submitScore: (name) => {
      const s = get();
      if (s.scoreSubmitted) return -1;
      const clean = sanitizeName(name);
      persistence.setPlayerName(clean);
      const rank = persistence.addLeaderboardEntry({
          name: clean,
          score: s.score,
          logs: s.totalLogsCollected,
          structures: s.placedStructures.length,
          day: s.day,
          date: Date.now()
      });
      set({ scoreSubmitted: true });
      return rank;
  },

  startChompingSession: () => set((state) => {
      if (state.combo.active) return state;
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

  // --- Time & Mobs ---
  updateTime: (delta, playerPos) => set((state) => {
      if (state.isPaused || state.phase !== 'PLAYING') return state;

      const dayProgress = delta / state.dayDuration;
      let newTime = state.timeOfDay + dayProgress;
      let newDay = state.day;
      if (newTime >= 1) {
          newTime -= 1; // Loop day
          newDay += 1;
      }

      // Only create a new mobs array when a mob is actually added or removed
      let newMobs = state.mobs;

      if (isNightTime(newTime)) {
          if (state.mobs.length < MAX_MOBS && Math.random() < MOB_SPAWN_RATE * delta) {
             const angle = Math.random() * Math.PI * 2;
             const dist = 30 + Math.random() * 20; // Spawn away from player
             const limit = MAP_SIZE / 2 - 10;
             const mx = Math.max(-limit, Math.min(limit, playerPos[0] + Math.cos(angle) * dist));
             const mz = Math.max(-limit, Math.min(limit, playerPos[2] + Math.sin(angle) * dist));
             const groundY = calculateTerrainHeight(mx, mz);

             // Mobs are land animals - skip this spawn attempt if the spot is under water
             if (groundY > WATER_LEVEL + 0.5) {
                 newMobs = [...state.mobs, {
                     id: `mob-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
                     position: [mx, groundY + 2, mz],
                     velocity: [0, 0, 0],
                     type: Math.random() > 0.5 ? 'wolf' : 'bear',
                     createdAt: Date.now()
                 }];
             }
          }
      } else if (state.mobs.length > 0 && Math.random() < MOB_DESPAWN_RATE * delta) {
          // Despawn mobs during the day
          newMobs = state.mobs.slice(0, -1);
      }

      // Overheal Decay: 1 HP per 5 seconds
      let newHealth = state.health;
      if (newHealth > state.maxHealth) {
          newHealth = Math.max(state.maxHealth, newHealth - 0.2 * delta);
      }

      return { timeOfDay: newTime, day: newDay, mobs: newMobs, health: newHealth };
  }),

  spawnMob: (playerPos) => set((state) => {
      const angle = Math.random() * Math.PI * 2;
      const dist = 25 + Math.random() * 15;
      const mx = playerPos[0] + Math.cos(angle) * dist;
      const mz = playerPos[2] + Math.sin(angle) * dist;
      return {
          mobs: [...state.mobs, {
             id: `mob-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
             position: [mx, calculateTerrainHeight(mx, mz) + 2, mz],
             velocity: [0, 0, 0],
             type: Math.random() > 0.5 ? 'wolf' : 'bear',
             createdAt: Date.now()
          }]
      };
  }),
  removeMob: (id) => set((state) => ({ mobs: state.mobs.filter(m => m.id !== id) })),

  checkCombo: () => set((state) => state)
}));
