import React, { useRef, useState } from 'react';
import { useGameStore } from '../store';
import { audioService } from '../services/audio';

// Initialize global input if not exists
// @ts-ignore
if (!window.woodchuckInput) window.woodchuckInput = { x: 0, y: 0, isBuilding: false };

const Joystick = ({ 
    onMove, 
    className, 
    knobColor = "bg-white" 
}: { 
    onMove: (x: number, y: number) => void, 
    className?: string,
    knobColor?: string 
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const knobRef = useRef<HTMLDivElement>(null);
    const [active, setActive] = useState(false);

    const handleStart = (e: React.TouchEvent | React.MouseEvent) => {
        setActive(true);
        handleMove(e);
    };

    const handleEnd = () => {
        setActive(false);
        onMove(0, 0);
        if (knobRef.current) {
            knobRef.current.style.transform = `translate(0px, 0px)`;
        }
    };

    const handleMove = (e: React.TouchEvent | React.MouseEvent) => {
        if (!active && e.type !== 'touchstart' && e.type !== 'mousedown') return;
        if (!containerRef.current) return;

        let clientX, clientY;
        if ('touches' in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = (e as React.MouseEvent).clientX;
            clientY = (e as React.MouseEvent).clientY;
        }

        const rect = containerRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const maxDist = rect.width / 2;

        let dx = clientX - centerX;
        let dy = clientY - centerY;
        const dist = Math.sqrt(dx*dx + dy*dy);

        // Deadzone
        if (dist < 10) {
            dx = 0; dy = 0;
            if (knobRef.current) knobRef.current.style.transform = `translate(0px, 0px)`;
            onMove(0, 0);
            return;
        }

        if (dist > maxDist) {
            const ratio = maxDist / dist;
            dx *= ratio;
            dy *= ratio;
        }

        if (knobRef.current) {
            knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
        }

        // Normalize (-1 to 1)
        onMove(dx / maxDist, dy / maxDist);
    };

    return (
        <div 
            className={`w-32 h-32 bg-black/20 rounded-full backdrop-blur-sm relative border border-white/10 shadow-2xl pointer-events-auto touch-none ${className}`}
            ref={containerRef}
            onTouchStart={handleStart}
            onTouchMove={handleMove}
            onTouchEnd={handleEnd}
            onMouseDown={handleStart}
            onMouseMove={handleMove}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
        >
            <div 
                ref={knobRef}
                className={`w-12 h-12 rounded-full absolute top-1/2 left-1/2 -ml-6 -mt-6 shadow-lg border border-white/30 ${knobColor}`}
            />
        </div>
    );
};

export const Controls = () => {
  const woodCount = useGameStore(state => state.woodCount);
  const isPlacementMode = useGameStore(state => state.isPlacementMode);
  const destroyTargetId = useGameStore(state => state.destroyTargetId);
  const isDestroying = useGameStore(state => state.isDestroying);
  const openBuildMenu = useGameStore(state => state.openBuildMenu);
  const startDestroying = useGameStore(state => state.startDestroying);
  const stopDestroying = useGameStore(state => state.stopDestroying);
  const cycleCameraMode = useGameStore(state => state.cycleCameraMode);
  const cameraMode = useGameStore(state => state.cameraMode);
  const health = useGameStore(state => state.health);
  const maxHealth = useGameStore(state => state.maxHealth);

  const updateInput = (x: number, y: number) => {
    // @ts-ignore
    window.woodchuckInput.x = x;
    // @ts-ignore
    window.woodchuckInput.y = y;
  };

  const handleActionButton = (e?: React.SyntheticEvent) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    if (destroyTargetId) return;

    if (isPlacementMode) {
        // @ts-ignore
        window.woodchuckInput.isBuilding = true;
    } else {
        openBuildMenu();
    }
  };
  
  const handleDestroyStart = () => {
      if (destroyTargetId) startDestroying();
  };
  
  const handleDestroyEnd = () => {
      stopDestroying();
  };

  // Determine Button State
  let buttonLabel = "BUILD";
  let buttonColor = "bg-gradient-to-br from-blue-500 to-blue-700 active:from-blue-600 active:to-blue-800";

  if (destroyTargetId) {
      buttonLabel = isDestroying ? "DESTROYING..." : "DESTROY";
      buttonColor = "bg-gradient-to-br from-red-500 to-red-700 active:from-red-600 active:to-red-800";
  } else if (isPlacementMode) {
      buttonLabel = "PLACE";
      buttonColor = "bg-gradient-to-br from-green-500 to-green-700 active:from-green-600 active:to-green-800";
  }

  return (
    <>
        {/* Health Bar */}
        <div className="absolute top-4 left-4 z-50 pointer-events-none">
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md p-2 rounded-xl border border-white/20 shadow-lg">
                <div className="text-xl animate-pulse">❤️</div>
                <div className="w-32 h-4 bg-gray-900/80 rounded-full overflow-hidden border border-white/10 relative">
                    <div 
                        className="h-full bg-gradient-to-r from-red-500 to-red-600 transition-all duration-300 shadow-[0_0_10px_rgba(239,68,68,0.5)]"
                        style={{ width: `${(health / maxHealth) * 100}%` }}
                    />
                    <div className="absolute top-0 left-0 w-full h-1/2 bg-white/10" />
                </div>
                <div className="text-white font-bold font-mono text-xs drop-shadow-md">{Math.ceil(health)}/{maxHealth}</div>
            </div>
        </div>

        {/* Top Right Controls: View & Build */}
        <div className="absolute top-24 right-4 z-50 flex flex-row gap-3 items-start pointer-events-none">
            <button 
                className="w-14 h-14 bg-black/60 backdrop-blur-md rounded-2xl pointer-events-auto border border-white/20 flex flex-col items-center justify-center shadow-lg active:scale-90 transition-all hover:bg-black/70 group"
                onClick={cycleCameraMode}
            >
                <span className="text-xl group-hover:scale-110 transition-transform">📷</span>
                <span className="text-[8px] text-white/80 font-bold uppercase mt-0.5 tracking-wide">{cameraMode}</span>
            </button>

            <button 
                className={`w-14 h-14 rounded-2xl pointer-events-auto shadow-xl flex flex-col items-center justify-center border-2 border-white/50 transition-all transform active:scale-95 touch-none ${buttonColor}`}
                onPointerDown={destroyTargetId ? handleDestroyStart : undefined}
                onClick={destroyTargetId ? undefined : handleActionButton}
                onPointerUp={destroyTargetId ? handleDestroyEnd : undefined}
                onPointerLeave={destroyTargetId ? handleDestroyEnd : undefined}
            >
                <span className="text-2xl filter drop-shadow-md">
                    {destroyTargetId ? '💥' : isPlacementMode ? '✅' : '🏗️'}
                </span>
            </button>
        </div>

        {/* Single Joystick - Bottom Middle */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-50">
            <Joystick 
                onMove={updateInput} 
                knobColor="bg-gradient-to-b from-amber-400 to-orange-600"
            />
        </div>
    </>
  );
};