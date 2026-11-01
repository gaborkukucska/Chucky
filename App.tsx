import React, { Component, useEffect, useState, ReactNode } from 'react';
import { Game3D } from './components/Game3D';
import { Controls } from './components/Controls';
import type { MagicType } from './types';
import { MAGIC_INFO } from './store';
import { useGameStore, isNightTime, BERRIES_FOR_ZOOMIES, getComboDeadline, getComboWindow, COMBO_LOGS_PER_LEVEL, COMBO_MAX_MULTIPLIER } from './store';
import { audioService } from './services/audio';
import { persistence, SaveSlotInfo, LeaderboardEntry, SAVE_SLOTS } from './services/persistence';
import type { AudioChannel } from './services/audio';
import type { GraphicsQuality } from './types';
import { multiplayer, TEAMS, TEAM_INFO, Team } from './services/multiplayer';
import { facts } from './services/facts';

// =====================================================================
// Error boundary
// =====================================================================
interface ErrorBoundaryProps {
  children?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null
  };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Game crashed:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full w-full flex items-center justify-center bg-red-900 text-white p-4 absolute top-0 left-0 z-50">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-2">Oof! The dam broke.</h1>
            <p className="mb-4">Something went wrong loading the 3D world.</p>
            <pre className="bg-black/50 p-2 rounded text-left text-xs overflow-auto max-w-sm mx-auto">
              {this.state.error?.message}
            </pre>
            <button
              className="mt-4 bg-white text-red-900 px-4 py-2 rounded font-bold"
              onClick={() => window.location.reload()}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// =====================================================================
// Small shared bits
// =====================================================================
const formatDate = (ms: number) => {
    const d = new Date(ms);
    return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
};

const Bar = ({ value, color, className = '' }: { value: number; color: string; className?: string }) => (
    <div className={`flex-1 h-1.5 bg-black/50 rounded-full overflow-hidden border border-white/10 ${className}`}>
        <div className={`h-full ${color} transition-all duration-150`} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
);

const MenuButton = ({ children, onClick, variant = 'default', disabled = false }: {
    children: ReactNode; onClick: () => void; variant?: 'default' | 'primary' | 'danger'; disabled?: boolean
}) => {
    const styles = {
        default: 'bg-white/10 hover:bg-white/20 border-white/15 text-white',
        primary: 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 border-amber-300/30 text-white',
        danger: 'bg-red-700/80 hover:bg-red-600 border-red-300/30 text-white',
    }[variant];
    return (
        <button
            disabled={disabled}
            onClick={onClick}
            className={`w-full py-2.5 px-4 rounded-xl border font-bold text-sm transition-all active:scale-95 disabled:opacity-40 disabled:active:scale-100 ${styles}`}
        >
            {children}
        </button>
    );
};

// =====================================================================
// HUD (compact, top-left)
// =====================================================================
const ComboUI = () => {
    const combo = useGameStore(state => state.combo);
    const isPaused = useGameStore(state => state.isPaused);
    const [, setTick] = useState(0);

    // Display only - the store (checkCombo) decides when the combo ends
    useEffect(() => {
        if (!combo.active || isPaused) return;
        const interval = setInterval(() => setTick(t => t + 1), 100);
        return () => clearInterval(interval);
    }, [combo.active, isPaused]);

    if (!combo.active) return null;

    const windowMs = getComboWindow(combo.multiplier);
    const reference = isPaused ? useGameStore.getState().lastPauseStartTime : Date.now();
    const timeLeft = Math.max(0, getComboDeadline(combo) - reference);
    const progress = (timeLeft / windowMs) * 100;
    const atMax = combo.multiplier >= COMBO_MAX_MULTIPLIER;

    return (
        <div className="bg-black/50 backdrop-blur-sm px-2 py-1.5 rounded-lg border border-white/10 w-full">
            <div className="flex justify-between items-center text-white text-[9px] font-bold uppercase tracking-wider">
                <span>Combo {combo.multiplier > 1 && <span className="text-amber-400 text-xs italic">{combo.multiplier}x</span>}</span>
                <span className="font-mono text-amber-400">{(timeLeft / 1000).toFixed(1)}s</span>
            </div>
            <div className="w-full h-1 bg-black/50 rounded-full overflow-hidden my-0.5">
                <div
                    className={`h-full transition-all duration-100 ${timeLeft < 3000 ? 'bg-red-500' : 'bg-amber-400'}`}
                    style={{ width: `${progress}%` }}
                />
            </div>
            <div className="text-white/60 text-[8px]">
                {atMax ? 'MAX! Keep grabbing logs' : `${combo.logsSinceLastLevel}/${COMBO_LOGS_PER_LEVEL} logs to ${combo.multiplier + 1}x`}
            </div>
        </div>
    );
};

const Hud = () => {
    const health = useGameStore(state => state.health);
    const maxHealth = useGameStore(state => state.maxHealth);
    const woodCount = useGameStore(state => state.woodCount);
    const score = useGameStore(state => state.score) || 0;
    const day = useGameStore(state => state.day);
    const leaderboardRank = useGameStore(state => state.leaderboardRank);
    const isNight = useGameStore(state => isNightTime(state.timeOfDay));
    const berriesEaten = useGameStore(state => state.berriesEaten);
    const breath = useGameStore(state => state.breath);
    const mpCode = useGameStore(state => (state.mp.status === 'playing' ? state.mp.code : ''));
    const mpCount = useGameStore(state => Object.keys(state.mp.players).length + 1);
    const activeTree = useGameStore(state =>
        state.activeTreeId ? (state.trees.find(t => t.id === state.activeTreeId) ?? null) : null
    );

    const overheal = health > maxHealth;

    return (
        <div className="absolute top-2 left-2 z-30 pointer-events-none flex flex-col gap-1 w-40">
            <div className="bg-black/50 backdrop-blur-sm px-2 py-1.5 rounded-lg border border-white/10 shadow-lg space-y-1 text-white">
                {/* Health */}
                <div className="flex items-center gap-1.5">
                    <span className="text-[11px] leading-none">❤️</span>
                    <Bar value={Math.min(health, maxHealth) / maxHealth} color={overheal ? 'bg-gradient-to-r from-amber-400 to-yellow-300' : 'bg-gradient-to-r from-red-500 to-red-400'} />
                    <span className={`text-[9px] font-mono font-bold w-6 text-right ${overheal ? 'text-yellow-300' : ''}`}>{Math.ceil(health)}</span>
                </div>
                {/* Wood + score */}
                <div className="flex items-center justify-between text-[11px] font-bold leading-none">
                    <span>🪵 {woodCount}</span>
                    <span className="text-amber-300">⭐ {score.toLocaleString()}{leaderboardRank && <span className="text-[9px] text-white/70 ml-1">#{leaderboardRank}</span>}</span>
                </div>
                {/* Day + berries */}
                <div className="flex items-center justify-between text-[9px] text-white/70 font-bold leading-none">
                    <span>{isNight ? '🌙' : '☀️'} Day {day}</span>
                    <span title="Berries towards Zoomies">🫐 {berriesEaten}/{BERRIES_FOR_ZOOMIES}</span>
                </div>
                {/* Joint game: room code + players */}
                {mpCode && (
                    <div className="flex items-center justify-between text-[9px] text-sky-200 font-bold leading-none">
                        <span>👥 {mpCode}</span>
                        <span>{mpCount} {mpCount === 1 ? 'player' : 'players'}</span>
                    </div>
                )}
                {/* Tree being chomped */}
                {activeTree && (
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] leading-none">🌲</span>
                        <Bar value={activeTree.health / activeTree.maxHealth} color="bg-gradient-to-r from-green-600 to-green-400" />
                        <span className="text-[9px] font-mono w-6 text-right">{Math.ceil((activeTree.health / activeTree.maxHealth) * 100)}%</span>
                    </div>
                )}
                {/* Breath (only when not full) */}
                {breath < 0.999 && (
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] leading-none">🫧</span>
                        <Bar value={breath} color={breath < 0.25 ? 'bg-red-500 animate-pulse' : 'bg-cyan-400'} />
                        <span className="text-[9px] font-mono w-6 text-right">{Math.round(breath * 100)}%</span>
                    </div>
                )}
            </div>
            <ComboUI />
        </div>
    );
};

// Powerup pills: right side, under the buttons
const PowerupPills = () => {
    const isTreePowerupActive = useGameStore(state => state.isTreePowerupActive);
    const isLogPowerupActive = useGameStore(state => state.isLogPowerupActive);
    const isSpeedPowerupActive = useGameStore(state => state.isSpeedPowerupActive);
    const treePowerupEndTime = useGameStore(state => state.treePowerupEndTime);
    const logPowerupEndTime = useGameStore(state => state.logPowerupEndTime);
    const speedPowerupEndTime = useGameStore(state => state.speedPowerupEndTime);
    const isPaused = useGameStore(state => state.isPaused);
    const magic = useGameStore(state => state.magic);
    const activeMagic = (Object.keys(MAGIC_INFO) as MagicType[]).filter(t => magic[t] > Date.now());

    const anyActive = isTreePowerupActive || isLogPowerupActive || isSpeedPowerupActive || activeMagic.length > 0;
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!anyActive || isPaused) return;
        const interval = setInterval(() => setTick(t => t + 1), 250);
        return () => clearInterval(interval);
    }, [anyActive, isPaused]);

    if (!anyActive) return null;
    const secs = (end: number) => Math.max(0, Math.ceil((end - Date.now()) / 1000));

    const pill = (icon: string, label: string, end: number, border: string) => (
        <div className={`bg-black/55 backdrop-blur-sm text-white pl-1.5 pr-2 py-0.5 rounded-full border ${border} shadow flex items-center gap-1 text-[10px] font-bold`}>
            <span className="text-xs">{icon}</span>
            <span className="uppercase tracking-wide">{label}</span>
            <span className="font-mono">{secs(end)}s</span>
        </div>
    );

    return (
        <div className="absolute top-[52px] right-2 z-30 flex flex-col gap-1 items-end pointer-events-none">
            {isTreePowerupActive && pill('🪓', 'Mega Chomp', treePowerupEndTime, 'border-orange-500')}
            {isLogPowerupActive && pill('🧲', 'Magnet', logPowerupEndTime, 'border-blue-500')}
            {isSpeedPowerupActive && pill('⚡', 'Zoomies', speedPowerupEndTime, 'border-emerald-400')}
            {activeMagic.map(t => (
                <React.Fragment key={t}>{pill(MAGIC_INFO[t].icon, MAGIC_INFO[t].label, magic[t], 'border-fuchsia-400')}</React.Fragment>
            ))}
        </div>
    );
};

// Toast above the joystick (keeps the top of the screen clear)
const NotificationUI = () => {
    const notification = useGameStore(state => state.notification);
    const dismissNotification = useGameStore(state => state.dismissNotification);
    const openBuildMenu = useGameStore(state => state.openBuildMenu);

    useEffect(() => {
        if (notification) {
            const timer = setTimeout(() => {
                dismissNotification();
            }, 4000);
            return () => clearTimeout(timer);
        }
    }, [notification, dismissNotification]);

    if (!notification) return null;

    const handleClick = () => {
        dismissNotification();
        if (notification.type === 'unlock') {
            openBuildMenu();
        }
    };

    return (
        <div className="fixed bottom-52 inset-x-0 z-50 flex justify-center pointer-events-none px-4">
            <div
                className="animate-in slide-in-from-bottom-4 duration-300 cursor-pointer pointer-events-auto w-full max-w-xs"
                onClick={handleClick}
            >
                <div className="bg-black/80 backdrop-blur-xl px-3 py-2 rounded-xl border border-amber-500/50 shadow-2xl flex items-center gap-2.5">
                    <div className="text-xl">
                        {notification.type === 'unlock' ? '🔓' : notification.type === 'info' ? '⚡' : '🏆'}
                    </div>
                    <div className="flex-1 text-left">
                        <div className="text-amber-400 font-black text-[10px] uppercase tracking-widest">
                            {notification.title}
                        </div>
                        <div className="text-white font-semibold text-xs leading-snug">
                            {notification.message}
                        </div>
                        {notification.type === 'unlock' && (
                            <div className="text-[8px] text-white/50 mt-0.5 uppercase tracking-wider font-bold">
                                Tap to open blueprints →
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// =====================================================================
// Placement panel - thumb-friendly controls while placing a structure
// =====================================================================
const PlacementPanel = () => {
    const isPlacementMode = useGameStore(state => state.isPlacementMode);
    const blueprint = useGameStore(state => state.blueprints.find(b => b.id === state.selectedBlueprintId));
    const woodCount = useGameStore(state => state.woodCount);
    const valid = useGameStore(state => state.placementValid);
    const inRiver = useGameStore(state => state.placementInRiver);
    const reason = useGameStore(state => state.placementReason);
    const rotatePlacement = useGameStore(state => state.rotatePlacement);
    const cancelPlacement = useGameStore(state => state.cancelPlacement);

    if (!isPlacementMode || !blueprint) return null;

    const place = () => {
        // @ts-ignore - consumed by the Woodchuck frame loop
        window.woodchuckInput.isBuilding = true;
    };

    const sideButton = 'w-10 h-10 rounded-xl bg-black/60 backdrop-blur-md border border-white/20 text-white text-lg font-bold flex items-center justify-center shadow-lg pointer-events-auto active:scale-90 transition-transform';

    // Left edge, vertically centred: reachable with the left thumb (the right thumb is on the
    // joystick) and clear of Chucky in the middle of the screen
    return (
        <div className="fixed left-1.5 top-1/2 -translate-y-1/2 z-40 flex flex-col items-start gap-2 pointer-events-none">
            <div className="max-w-[11rem] bg-black/65 backdrop-blur-md border border-white/15 rounded-xl px-2 py-1 text-[10px] font-bold text-white shadow-lg leading-tight">
                <div className="truncate">🏗️ {blueprint.name}</div>
                <div className="truncate">
                    🪵 {blueprint.cost}<span className="text-white/50"> / {woodCount}</span>{' · '}
                    {valid
                        ? <span className={inRiver ? 'text-cyan-300' : 'text-green-300'}>{inRiver ? '🌊 Dam! ×2.5 pts' : '✓ Ready'}</span>
                        : <span className="text-red-300">{reason}</span>}
                </div>
            </div>
            <div className="w-14 flex flex-col items-center gap-2">
                <button className={sideButton} onClick={() => rotatePlacement(Math.PI / 4)} aria-label="Rotate right">↻</button>
                <button
                    className={`w-14 h-14 rounded-2xl border-2 text-white text-[9px] font-black flex flex-col items-center justify-center gap-0.5 shadow-xl pointer-events-auto transition-transform active:scale-90 ${valid
                        ? 'bg-gradient-to-br from-green-500 to-green-700 border-green-200/70'
                        : 'bg-gray-600/70 border-white/20 opacity-60'}`}
                    disabled={!valid}
                    onClick={place}
                    aria-label="Place structure"
                >
                    <span className="text-xl leading-none">✅</span>
                    PLACE
                </button>
                <button className={sideButton} onClick={() => rotatePlacement(-Math.PI / 4)} aria-label="Rotate left">↺</button>
                <button className={`${sideButton} text-sm`} onClick={cancelPlacement} aria-label="Stop building">✖</button>
            </div>
        </div>
    );
};

// =====================================================================
// Build menu
// =====================================================================
const BuildMenu = () => {
    const blueprints = useGameStore(state => state.blueprints);
    const woodCount = useGameStore(state => state.woodCount);
    const selectBlueprint = useGameStore(state => state.selectBlueprint);
    const closeBuildMenu = useGameStore(state => state.closeBuildMenu);

    return (
        <div className="absolute inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4 animate-in fade-in duration-200">
            <h2 className="text-2xl font-black text-white mb-1 tracking-tight drop-shadow-lg">BLUEPRINTS</h2>
            <div className="text-xs text-amber-300 font-bold mb-3">🪵 {woodCount} wood available</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 w-full max-w-3xl overflow-y-auto max-h-[65vh] p-1">
                {blueprints.map(bp => (
                    <button
                        key={bp.id}
                        disabled={!bp.unlocked || woodCount < bp.cost}
                        onClick={(e) => {
                            e.stopPropagation();
                            selectBlueprint(bp.id);
                        }}
                        className={`
                            relative p-2.5 rounded-xl border-2 flex flex-col items-center gap-1 transition-all
                            ${!bp.unlocked
                                ? 'bg-gray-900/80 border-gray-700 opacity-60 cursor-not-allowed'
                                : woodCount < bp.cost
                                    ? 'bg-red-900/50 border-red-800 cursor-not-allowed'
                                    : 'bg-black/60 border-amber-500 hover:bg-amber-900/40 hover:scale-105 active:scale-95 shadow-xl'}
                        `}
                    >
                        {!bp.unlocked && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-xl z-10">
                                <span className="text-2xl">🔒</span>
                            </div>
                        )}
                        <span className="text-xl">🏗️</span>
                        <h3 className="text-white font-bold text-xs leading-tight text-center">{bp.name}</h3>
                        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${woodCount < bp.cost ? 'bg-red-900/50 text-red-200' : 'bg-amber-900/50 text-amber-200'}`}>
                            <span>🪵</span>
                            <span className="font-mono">{bp.cost}</span>
                        </div>
                        {!bp.unlocked && bp.unlockScore !== undefined && bp.unlockScore > 0 && (
                            <div className="text-[9px] text-amber-400 font-bold uppercase tracking-wider relative z-20">
                                Need {bp.unlockScore} Pts
                            </div>
                        )}
                    </button>
                ))}
            </div>
            <button
                onClick={closeBuildMenu}
                className="mt-4 bg-white text-black font-black py-2 px-8 rounded-full hover:bg-gray-200 shadow-xl transition-transform active:scale-95 text-sm"
            >
                CLOSE
            </button>
        </div>
    );
};

// =====================================================================
// Save slots / leaderboard
// =====================================================================
const SlotList = ({ mode, onDone }: { mode: 'save' | 'load'; onDone?: () => void }) => {
    const saveGame = useGameStore(state => state.saveGame);
    const loadGame = useGameStore(state => state.loadGame);
    const [slots, setSlots] = useState<(SaveSlotInfo | null)[]>(() => persistence.listSlots());
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
    const [confirmSlot, setConfirmSlot] = useState<number | null>(null);

    if (!persistence.isAvailable()) {
        return <div className="text-sm text-red-300 text-center py-4">Saving isn't available in this browser (private mode or storage blocked).</div>;
    }

    const doSave = (slot: number) => {
        const result = saveGame(slot);
        setMessage({ ok: result.ok, text: result.message });
        setSlots(persistence.listSlots());
        setConfirmSlot(null);
    };

    const handleClick = (slot: number, info: SaveSlotInfo | null) => {
        if (mode === 'save') {
            if (info && confirmSlot !== slot) { setConfirmSlot(slot); return; } // Overwrite needs a second tap
            doSave(slot);
        } else if (info) {
            const result = loadGame(slot);
            setMessage({ ok: result.ok, text: result.message });
            if (result.ok) onDone?.();
        }
    };

    return (
        <div className="space-y-2">
            {Array.from({ length: SAVE_SLOTS }, (_, i) => i + 1).map(slot => {
                const info = slots[slot - 1];
                const disabled = mode === 'load' && !info;
                const confirming = confirmSlot === slot;
                return (
                    <button
                        key={slot}
                        disabled={disabled}
                        onClick={() => handleClick(slot, info)}
                        className={`w-full text-left px-3 py-2 rounded-xl border transition-all active:scale-[0.98] disabled:opacity-40
                            ${confirming ? 'bg-red-900/60 border-red-400' : 'bg-white/5 hover:bg-white/10 border-white/15'}`}
                    >
                        <div className="flex justify-between items-center">
                            <span className="font-black text-sm text-white">Slot {slot}</span>
                            <span className="text-[10px] text-white/50">{info ? formatDate(info.savedAt) : 'Empty'}</span>
                        </div>
                        {info && (
                            <div className="text-[11px] text-white/70 mt-0.5">
                                ⭐ {info.score.toLocaleString()} · 🪵 {info.woodCount} · Day {info.day}
                            </div>
                        )}
                        {confirming && <div className="text-[11px] text-red-200 font-bold mt-0.5">Tap again to overwrite</div>}
                    </button>
                );
            })}
            {message && (
                <div className={`text-xs text-center font-bold ${message.ok ? 'text-green-300' : 'text-red-300'}`}>{message.text}</div>
            )}
        </div>
    );
};

const LeaderboardTable = ({ highlightId }: { highlightId?: string }) => {
    const [entries, setEntries] = useState<LeaderboardEntry[]>(() => persistence.getLeaderboard());
    const [shared, setShared] = useState<boolean | null>(null);

    // Shared board from the server (all devices), refreshed while open; per-device fallback
    useEffect(() => {
        let alive = true;
        const refresh = () => persistence.fetchSharedLeaderboard().then((result) => {
            if (!alive) return;
            setEntries(result.entries.slice(0, 10));
            setShared(result.shared);
        });
        refresh();
        const interval = setInterval(refresh, 3000);
        return () => { alive = false; clearInterval(interval); };
    }, []);

    const footer = shared === null ? null : (
        <div className={`text-[10px] mt-1.5 ${shared ? 'text-emerald-300/80' : 'text-amber-300/80'}`}>
            {shared ? '🌐 Shared by every device playing on this server' : '📱 This device only - score server not reachable'}
        </div>
    );

    if (entries.length === 0) {
        return (
            <div>
                <div className="text-sm text-white/60 text-center py-6">No scores yet - be the first chomper on the board!</div>
                {footer}
            </div>
        );
    }

    return (
        <div>
            <div className="max-h-[45vh] overflow-y-auto rounded-xl border border-white/10">
                <table className="w-full text-xs text-white">
                    <thead className="bg-white/10 text-[10px] uppercase tracking-wider text-white/60 sticky top-0">
                        <tr>
                            <th className="py-1.5 px-2 text-left">#</th>
                            <th className="py-1.5 px-2 text-left">Name</th>
                            <th className="py-1.5 px-2 text-right">Score</th>
                            <th className="py-1.5 px-2 text-right">Day</th>
                            <th className="py-1.5 px-2 text-right">Logs</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map((e, i) => {
                            const isCurrent = !!highlightId && e.id === highlightId;
                            return (
                                <tr key={e.id || `${e.date}-${i}`} className={`border-t border-white/5 ${isCurrent ? 'bg-amber-500/30 font-bold' : ''}`}>
                                    <td className="py-1.5 px-2">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                                    <td className="py-1.5 px-2 truncate max-w-[110px]">{e.name}{isCurrent && <span className="text-amber-300 text-[9px] ml-1">(this run)</span>}</td>
                                    <td className="py-1.5 px-2 text-right font-mono">{e.score.toLocaleString()}</td>
                                    <td className="py-1.5 px-2 text-right">{e.day}</td>
                                    <td className="py-1.5 px-2 text-right">{e.logs}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {footer}
        </div>
    );
};

// Player name (stored on this device, used for the live leaderboard entry)
const NameEditor = ({ compact = false }: { compact?: boolean }) => {
    const playerName = useGameStore(state => state.playerName);
    const setPlayerName = useGameStore(state => state.setPlayerName);
    const [value, setValue] = useState(playerName);
    const [saved, setSaved] = useState(false);

    const submit = (e?: React.FormEvent) => {
        e?.preventDefault();
        setPlayerName(value);
        setValue(useGameStore.getState().playerName);
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
    };

    return (
        <form onSubmit={submit} className={`flex gap-2 ${compact ? '' : 'mb-2'}`}>
            <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => { if (value !== playerName) submit(); }}
                maxLength={16}
                placeholder="Your name"
                aria-label="Your name"
                className="flex-1 min-w-0 select-text bg-black/40 border border-white/20 rounded-xl px-3 py-2 text-sm text-white placeholder-white/40 outline-none focus:border-amber-400"
            />
            <button type="submit" className="bg-amber-500 hover:bg-amber-400 text-black font-black px-3 rounded-xl text-xs active:scale-95">
                {saved ? '✓' : 'Save'}
            </button>
        </form>
    );
};

// =====================================================================
// Joint games (multiplayer): lobby, players, feed, knock-out, lost connection
// =====================================================================
const TEAM_KEY = 'chucky.team';
const LAST_CODE_KEY = 'chucky.lastCode';
const readSetting = (key: string) => { try { return window.localStorage.getItem(key) || ''; } catch { return ''; } };
const writeSetting = (key: string, value: string) => { try { window.localStorage.setItem(key, value); } catch { /* ignore */ } };

const TeamPicker = ({ team, onChange }: { team: Team; onChange: (team: Team) => void }) => (
    <div className="grid grid-cols-5 gap-1.5">
        {TEAMS.map(t => (
            <button
                key={t}
                aria-pressed={team === t}
                onClick={() => onChange(t)}
                className={`py-2 rounded-xl border text-[10px] font-bold flex flex-col items-center gap-1 transition-all active:scale-95 ${team === t ? 'bg-white/20 border-white/70 text-white' : 'bg-white/5 border-white/15 text-white/70'}`}
            >
                <span className="w-4 h-4 rounded-full border border-white/40" style={{ background: TEAM_INFO[t].color }} />
                {TEAM_INFO[t].label}
            </button>
        ))}
    </div>
);

const TogetherPanel = ({ onBack }: { onBack: () => void }) => {
    const mp = useGameStore(state => state.mp);
    const playerName = useGameStore(state => state.playerName);
    const [team, setTeam] = useState<Team>(() => {
        const saved = readSetting(TEAM_KEY) as Team;
        return TEAMS.includes(saved) ? saved : 'solo';
    });
    const [code, setCode] = useState(() => readSetting(LAST_CODE_KEY));
    const connecting = mp.status === 'connecting';
    const name = playerName || 'Chucky';

    const chooseTeam = (t: Team) => {
        setTeam(t);
        writeSetting(TEAM_KEY, t);
    };
    const join = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!code.trim() || connecting) return;
        writeSetting(LAST_CODE_KEY, code.trim());
        multiplayer.join(code.trim(), name, team);
    };

    return (
        <Panel title="👥 Play together" onBack={() => { multiplayer.clearError(); onBack(); }}>
            <p className="text-[11px] text-white/60 mb-3">Everyone on the same Wi-Fi opens this game from the same computer. One player creates a game and shares the code.</p>
            <div className="text-[10px] uppercase tracking-wider text-white/50 font-bold mb-1.5">Your name</div>
            <NameEditor compact />
            <div className="text-[10px] uppercase tracking-wider text-white/50 font-bold mt-3 mb-1.5">Team</div>
            <TeamPicker team={team} onChange={chooseTeam} />
            <p className="text-[10px] text-white/50 mt-1.5">
                {team === 'solo' ? 'Solo: everyone is your rival.' : 'Same colour = team mates: your logs don\'t hurt them - they catch them.'}
            </p>
            <div className="mt-4 space-y-2">
                <MenuButton variant="primary" disabled={connecting} onClick={() => multiplayer.create(name, team)}>
                    {connecting ? 'Connecting…' : '🌲 Create a game'}
                </MenuButton>
                <form onSubmit={join} className="flex gap-2">
                    <input
                        value={code}
                        onChange={(e) => setCode(e.target.value.toUpperCase())}
                        maxLength={12}
                        placeholder="Code, e.g. BARK-27"
                        aria-label="Game code"
                        className="flex-1 min-w-0 select-text bg-black/40 border border-white/20 rounded-xl px-3 py-2 text-sm text-white placeholder-white/40 outline-none focus:border-amber-400 uppercase tracking-wider"
                    />
                    <button type="submit" disabled={connecting || !code.trim()} className="bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-black font-black px-4 rounded-xl text-sm active:scale-95">
                        Join
                    </button>
                </form>
            </div>
            {mp.error && <p className="mt-3 text-xs text-red-200 bg-red-900/40 border border-red-400/30 rounded-xl px-3 py-2">{mp.error}</p>}
        </Panel>
    );
};

const PlayersList = () => {
    const mp = useGameStore(state => state.mp);
    const myName = useGameStore(state => state.playerName) || 'Chucky';
    const myScore = useGameStore(state => Math.floor(state.score));
    const rows = [
        { id: mp.myId, name: `${myName} (you)`, team: mp.team, score: myScore, ko: false },
        ...Object.values(mp.players),
    ].sort((a, b) => b.score - a.score);
    return (
        <div className="space-y-1.5">
            {rows.map(r => (
                <div key={r.id} className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: TEAM_INFO[r.team]?.color }} />
                    <span className="flex-1 truncate font-bold">{r.name}{r.ko ? ' 😵' : ''}</span>
                    <span className="text-[10px] text-white/50">{TEAM_INFO[r.team]?.label}</span>
                    <span className="font-mono text-amber-300 text-xs">⭐ {r.score.toLocaleString()}</span>
                </div>
            ))}
        </div>
    );
};

// Joins, leaves, bonks, knock-outs - a few lines above the throw button
const MpFeed = () => {
    const feed = useGameStore(state => state.mp.feed);
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!feed.length) return;
        const timer = setInterval(() => setTick(n => n + 1), 1000);
        return () => clearInterval(timer);
    }, [feed.length]);
    const now = Date.now();
    const visible = feed.filter(f => now - f.at < 6000);
    if (!visible.length) return null;
    return (
        <div className="absolute left-2 bottom-[132px] z-30 flex flex-col items-start gap-1 pointer-events-none max-w-[60%]">
            {visible.map(f => (
                <div key={f.id} className="bg-black/55 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-1 rounded-lg border border-white/10 shadow">{f.text}</div>
            ))}
        </div>
    );
};

const KnockoutOverlay = () => {
    const koUntil = useGameStore(state => state.koUntil);
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!koUntil) return;
        const timer = setInterval(() => setTick(n => n + 1), 250);
        return () => clearInterval(timer);
    }, [koUntil]);
    if (!koUntil) return null;
    const left = Math.max(0, Math.ceil((koUntil - Date.now()) / 1000));
    return (
        <div className="absolute inset-x-0 top-1/3 z-40 flex justify-center pointer-events-none">
            <div className="bg-black/70 backdrop-blur-md text-white rounded-2xl px-5 py-3 text-center border border-white/15 shadow-2xl">
                <div className="text-2xl">😵</div>
                <div className="font-black">Knocked out!</div>
                <div className="text-xs text-white/70">You dropped half your logs · back in {left}s</div>
            </div>
        </div>
    );
};

const ConnectionLostOverlay = () => {
    const status = useGameStore(state => state.mp.status);
    const code = useGameStore(state => state.mp.code);
    if (status !== 'lost') return null;
    return (
        <div className="absolute inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
            <Panel title="Connection lost">
                <p className="text-sm text-white/70 mb-4">The connection to the game server dropped. Check the Wi-Fi and that the computer running the game is still on, then join {code} again.</p>
                <MenuButton variant="primary" onClick={() => multiplayer.leave()}>Back to the start screen</MenuButton>
            </Panel>
        </div>
    );
};

// =====================================================================
// Chucky's speech bubble: tips and fact nuggets (services/facts.ts, public/chucky-facts.json)
// =====================================================================
const ChuckyBubble = () => {
    const chucky = useGameStore(state => state.chucky);
    const nextChucky = useGameStore(state => state.nextChucky);
    const closeChucky = useGameStore(state => state.closeChucky);
    const item = chucky ? chucky.items[chucky.index] : null;

    useEffect(() => {
        if (item) facts.markSeen(item.id);
    }, [item]);

    if (!chucky || !item) return null;
    const intro = chucky.kind === 'intro';
    const last = chucky.index === chucky.items.length - 1;
    const next = () => {
        if (intro && last) facts.finishIntro();
        nextChucky();
    };
    const skip = () => {
        facts.finishIntro();
        closeChucky();
    };

    return (
        <div className="absolute inset-x-0 bottom-40 z-[55] flex justify-center px-3 pointer-events-none">
            <div className="pointer-events-auto w-full max-w-sm flex items-end gap-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="text-5xl leading-none drop-shadow-lg select-none" aria-hidden="true">🦫</div>
                <div className="flex-1 bg-white text-stone-800 rounded-2xl rounded-bl-sm p-3 shadow-2xl border-2 border-amber-300">
                    <div className="text-[10px] font-black uppercase tracking-wider text-amber-600 mb-0.5">
                        {intro ? `Chucky's tips · ${chucky.index + 1}/${chucky.items.length}` : 'Chucky says…'}
                    </div>
                    <p className="text-sm leading-snug font-medium">{item.text}</p>
                    <div className="flex justify-end items-center gap-2 mt-2">
                        {intro && !last && (
                            <button onClick={skip} className="text-xs font-bold text-stone-500 hover:text-stone-700 px-2 py-1">Skip</button>
                        )}
                        <button onClick={next} className="bg-amber-500 hover:bg-amber-400 text-white text-xs font-black px-3 py-1.5 rounded-lg active:scale-95">
                            {last ? 'Got it!' : 'Next ▶'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Panel wrapper used by the menus
const Panel = ({ title, children, onBack }: { title: string; children: ReactNode; onBack?: () => void }) => (
    <div className="w-full max-w-sm bg-black/70 backdrop-blur-xl border border-white/15 rounded-2xl p-4 shadow-2xl text-white">
        <div className="flex items-center mb-3">
            {onBack && (
                <button onClick={onBack} className="mr-2 w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-sm" aria-label="Back">←</button>
            )}
            <h2 className="text-lg font-black tracking-tight flex-1">{title}</h2>
        </div>
        {children}
    </div>
);

// =====================================================================
// Settings: graphics quality + sound channels (saved on this device)
// =====================================================================
const QUALITY_OPTIONS: { id: GraphicsQuality; label: string; hint: string }[] = [
    { id: 'LOW', label: 'Low', hint: 'Smoothest on older phones: grass close by only, simple shadows, no clouds.' },
    { id: 'MEDIUM', label: 'Medium', hint: 'Balanced: grass around Chucky, medium shadows, slightly sharper picture.' },
    { id: 'HIGH', label: 'High', hint: 'Best looking: most grass, sharpest shadows and picture. Needs a fast device.' },
];

const SOUND_OPTIONS: { id: AudioChannel; label: string; hint: string }[] = [
    { id: 'music', label: '🎵 Music', hint: 'The jazzy background tune' },
    { id: 'environment', label: '🌲 Environment', hint: 'River, wind, birds by day, crickets at night' },
    { id: 'sfx', label: '🔊 Sound effects', hint: 'Chomps, pickups, level-ups, building' },
];

const Toggle = ({ on, label, hint, onChange }: { on: boolean; label: string; hint: string; onChange: (on: boolean) => void }) => (
    <button
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className="w-full flex items-center justify-between gap-3 py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-colors"
    >
        <span className="min-w-0">
            <span className="block text-sm font-bold">{label}</span>
            <span className="block text-[10px] text-white/50">{hint}</span>
        </span>
        <span className={`relative shrink-0 w-10 h-6 rounded-full transition-colors ${on ? 'bg-amber-500' : 'bg-white/20'}`}>
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
        </span>
    </button>
);

const ChuckySettings = () => {
    const [on, setOn] = useState(() => facts.enabled);
    const [reset, setReset] = useState(false);
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wider text-white/50 font-bold mb-1.5">Chucky</div>
            <Toggle
                on={on}
                label="🦫 Fact nuggets"
                hint="Tips and beaver facts from Chucky as you play"
                onChange={(value) => { facts.setEnabled(value); setOn(value); }}
            />
            <button
                onClick={() => { facts.resetSeen(); setReset(true); }}
                className="mt-1.5 w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-white/80"
            >
                {reset ? '✓ Chucky will tell you everything again' : '🔁 Hear all the facts again'}
            </button>
        </div>
    );
};

const SettingsPanel = () => {
    const quality = useGameStore(state => state.quality);
    const setQuality = useGameStore(state => state.setQuality);
    const audioSettings = useGameStore(state => state.audioSettings);
    const setAudioChannel = useGameStore(state => state.setAudioChannel);
    const selected = QUALITY_OPTIONS.find(o => o.id === quality) || QUALITY_OPTIONS[1];

    return (
        <div className="space-y-4">
            <div>
                <div className="text-[10px] uppercase tracking-wider text-white/50 font-bold mb-1.5">Graphics</div>
                <div className="grid grid-cols-3 gap-1.5">
                    {QUALITY_OPTIONS.map(o => (
                        <button
                            key={o.id}
                            aria-pressed={quality === o.id}
                            onClick={() => setQuality(o.id)}
                            className={`py-2 rounded-xl border text-sm font-bold transition-all active:scale-95 ${quality === o.id
                                ? 'bg-gradient-to-r from-amber-500 to-orange-600 border-amber-300/40 text-white'
                                : 'bg-white/10 hover:bg-white/20 border-white/15 text-white/80'}`}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>
                <p className="text-[10px] text-white/50 mt-1.5">{selected.hint}</p>
            </div>
            <div>
                <div className="text-[10px] uppercase tracking-wider text-white/50 font-bold mb-1.5">Sound</div>
                <div className="space-y-1.5">
                    {SOUND_OPTIONS.map(o => (
                        <Toggle key={o.id} on={audioSettings[o.id]} label={o.label} hint={o.hint} onChange={(on) => setAudioChannel(o.id, on)} />
                    ))}
                </div>
            </div>
            <ChuckySettings />
            <p className="text-[10px] text-white/40">Settings are saved on this device.</p>
        </div>
    );
};

// =====================================================================
// In-game menu (pauses the game)
// =====================================================================
type MenuView = 'main' | 'save' | 'load' | 'leaderboard' | 'settings' | 'confirmNew' | 'players' | 'confirmLeave';

const GameMenu = () => {
    const closeGameMenu = useGameStore(state => state.closeGameMenu);
    const startGame = useGameStore(state => state.startGame);
    const score = useGameStore(state => state.score);
    const day = useGameStore(state => state.day);
    const runKey = useGameStore(state => state.runKey);
    const leaderboardRank = useGameStore(state => state.leaderboardRank);
    const mpCode = useGameStore(state => (state.mp.status === 'playing' ? state.mp.code : ''));
    const inJointGame = !!mpCode;
    const [view, setView] = useState<MenuView>('main');

    return (
        <div className="absolute inset-0 z-[60] bg-black/60 flex items-center justify-center p-4 animate-in fade-in duration-150">
            {view === 'main' && (
                <Panel title={inJointGame ? `👥 Joint game ${mpCode}` : 'Paused'}>
                    <div className="text-xs text-white/60 mb-3">
                        ⭐ {score.toLocaleString()} · Day {day}{leaderboardRank ? ` · 🏆 #${leaderboardRank}` : ''}
                        {inJointGame && <span className="block text-[10px] text-sky-200 mt-0.5">The game keeps going while this menu is open.</span>}
                    </div>
                    <div className="space-y-2">
                        <MenuButton variant="primary" onClick={closeGameMenu}>▶ Resume</MenuButton>
                        {inJointGame ? (
                            <MenuButton onClick={() => setView('players')}>👥 Players</MenuButton>
                        ) : (
                            <>
                                <MenuButton onClick={() => setView('save')}>💾 Save Game</MenuButton>
                                <MenuButton onClick={() => setView('load')}>📂 Load Game</MenuButton>
                            </>
                        )}
                        <MenuButton onClick={() => setView('leaderboard')}>🏆 Leaderboard</MenuButton>
                        <MenuButton onClick={() => { closeGameMenu(); facts.replayIntro(); }}>🦫 Chucky's tips</MenuButton>
                        <MenuButton onClick={() => setView('settings')}>⚙️ Settings</MenuButton>
                        {inJointGame
                            ? <MenuButton variant="danger" onClick={() => setView('confirmLeave')}>🚪 Leave game</MenuButton>
                            : <MenuButton variant="danger" onClick={() => setView('confirmNew')}>🌱 New Game</MenuButton>}
                    </div>
                </Panel>
            )}
            {view === 'save' && (
                <Panel title="Save Game" onBack={() => setView('main')}>
                    <SlotList mode="save" />
                </Panel>
            )}
            {view === 'load' && (
                <Panel title="Load Game" onBack={() => setView('main')}>
                    <SlotList mode="load" />
                </Panel>
            )}
            {view === 'leaderboard' && (
                <Panel title="Leaderboard" onBack={() => setView('main')}>
                    <NameEditor />
                    <LeaderboardTable highlightId={runKey} />
                    <p className="text-[10px] text-white/50 mt-2">Your current run updates automatically.</p>
                </Panel>
            )}
            {view === 'settings' && (
                <Panel title="Settings" onBack={() => setView('main')}>
                    <SettingsPanel />
                </Panel>
            )}
            {view === 'players' && (
                <Panel title={`Players · ${mpCode}`} onBack={() => setView('main')}>
                    <PlayersList />
                    <p className="text-[10px] text-white/50 mt-2">Share the code <b className="text-white">{mpCode}</b> - others join from the start screen with 👥 Play together.</p>
                </Panel>
            )}
            {view === 'confirmLeave' && (
                <Panel title="Leave this game?" onBack={() => setView('main')}>
                    <p className="text-sm text-white/70 mb-4">Your score stays on the leaderboard. You can join again with the code {mpCode} while others are still playing.</p>
                    <div className="space-y-2">
                        <MenuButton variant="danger" onClick={() => multiplayer.leave()}>Yes, leave</MenuButton>
                        <MenuButton onClick={() => setView('main')}>Cancel</MenuButton>
                    </div>
                </Panel>
            )}
            {view === 'confirmNew' && (
                <Panel title="Start a new game?" onBack={() => setView('main')}>
                    <p className="text-sm text-white/70 mb-4">Unsaved progress in this run will be lost. A brand new forest grows for the new game.</p>
                    <div className="space-y-2">
                        <MenuButton variant="danger" onClick={() => startGame()}>Yes, new game</MenuButton>
                        <MenuButton onClick={() => setView('main')}>Cancel</MenuButton>
                    </div>
                </Panel>
            )}
        </div>
    );
};

const GameMenuOverlay = () => {
    const isGameMenuOpen = useGameStore(state => state.isGameMenuOpen);
    return isGameMenuOpen ? <GameMenu /> : null;
};

const BuildMenuOverlay = () => {
    const isBuildMenuOpen = useGameStore(state => state.isBuildMenuOpen);
    return isBuildMenuOpen ? <BuildMenu /> : null;
};

// =====================================================================
// Start screen
// =====================================================================
const StartScreen = () => {
    const startGame = useGameStore(state => state.startGame);
    const [view, setView] = useState<'main' | 'load' | 'leaderboard' | 'settings' | 'together'>('main');
    const hasSaves = persistence.listSlots().some(s => s !== null);

    if (view === 'load') {
        return (
            <div className="absolute inset-0 z-40 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
                <Panel title="Load Game" onBack={() => setView('main')}><SlotList mode="load" /></Panel>
            </div>
        );
    }
    if (view === 'leaderboard') {
        return (
            <div className="absolute inset-0 z-40 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
                <Panel title="Leaderboard" onBack={() => setView('main')}><LeaderboardTable /></Panel>
            </div>
        );
    }
    if (view === 'settings') {
        return (
            <div className="absolute inset-0 z-40 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
                <Panel title="Settings" onBack={() => setView('main')}><SettingsPanel /></Panel>
            </div>
        );
    }
    if (view === 'together') {
        return (
            <div className="absolute inset-0 z-40 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto">
                <TogetherPanel onBack={() => setView('main')} />
            </div>
        );
    }

    return (
        <div className="absolute inset-0 z-40 bg-black/80 flex flex-col items-center justify-center text-white p-4 backdrop-blur-sm overflow-y-auto">
            <h1 className="text-5xl md:text-7xl font-black mb-3 tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-amber-400 to-amber-600 drop-shadow-lg text-center leading-none">
                CHUCKY<br/>THE BEAVER
            </h1>
            <p className="italic text-sm md:text-base opacity-90 font-serif mb-4 text-gray-300 text-center">The river is flowing. The dam must be built.</p>

            <div className="flex items-center gap-3 bg-white/5 p-3 rounded-xl border border-white/10 text-xs shadow-xl max-w-sm w-full mb-5 text-gray-300">
                <span className="text-4xl leading-none" aria-hidden="true">🦫</span>
                <p>Hi, I'm Chucky! Start a game and I'll show you the ropes - and bust a few myths about beavers along the way.</p>
            </div>

            <div className="w-full max-w-xs space-y-2">
                <NameEditor compact />
                <MenuButton variant="primary" onClick={() => startGame()}>START CHOMPING</MenuButton>
                <MenuButton onClick={() => setView('together')}>👥 Play together</MenuButton>
                <div className="grid grid-cols-2 gap-2">
                    <MenuButton onClick={() => setView('load')} disabled={!hasSaves}>📂 Load</MenuButton>
                    <MenuButton onClick={() => setView('leaderboard')}>🏆 Scores</MenuButton>
                </div>
                <MenuButton onClick={() => setView('settings')}>⚙️ Settings</MenuButton>
            </div>
        </div>
    );
};

// =====================================================================
// Game over
// =====================================================================
const GameOverScreen = () => {
    const startGame = useGameStore(state => state.startGame);
    const score = useGameStore(state => state.score) || 0;
    const totalLogs = useGameStore(state => state.totalLogsCollected) || 0;
    const structures = useGameStore(state => state.placedStructures.length);
    const day = useGameStore(state => state.day);
    const runKey = useGameStore(state => state.runKey);
    const leaderboardRank = useGameStore(state => state.leaderboardRank);
    const [view, setView] = useState<'main' | 'load'>('main');

    if (view === 'load') {
        return (
            <div className="absolute inset-0 z-50 bg-red-950/90 flex items-center justify-center p-4 backdrop-blur-sm">
                <Panel title="Load Game" onBack={() => setView('main')}><SlotList mode="load" /></Panel>
            </div>
        );
    }

    return (
        <div className="absolute inset-0 z-50 bg-red-950/90 flex flex-col items-center justify-center text-white p-4 animate-in fade-in duration-500 backdrop-blur-sm overflow-y-auto">
            <h1 className="text-5xl font-black tracking-tighter text-white drop-shadow-xl">GAME OVER</h1>
            <div className="text-sm font-bold mb-4 opacity-80 text-red-200">The dam remains unfinished...</div>

            <div className="w-full max-w-sm bg-black/40 p-4 rounded-2xl border border-white/10 text-center mb-3 backdrop-blur-md shadow-2xl">
                <div className="text-amber-400 font-bold uppercase tracking-widest text-[10px]">Final Score</div>
                <div className="text-5xl font-black text-white mb-1 drop-shadow-lg tracking-tight">{score.toLocaleString()}</div>
                <div className="text-xs font-bold text-amber-300 mb-3">
                    {score <= 0 ? 'Score some points to get on the leaderboard!' : leaderboardRank ? `#${leaderboardRank} on the leaderboard!` : 'Not on the leaderboard this time.'}
                </div>
                <div className="grid grid-cols-3 gap-2 text-left">
                    <div className="bg-white/5 p-2 rounded-xl border border-white/5">
                        <div className="text-[9px] uppercase text-white/50 font-bold">Logs</div>
                        <div className="text-lg font-bold">{totalLogs}</div>
                    </div>
                    <div className="bg-white/5 p-2 rounded-xl border border-white/5">
                        <div className="text-[9px] uppercase text-white/50 font-bold">Built</div>
                        <div className="text-lg font-bold">{structures}</div>
                    </div>
                    <div className="bg-white/5 p-2 rounded-xl border border-white/5">
                        <div className="text-[9px] uppercase text-white/50 font-bold">Day</div>
                        <div className="text-lg font-bold">{day}</div>
                    </div>
                </div>
            </div>

            <div className="w-full max-w-sm mb-3">
                <NameEditor />
                <LeaderboardTable highlightId={runKey} />
            </div>

            <div className="w-full max-w-sm grid grid-cols-2 gap-2">
                <MenuButton variant="primary" onClick={() => startGame()}>TRY AGAIN</MenuButton>
                <MenuButton onClick={() => setView('load')} disabled={!persistence.listSlots().some(s => s !== null)}>📂 Load</MenuButton>
            </div>
        </div>
    );
};

// =====================================================================
// App
// =====================================================================
export default function App() {
  const phase = useGameStore(state => state.phase);

  // Chucky's fact nuggets (public/chucky-facts.json)
  useEffect(() => {
     facts.load();
  }, []);

  useEffect(() => {
     const unlock = () => {
         audioService.resume();
         audioService.startMusic();
         window.removeEventListener('click', unlock);
         window.removeEventListener('touchstart', unlock);
     };
     window.addEventListener('click', unlock);
     window.addEventListener('touchstart', unlock);

     return () => {
         window.removeEventListener('click', unlock);
         window.removeEventListener('touchstart', unlock);
     };
  }, []);

  return (
    <ErrorBoundary>
        <div className="w-full h-full bg-sky-300 relative overflow-hidden select-none font-sans">
            {phase === 'START' && <StartScreen />}
            {phase === 'GAMEOVER' && <GameOverScreen />}

            {phase === 'PLAYING' && (
                <>
                    <Hud />
                    <PowerupPills />
                    <NotificationUI />
                    <PlacementPanel />
                    <Controls />
                    <BuildMenuOverlay />
                    <GameMenuOverlay />
                    <MpFeed />
                    <ChuckyBubble />
                    <KnockoutOverlay />
                    <ConnectionLostOverlay />
                </>
            )}

            <Game3D />
        </div>
    </ErrorBoundary>
  );
}
