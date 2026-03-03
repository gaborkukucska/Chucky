import React, { Component, useEffect, useState, ReactNode } from 'react';
import { Game3D } from './components/Game3D';
import { Controls } from './components/Controls';
import { useGameStore } from './store';
import { audioService } from './services/audio';

const PowerupTimerUI = () => {
    const isTreePowerupActive = useGameStore(state => state.isTreePowerupActive);
    const isLogPowerupActive = useGameStore(state => state.isLogPowerupActive);
    const treePowerupEndTime = useGameStore(state => state.treePowerupEndTime);
    const logPowerupEndTime = useGameStore(state => state.logPowerupEndTime);
    
    // Force re-render every second to update timer
    const [_, setTick] = useState(0);
    useEffect(() => {
        if (!isTreePowerupActive && !isLogPowerupActive) return;
        const interval = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(interval);
    }, [isTreePowerupActive, isLogPowerupActive]);

    if (!isTreePowerupActive && !isLogPowerupActive) return null;

    return (
        <div className="absolute top-40 left-1/2 transform -translate-x-1/2 flex flex-col gap-2 items-center pointer-events-none z-30 w-full">
            {isTreePowerupActive && (
                <div className="bg-black/60 backdrop-blur-md text-white px-4 py-2 rounded-xl border-2 border-orange-500 shadow-lg flex items-center gap-3 min-w-[200px]">
                    <span className="text-2xl">🪓</span>
                    <div className="flex flex-col flex-1">
                        <span className="text-[10px] font-bold text-orange-400 uppercase tracking-wider">Mega Chomp</span>
                        <span className="font-mono font-bold text-lg leading-none">{Math.max(0, Math.ceil((treePowerupEndTime - Date.now()) / 1000))}s</span>
                    </div>
                </div>
            )}
            {isLogPowerupActive && (
                <div className="bg-black/60 backdrop-blur-md text-white px-4 py-2 rounded-xl border-2 border-blue-500 shadow-lg flex items-center gap-3 min-w-[200px]">
                    <span className="text-2xl">🧲</span>
                    <div className="flex flex-col flex-1">
                        <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Magnet</span>
                        <span className="font-mono font-bold text-lg leading-none">{Math.max(0, Math.ceil((logPowerupEndTime - Date.now()) / 1000))}s</span>
                    </div>
                </div>
            )}
        </div>
    );
};

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

const BuildMenu = () => {
    const blueprints = useGameStore(state => state.blueprints);
    const woodCount = useGameStore(state => state.woodCount);
    const selectBlueprint = useGameStore(state => state.selectBlueprint);
    const closeBuildMenu = useGameStore(state => state.closeBuildMenu);
    
    return (
        <div className="absolute inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-6 animate-in fade-in duration-200">
            <h2 className="text-4xl font-black text-white mb-6 tracking-tighter drop-shadow-lg">BLUEPRINTS</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 w-full max-w-4xl overflow-y-auto max-h-[60vh] p-2">
                {blueprints.map(bp => (
                    <button 
                        key={bp.id}
                        disabled={!bp.unlocked || woodCount < bp.cost}
                        onClick={(e) => {
                            e.stopPropagation();
                            selectBlueprint(bp.id);
                        }}
                        className={`
                            relative p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all
                            ${!bp.unlocked 
                                ? 'bg-gray-900/80 border-gray-700 opacity-60 cursor-not-allowed' 
                                : woodCount < bp.cost 
                                    ? 'bg-red-900/50 border-red-800 cursor-not-allowed' 
                                    : 'bg-black/60 border-amber-500 hover:bg-amber-900/40 hover:scale-105 active:scale-95 shadow-xl'}
                        `}
                    >
                        {!bp.unlocked && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-2xl z-10">
                                <span className="text-4xl">🔒</span>
                            </div>
                        )}
                        <div className="w-16 h-16 bg-black/30 rounded-full flex items-center justify-center mb-2 border border-white/10">
                            <span className="text-3xl">🏗️</span>
                        </div>
                        <h3 className="text-white font-bold text-lg leading-none text-center mb-1">{bp.name}</h3>
                        <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold ${woodCount < bp.cost ? 'bg-red-900/50 text-red-200' : 'bg-amber-900/50 text-amber-200'}`}>
                            <span>🪵</span>
                            <span className="font-mono">{bp.cost}</span>
                        </div>
                        {!bp.unlocked && bp.unlockScore !== undefined && bp.unlockScore > 0 && (
                            <div className="text-[10px] text-amber-400 font-bold mt-2 uppercase tracking-wider">
                                Need {bp.unlockScore} Pts
                            </div>
                        )}
                    </button>
                ))}
            </div>
            <button 
                onClick={closeBuildMenu}
                className="mt-8 bg-white text-black font-black py-3 px-10 rounded-full hover:bg-gray-200 shadow-xl transition-transform active:scale-95"
            >
                CLOSE MENU
            </button>
        </div>
    );
};

const ComboUI = () => {
    const combo = useGameStore(state => state.combo);
    const endCombo = useGameStore(state => state.endCombo);
    const isPaused = useGameStore(state => state.isPaused);
    const [timeLeft, setTimeLeft] = React.useState(0);
    const [progress, setProgress] = React.useState(0);

    useEffect(() => {
        if (!combo.active || isPaused) return;
        
        const interval = setInterval(() => {
            const now = Date.now();
            let duration = 0;
            let start = 0;
            
            if (combo.multiplier === 1) {
                duration = 15000; // 15s for first level
                start = combo.startTime;
            } else {
                duration = 5000; // 5s for subsequent levels (burst window)
                start = combo.levelStartTime;
            }
            
            const elapsed = now - start;
            const remaining = Math.max(0, duration - elapsed);
            
            if (remaining <= 0) {
                endCombo();
            }
            
            setTimeLeft(remaining);
            setProgress((remaining / duration) * 100);
            
        }, 100);
        
        return () => clearInterval(interval);
    }, [combo.active, combo.multiplier, combo.startTime, combo.levelStartTime, endCombo, isPaused]);
    
    if (!combo.active) return null;
    
    return (
        <div className="absolute top-48 left-4 z-30 flex flex-col items-start pointer-events-none">
            {combo.multiplier > 1 && (
                <div className="text-5xl font-black text-amber-400 drop-shadow-[0_4px_0_rgba(0,0,0,1)] italic tracking-tighter transform -rotate-6 animate-bounce mb-2 ml-2">
                    {combo.multiplier}x
                </div>
            )}
            <div className="bg-black/60 backdrop-blur-md p-3 rounded-xl border border-white/10 w-40 shadow-lg">
                <div className="flex justify-between text-white text-[10px] font-bold mb-1 uppercase tracking-wider">
                    <span>Combo Timer</span>
                    <span className="font-mono text-amber-400">{(timeLeft / 1000).toFixed(1)}s</span>
                </div>
                <div className="w-full h-2 bg-black/50 rounded-full overflow-hidden border border-white/10 mb-1">
                    <div 
                        className={`h-full transition-all duration-100 ${timeLeft < 2000 ? 'bg-red-500' : 'bg-amber-400'}`}
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <div className="text-left text-white/70 text-[9px] font-medium">
                    {combo.multiplier === 1 ? `${combo.logsCollected}/3 to Start Multiplier` : `${combo.logsSinceLastLevel}/3 to Extend`}
                </div>
            </div>
        </div>
    );
}

const ScoreUI = () => {
    const score = useGameStore(state => state.score) || 0;
    const totalLogs = useGameStore(state => state.totalLogsCollected) || 0;
    
    return (
        <div className="absolute top-4 right-4 z-30 flex flex-col items-end pointer-events-none">
            <div className="bg-black/60 backdrop-blur-md p-3 rounded-2xl border border-white/10 shadow-xl min-w-[140px]">
                <div className="text-amber-400 text-[10px] font-bold uppercase tracking-widest text-right mb-0.5">Score</div>
                <div className="text-white text-3xl font-black text-right leading-none tracking-tight">{score.toLocaleString()}</div>
                <div className="w-full h-px bg-white/10 my-2"></div>
                <div className="flex justify-between items-center text-[10px] text-white/60 font-bold uppercase tracking-wider">
                    <span>Logs</span>
                    <span className="text-white text-sm">{totalLogs}</span>
                </div>
            </div>
        </div>
    );
};

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
        <div className="fixed top-24 inset-x-0 z-50 flex justify-center pointer-events-none">
            <div 
                className="animate-in slide-in-from-top-4 duration-300 cursor-pointer pointer-events-auto w-full max-w-sm px-4"
                onClick={handleClick}
            >
                <div className="bg-black/80 backdrop-blur-xl p-4 rounded-2xl border border-amber-500/50 shadow-2xl flex items-center gap-4 hover:scale-105 transition-transform">
                    <div className="text-3xl bg-amber-500/20 p-2 rounded-xl border border-amber-500/30">
                        {notification.type === 'unlock' ? '🔓' : notification.type === 'info' ? '⚡' : '🏆'}
                    </div>
                    <div className="flex-1 text-left">
                        <div className="text-amber-400 font-black text-xs uppercase tracking-widest mb-1">
                            {notification.title}
                        </div>
                        <div className="text-white font-bold text-sm leading-tight">
                            {notification.message}
                        </div>
                        {notification.type === 'unlock' && (
                            <div className="text-[9px] text-white/50 mt-1.5 uppercase tracking-wider font-bold flex items-center gap-1">
                                <span>Tap to Open Menu</span>
                                <span className="text-xs">→</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default function App() {
  const { phase, startGame, woodCount, trees, activeTreeId, isPlacementMode, selectedBlueprintId, isBuildMenuOpen } = useGameStore();

  // Derived state for the active tree's health
  const activeTree = activeTreeId ? trees.find(t => t.id === activeTreeId) : null;
  
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
            <ScoreUI />
            <NotificationUI />
            <PowerupTimerUI />
            {phase === 'START' && (
                <div className="absolute inset-0 z-40 bg-black/80 flex flex-col items-center justify-center text-white p-6 backdrop-blur-sm">
                    <h1 className="text-6xl md:text-8xl font-black mb-6 tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-amber-400 to-amber-600 drop-shadow-lg text-center leading-none">
                        CHUCKY<br/>THE<br/>WOODCHUCK
                    </h1>
                    <div className="max-w-md text-center text-sm mb-10 text-gray-300 space-y-4">
                        <p className="italic text-lg opacity-90 font-serif">The river is flowing. The dam must be built.</p>
                        
                        <div className="bg-white/5 p-6 rounded-2xl border border-white/10 text-left space-y-3 text-sm shadow-xl">
                            <p className="flex items-center gap-3"><span className="text-2xl">🕹️</span> <span><b className="text-amber-400 uppercase tracking-wide">MOVE</b> with joystick</span></p>
                            <p className="flex items-center gap-3"><span className="text-2xl">🪓</span> <span><b className="text-amber-400 uppercase tracking-wide">CHOMP</b> trees by bumping them</span></p>
                            <p className="flex items-center gap-3"><span className="text-2xl">⚡</span> <span><b className="text-amber-400 uppercase tracking-wide">COMBO</b> logs for multipliers</span></p>
                            <p className="flex items-center gap-3"><span className="text-2xl">🏗️</span> <span><b className="text-amber-400 uppercase tracking-wide">BUILD</b> dams to score big</span></p>
                        </div>
                    </div>
                    <button 
                        onClick={startGame}
                        className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-black py-4 px-12 rounded-full text-2xl transition-all transform hover:scale-105 active:scale-95 shadow-2xl border-4 border-amber-300/20"
                    >
                        START CHOMPING
                    </button>
                </div>
            )}
            
            {phase === 'GAMEOVER' && (
                <div className="absolute inset-0 z-50 bg-red-950/90 flex flex-col items-center justify-center text-white p-6 animate-in fade-in duration-500 backdrop-blur-sm">
                    <h1 className="text-7xl font-black mb-2 tracking-tighter text-white drop-shadow-xl">GAME OVER</h1>
                    <div className="text-2xl font-bold mb-10 opacity-80 text-red-200">The dam remains unfinished...</div>
                    
                    <div className="bg-black/40 p-8 rounded-3xl border border-white/10 text-center mb-10 w-full max-w-md backdrop-blur-md shadow-2xl">
                        <div className="text-amber-400 font-bold uppercase tracking-widest text-sm mb-2">Final Score</div>
                        <div className="text-7xl font-black text-white mb-8 drop-shadow-lg tracking-tight">{(useGameStore.getState().score || 0).toLocaleString()}</div>
                        
                        <div className="grid grid-cols-2 gap-4 text-left">
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                                <div className="text-[10px] uppercase text-white/50 font-bold tracking-wider mb-1">Logs Collected</div>
                                <div className="text-2xl font-bold">{(useGameStore.getState().totalLogsCollected || 0)}</div>
                            </div>
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                                <div className="text-[10px] uppercase text-white/50 font-bold tracking-wider mb-1">Structures Built</div>
                                <div className="text-2xl font-bold">{(useGameStore.getState().placedStructures?.length || 0)}</div>
                            </div>
                        </div>
                    </div>
                    
                    <button 
                        onClick={startGame}
                        className="bg-white text-red-900 font-black py-4 px-12 rounded-full text-2xl hover:scale-105 transition-transform shadow-xl border-4 border-red-200"
                    >
                        TRY AGAIN
                    </button>
                </div>
            )}
            
            {phase === 'PLAYING' && (
                <>
                    {/* Wood Count & Health - Top Left */}
                    <div className="absolute top-20 left-4 z-30 pointer-events-none flex flex-col gap-2">
                        <div className="bg-black/60 backdrop-blur-md p-3 rounded-2xl border border-white/10 shadow-xl min-w-[140px]">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="bg-amber-900/50 p-1.5 rounded-lg border border-amber-700/50">
                                    <span className="text-xl">🪵</span>
                                </div>
                                <div>
                                    <div className="text-[9px] font-bold text-amber-400 uppercase tracking-wider">Wood</div>
                                    <div className="text-2xl font-black text-white leading-none">{woodCount}</div>
                                </div>
                            </div>
                            
                            {activeTree && (
                                <div className="mt-2 pt-2 border-t border-white/10">
                                    <div className="flex justify-between items-center mb-1">
                                        <div className="text-[9px] uppercase font-bold text-white/70 tracking-wider">Tree Health</div>
                                        <div className="text-[9px] font-mono text-white/50">{Math.ceil(activeTree.health)}%</div>
                                    </div>
                                    <div className="w-full h-2 bg-black/50 rounded-full overflow-hidden border border-white/10">
                                        <div 
                                            className="h-full bg-gradient-to-r from-green-600 to-green-400 transition-all duration-75"
                                            style={{ width: `${(activeTree.health / activeTree.maxHealth) * 100}%` }}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    
                    <ComboUI />

                    <Controls />
                    
                    <GameMenuOverlay />
                </>
            )}

            <Game3D />
        </div>
    </ErrorBoundary>
  );
}

// Separate component to connect to store for menu visibility
const GameMenuOverlay = () => {
    const isBuildMenuOpen = useGameStore((state: any) => state.isBuildMenuOpen);
    if (!isBuildMenuOpen) return null;
    return <BuildMenu />;
}