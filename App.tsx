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
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 flex flex-col gap-2 items-center pointer-events-none z-30 w-full">
            {isTreePowerupActive && (
                <div className="bg-orange-600/90 text-white px-4 py-1.5 rounded-full font-bold shadow-lg border-2 border-orange-400 animate-pulse flex items-center gap-2 text-sm">
                    <span className="text-lg">🪓</span>
                    <span>MEGA CHOMP: {Math.max(0, Math.ceil((treePowerupEndTime - Date.now()) / 1000))}s</span>
                </div>
            )}
            {isLogPowerupActive && (
                <div className="bg-blue-600/90 text-white px-4 py-1.5 rounded-full font-bold shadow-lg border-2 border-blue-400 animate-pulse flex items-center gap-2 text-sm">
                    <span className="text-lg">🧲</span>
                    <span>MAGNET: {Math.max(0, Math.ceil((logPowerupEndTime - Date.now()) / 1000))}s</span>
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
        <div className="absolute inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-6">
            <h2 className="text-4xl font-black text-white mb-6 tracking-tighter">BLUEPRINTS</h2>
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
                            relative p-4 rounded-xl border-4 flex flex-col items-center gap-2 transition-all
                            ${!bp.unlocked 
                                ? 'bg-gray-800 border-gray-700 opacity-50 cursor-not-allowed' 
                                : woodCount < bp.cost 
                                    ? 'bg-red-900/50 border-red-800 cursor-not-allowed' 
                                    : 'bg-blue-600 border-blue-400 hover:scale-105 active:scale-95 shadow-lg'}
                        `}
                    >
                        {!bp.unlocked && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
                                <span className="text-4xl">🔒</span>
                            </div>
                        )}
                        <div className="w-16 h-16 bg-black/30 rounded-full flex items-center justify-center mb-2">
                            <span className="text-3xl">🏗️</span>
                        </div>
                        <h3 className="text-white font-bold text-lg leading-none text-center">{bp.name}</h3>
                        <div className="flex items-center gap-1 bg-black/40 px-3 py-1 rounded-full">
                            <span className="text-sm">🪵</span>
                            <span className={`font-mono font-bold ${woodCount < bp.cost ? 'text-red-400' : 'text-white'}`}>
                                {bp.cost}
                            </span>
                        </div>
                        {!bp.unlocked && bp.unlockScore !== undefined && bp.unlockScore > 0 && (
                            <div className="text-xs text-amber-400 font-bold mt-1 bg-black/60 px-2 py-0.5 rounded">
                                Need {bp.unlockScore} Pts
                            </div>
                        )}
                    </button>
                ))}
            </div>
            <button 
                onClick={closeBuildMenu}
                className="mt-8 bg-white text-black font-bold py-3 px-8 rounded-full hover:bg-gray-200"
            >
                CLOSE
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
        <div className="absolute top-32 left-4 z-30 flex flex-col items-start pointer-events-none">
            {combo.multiplier > 1 && (
                <div className="text-4xl font-black text-yellow-400 drop-shadow-[0_2px_0_rgba(0,0,0,1)] italic tracking-tighter transform -rotate-6 animate-bounce mb-1">
                    {combo.multiplier}x
                </div>
            )}
            <div className="bg-black/60 backdrop-blur-md p-2 rounded-lg border border-white/20 w-36">
                <div className="flex justify-between text-white text-[10px] font-bold mb-0.5">
                    <span>COMBO</span>
                    <span>{(timeLeft / 1000).toFixed(1)}s</span>
                </div>
                <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div 
                        className={`h-full transition-all duration-100 ${timeLeft < 2000 ? 'bg-red-500' : 'bg-yellow-400'}`}
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <div className="text-left text-white/70 text-[8px] mt-0.5">
                    {combo.multiplier === 1 ? `${combo.logsCollected}/3 to 2x` : `${combo.logsSinceLastLevel}/3 to Next`}
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
            <div className="bg-black/60 backdrop-blur-md p-2 rounded-xl border border-white/20">
                <div className="text-amber-400 text-[10px] font-bold uppercase tracking-wider text-right">Score</div>
                <div className="text-white text-xl font-black text-right">{score.toLocaleString()}</div>
                <div className="text-white/60 text-[8px] mt-0.5 text-right">Logs: {totalLogs}</div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div 
                className="animate-bounce cursor-pointer pointer-events-auto w-full max-w-xs px-4"
                onClick={handleClick}
            >
                <div className="bg-gradient-to-r from-amber-500 to-orange-600 p-0.5 rounded-xl shadow-2xl hover:scale-105 transition-transform">
                    <div className="bg-black/90 backdrop-blur-xl px-4 py-3 rounded-xl flex flex-col items-center text-center">
                        <div className="text-xl mb-1">
                            {notification.type === 'unlock' ? '🔓' : notification.type === 'info' ? '⚡' : '🏆'}
                        </div>
                        <div className="text-amber-400 font-black text-xs uppercase tracking-widest mb-0.5">
                            {notification.title}
                        </div>
                        <div className="text-white font-bold text-xs leading-tight">
                            {notification.message}
                        </div>
                        {notification.type === 'unlock' && (
                            <div className="text-[8px] text-white/50 mt-1 uppercase tracking-wider font-bold">
                                Tap to Open Menu
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
        <div className="w-full h-full bg-sky-300 relative overflow-hidden select-none">
            <ScoreUI />
            <NotificationUI />
            <PowerupTimerUI />
            {phase === 'START' && (
                <div className="absolute inset-0 z-40 bg-black/60 flex flex-col items-center justify-center text-white p-6">
                    <h1 className="text-5xl font-black mb-4 tracking-tighter text-amber-500 drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)] text-center leading-tight">
                        CHUCKY THE<br/>WOODCHUCK
                    </h1>
                    <div className="max-w-md text-center text-sm mb-8 text-gray-200 space-y-3">
                        <p className="italic text-base opacity-80">The river is flowing. The dam must be built.</p>
                        
                        <div className="bg-black/40 p-4 rounded-xl border border-white/10 text-left space-y-2 text-xs md:text-sm">
                            <p>🕹️ <b className="text-amber-400">MOVE:</b> Use the joystick to run and swim.</p>
                            <p>🪓 <b className="text-amber-400">CHOMP:</b> Bump into trees to fell them.</p>
                            <p>⚡ <b className="text-amber-400">COMBO:</b> Collect 3 logs in 15s to start a multiplier! Keep going for up to 4x logs!</p>
                            <p>🏗️ <b className="text-amber-400">BUILD:</b> Open the menu to unlock blueprints. Use the joystick to rotate/tilt before placing.</p>
                            <p>💥 <b className="text-amber-400">DESTROY:</b> Touch a structure to destroy it and reclaim 80% of the logs.</p>
                        </div>
                    </div>
                    <button 
                        onClick={startGame}
                        className="bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 px-10 rounded-full text-xl transition-transform transform active:scale-95 shadow-xl border-4 border-amber-800"
                    >
                        START CHOMPING
                    </button>
                </div>
            )}
            
            {phase === 'GAMEOVER' && (
                <div className="absolute inset-0 z-50 bg-red-900/80 flex flex-col items-center justify-center text-white p-6 animate-in fade-in duration-500">
                    <h1 className="text-6xl font-black mb-2 tracking-tighter text-black drop-shadow-[0_2px_0_rgba(255,255,255,0.5)]">GAME OVER</h1>
                    <div className="text-2xl font-bold mb-8 opacity-80">The dam remains unfinished...</div>
                    
                    <div className="bg-black/40 p-6 rounded-2xl border-4 border-white/10 text-center mb-8 w-full max-w-md backdrop-blur-md shadow-2xl transform rotate-1">
                        <div className="text-amber-400 font-bold uppercase tracking-widest text-sm mb-1">Final Score</div>
                        <div className="text-6xl font-black text-white mb-4 drop-shadow-md">{(useGameStore.getState().score || 0).toLocaleString()}</div>
                        
                        <div className="grid grid-cols-2 gap-4 text-left bg-black/30 p-4 rounded-xl">
                            <div>
                                <div className="text-[10px] uppercase text-white/50 font-bold">Logs Collected</div>
                                <div className="text-xl font-bold">{(useGameStore.getState().totalLogsCollected || 0)}</div>
                            </div>
                            <div>
                                <div className="text-[10px] uppercase text-white/50 font-bold">Structures Built</div>
                                <div className="text-xl font-bold">{(useGameStore.getState().placedStructures?.length || 0)}</div>
                            </div>
                        </div>
                    </div>
                    
                    <button 
                        onClick={startGame}
                        className="bg-white text-red-900 font-black py-4 px-12 rounded-full text-2xl hover:scale-105 transition-transform shadow-xl border-4 border-red-950"
                    >
                        TRY AGAIN
                    </button>
                </div>
            )}
            
            {phase === 'PLAYING' && (
                <>
                    {/* Wood Count - Moved below Health Bar */}
                    <div className="absolute top-16 left-4 z-30 pointer-events-none">
                        <div className="bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-xl text-white border border-white/10 shadow-lg flex items-center gap-2">
                            <span className="text-xl">🪵</span>
                            <span className="text-lg font-bold">{woodCount}</span>
                        </div>
                        {activeTree && (
                            <div className="mt-1 bg-black/40 backdrop-blur-md p-1.5 rounded-xl border border-white/10">
                                <div className="text-[8px] uppercase opacity-70 mb-0.5 text-white">Chomping...</div>
                                <div className="w-20 h-1.5 bg-black/50 rounded-full overflow-hidden border border-white/20">
                                    <div 
                                        className="h-full bg-green-500 transition-all duration-75"
                                        style={{ width: `${(activeTree.health / activeTree.maxHealth) * 100}%` }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                    
                    <ComboUI />

                    <Controls />
                    
                    {/* Build Menu Overlay - We need to wire this up properly */}
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