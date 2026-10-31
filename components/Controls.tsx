import React, { useEffect, useRef, useState } from 'react';
import { useGameStore, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX, THROW_CHARGE_MS, throwPowerForCharge } from '../store';
import { throwAim } from '../globals';
import { facts } from '../services/facts';

// Hold to aim (higher the longer you hold), release to throw - touch button and keyboard
const startThrowAim = () => {
    throwAim.charging = true;
    throwAim.startedAt = performance.now();
};
const releaseThrow = () => {
    if (!throwAim.charging) return;
    throwAim.charging = false;
    useGameStore.getState().throwLog(throwPowerForCharge(performance.now() - throwAim.startedAt));
};
const cancelThrowAim = () => {
    throwAim.charging = false;
};

// Global input shared with the Woodchuck frame loop
// @ts-ignore
if (!window.woodchuckInput) window.woodchuckInput = { x: 0, y: 0, isBuilding: false, dive: false };
// @ts-ignore
if (window.woodchuckInput.dive === undefined) window.woodchuckInput.dive = false;

const setInput = (patch: Record<string, number | boolean>) => {
    // @ts-ignore
    Object.assign(window.woodchuckInput, patch);
};

// =====================================================================
// Joystick
// Uses targetTouches so a second finger on another button (dive, destroy)
// can't hijack the stick.
// =====================================================================
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
        handleMove(e, true);
    };

    const handleEnd = (e?: React.TouchEvent | React.MouseEvent) => {
        // Another finger may still be on the stick
        if (e && 'targetTouches' in e && e.targetTouches.length > 0) return;
        setActive(false);
        onMove(0, 0);
        if (knobRef.current) knobRef.current.style.transform = `translate(0px, 0px)`;
    };

    const handleMove = (e: React.TouchEvent | React.MouseEvent, starting = false) => {
        if (!active && !starting) return;
        if (!containerRef.current) return;

        let clientX: number, clientY: number;
        if ('targetTouches' in e) {
            const touch = e.targetTouches[0];
            if (!touch) return;
            clientX = touch.clientX;
            clientY = touch.clientY;
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
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Deadzone
        if (dist < 10) {
            if (knobRef.current) knobRef.current.style.transform = `translate(0px, 0px)`;
            onMove(0, 0);
            return;
        }

        if (dist > maxDist) {
            const ratio = maxDist / dist;
            dx *= ratio;
            dy *= ratio;
        }

        if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;

        // Normalize (-1 to 1)
        onMove(dx / maxDist, dy / maxDist);
    };

    return (
        <div
            className={`w-28 h-28 bg-black/20 rounded-full backdrop-blur-sm relative border border-white/10 shadow-2xl pointer-events-auto touch-none ${className || ''}`}
            ref={containerRef}
            onTouchStart={handleStart}
            onTouchMove={(e) => handleMove(e)}
            onTouchEnd={handleEnd}
            onTouchCancel={handleEnd}
            onMouseDown={handleStart}
            onMouseMove={(e) => handleMove(e)}
            onMouseUp={() => handleEnd()}
            onMouseLeave={() => handleEnd()}
        >
            <div
                ref={knobRef}
                className={`w-11 h-11 rounded-full absolute top-1/2 left-1/2 -ml-[22px] -mt-[22px] shadow-lg border border-white/30 ${knobColor}`}
            />
        </div>
    );
};

// =====================================================================
// Hold-to-dive button (only shown in the river)
// =====================================================================
const DiveButton = () => {
    const isInWater = useGameStore(state => state.isInWater);
    const breath = useGameStore(state => state.breath);
    const [held, setHeld] = useState(false);

    const press = (e: React.PointerEvent) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        setHeld(true);
        setInput({ dive: true });
    };
    const release = () => {
        setHeld(false);
        setInput({ dive: false });
    };

    if (!isInWater) {
        // Leaving the water while holding must not leave dive stuck on
        // @ts-ignore
        if (window.woodchuckInput.dive && !keyboardState.diveKey) setInput({ dive: false });
        return null;
    }

    const empty = breath <= 0.02;
    return (
        <div className="absolute bottom-10 left-5 z-50 flex flex-col items-center gap-1 pointer-events-none">
            <button
                className={`w-16 h-16 rounded-full pointer-events-auto touch-none select-none shadow-xl border-2 flex items-center justify-center transition-transform
                    ${held ? 'scale-90 bg-cyan-700/80 border-cyan-200' : 'bg-cyan-600/60 border-white/40'} ${empty ? 'opacity-40' : ''}`}
                onPointerDown={press}
                onPointerUp={release}
                onPointerCancel={release}
                onLostPointerCapture={release}
                onContextMenu={(e) => e.preventDefault()}
                aria-label="Hold to dive"
            >
                <span className="text-2xl">🤿</span>
            </button>
            <span className="text-[9px] font-bold text-white/80 uppercase tracking-wider drop-shadow">Hold to dive</span>
        </div>
    );
};

// =====================================================================
// Throw button - on land, in the dive button's spot (left thumb)
// =====================================================================
const ThrowButton = () => {
    const isInWater = useGameStore(state => state.isInWater);
    const hasWood = useGameStore(state => state.woodCount >= 1);
    const [aiming, setAiming] = useState(false);

    // Walking into the water mid-aim cancels the throw
    useEffect(() => {
        if (isInWater && throwAim.charging) {
            cancelThrowAim();
            setAiming(false);
        }
    }, [isInWater]);

    if (isInWater) return null;

    const press = (e: React.PointerEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId); // Release counts even if the thumb slides off
        startThrowAim();
        setAiming(true);
    };
    const release = () => {
        releaseThrow();
        setAiming(false);
    };
    const cancel = () => {
        cancelThrowAim();
        setAiming(false);
    };

    return (
        <div className="absolute bottom-10 left-5 z-50 flex flex-col items-center gap-1 pointer-events-none">
            <button
                className={`relative overflow-hidden w-16 h-16 rounded-full pointer-events-auto touch-none select-none shadow-xl border-2 flex items-center justify-center transition-transform
                    ${aiming ? 'scale-95 bg-amber-800/80 border-amber-200' : 'bg-amber-700/60 border-white/40'} ${hasWood ? '' : 'opacity-40'}`}
                onPointerDown={press}
                onPointerUp={release}
                onPointerCancel={cancel}
                aria-label="Throw a log"
            >
                {/* Fills up while held: how high the throw is aimed */}
                <span
                    className="absolute inset-x-0 bottom-0 bg-amber-300/50"
                    style={{ height: aiming ? '100%' : '0%', transition: aiming ? `height ${THROW_CHARGE_MS}ms linear` : 'none' }}
                />
                <span className="relative text-2xl">🪵</span>
            </button>
            <span className="text-[9px] font-bold text-white/80 uppercase tracking-wider drop-shadow">{!hasWood ? 'No logs' : aiming ? 'Further…' : 'Tap or hold'}</span>
        </div>
    );
};

// =====================================================================
// Zoom slider (right edge): top = closer, bottom = further. Double-tap resets.
// =====================================================================
const SLIDER_PAD = 12; // px of track above/below the thumb's travel

const ZoomSlider = () => {
    const zoom = useGameStore(state => state.cameraZoom);
    const setCameraZoom = useGameStore(state => state.setCameraZoom);
    const trackRef = useRef<HTMLDivElement>(null);
    const t = (zoom - CAMERA_ZOOM_MIN) / (CAMERA_ZOOM_MAX - CAMERA_ZOOM_MIN);

    const setFromPointer = (clientY: number) => {
        const track = trackRef.current;
        if (!track) return;
        const rect = track.getBoundingClientRect();
        const f = Math.max(0, Math.min(1, (clientY - rect.top - SLIDER_PAD) / (rect.height - SLIDER_PAD * 2)));
        setCameraZoom(CAMERA_ZOOM_MIN + f * (CAMERA_ZOOM_MAX - CAMERA_ZOOM_MIN));
    };

    return (
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-1 pointer-events-none select-none">
            <span className="text-white/90 text-base font-black leading-none drop-shadow">+</span>
            <div
                ref={trackRef}
                className="relative w-8 h-40 rounded-full bg-black/35 border border-white/15 backdrop-blur-sm pointer-events-auto touch-none"
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setFromPointer(e.clientY); }}
                onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromPointer(e.clientY); }}
                onDoubleClick={() => setCameraZoom(1)}
                aria-label="Camera zoom"
            >
                <div className="absolute left-1/2 -translate-x-1/2 w-1 rounded-full bg-white/25" style={{ top: SLIDER_PAD, bottom: SLIDER_PAD }} />
                <div
                    className="absolute left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-gradient-to-b from-amber-300 to-orange-500 border border-white/60 shadow-lg"
                    style={{ top: `calc(${SLIDER_PAD}px + ${t} * (100% - ${SLIDER_PAD * 2}px) - 12px)` }}
                />
            </div>
            <span className="text-white/90 text-base font-black leading-none drop-shadow">−</span>
            <span className="text-[8px] text-white/70 font-bold uppercase tracking-wider drop-shadow">Zoom</span>
        </div>
    );
};

const CAMERA_LABELS: Record<string, string> = {
    BEHIND: '🎥 3rd person - steer with the stick',
    FOLLOW: '🗺️ Overview',
    TOP_DOWN: '🛰️ Top-down',
    CINEMATIC: '🎬 Cinematic',
};

// =====================================================================
// Controls
// =====================================================================
export const Controls = () => {
    const isPlacementMode = useGameStore(state => state.isPlacementMode);
    const destroyTargetId = useGameStore(state => state.destroyTargetId);
    const openBuildMenu = useGameStore(state => state.openBuildMenu);
    const cancelPlacement = useGameStore(state => state.cancelPlacement);
    const startDestroying = useGameStore(state => state.startDestroying);
    const stopDestroying = useGameStore(state => state.stopDestroying);
    const cycleCameraMode = useGameStore(state => state.cycleCameraMode);
    const openGameMenu = useGameStore(state => state.openGameMenu);
    const cameraMode = useGameStore(state => state.cameraMode);

    // Show the camera mode's name briefly whenever it changes
    const [cameraLabel, setCameraLabel] = useState<string | null>(null);
    const firstRender = useRef(true);
    useEffect(() => {
        if (firstRender.current) { firstRender.current = false; return; }
        setCameraLabel(CAMERA_LABELS[cameraMode] || cameraMode);
        const timer = setTimeout(() => setCameraLabel(null), 1800);
        return () => clearTimeout(timer);
    }, [cameraMode]);

    const updateInput = (x: number, y: number) => setInput({ x, y });

    const handleActionButton = (e?: React.SyntheticEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (destroyTargetId) return;
        if (isPlacementMode) {
            setInput({ isBuilding: true });
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

    let buttonColor = "bg-gradient-to-br from-blue-500 to-blue-700 active:from-blue-600 active:to-blue-800";
    if (destroyTargetId) {
        buttonColor = "bg-gradient-to-br from-red-500 to-red-700 active:from-red-600 active:to-red-800";
    } else if (isPlacementMode) {
        buttonColor = "bg-gradient-to-br from-green-500 to-green-700 active:from-green-600 active:to-green-800";
    }

    const smallBtn = "w-9 h-9 rounded-lg pointer-events-auto border border-white/20 flex items-center justify-center shadow-lg active:scale-90 transition-all";

    return (
        <>
            {/* Top Right: Build/Place/Destroy, Cancel (placing), Camera, Menu */}
            <div className="absolute top-2 right-2 z-50 flex flex-row gap-1.5 items-start pointer-events-none">
                <button
                    className={`${smallBtn} border-white/30 touch-none ${buttonColor}`}
                    onPointerDown={destroyTargetId ? handleDestroyStart : undefined}
                    onClick={destroyTargetId ? undefined : handleActionButton}
                    onPointerUp={destroyTargetId ? handleDestroyEnd : undefined}
                    onPointerLeave={destroyTargetId ? handleDestroyEnd : undefined}
                    onPointerCancel={destroyTargetId ? handleDestroyEnd : undefined}
                    aria-label={destroyTargetId ? 'Hold to destroy' : isPlacementMode ? 'Place structure' : 'Build'}
                >
                    <span className="text-base drop-shadow">
                        {destroyTargetId ? '💥' : isPlacementMode ? '✅' : '🏗️'}
                    </span>
                </button>

                {isPlacementMode && !destroyTargetId && (
                    <button className={`${smallBtn} bg-black/60 backdrop-blur-md`} onClick={cancelPlacement} aria-label="Cancel placement">
                        <span className="text-sm">✖️</span>
                    </button>
                )}

                <button className={`${smallBtn} bg-black/60 backdrop-blur-md`} onClick={cycleCameraMode} aria-label="Change camera">
                    <span className="text-base">📷</span>
                </button>

                <button className={`${smallBtn} bg-black/60 backdrop-blur-md`} onClick={openGameMenu} aria-label="Menu">
                    <span className="text-base text-white font-black leading-none">☰</span>
                </button>
            </div>

            {/* Joystick - Bottom Middle */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50">
                <Joystick
                    onMove={updateInput}
                    knobColor="bg-gradient-to-b from-amber-400 to-orange-600"
                />
            </div>

            <DiveButton />
            <ThrowButton />

            <ZoomSlider />

            {cameraLabel && (
                <div className="fixed top-1/3 inset-x-0 z-40 flex justify-center pointer-events-none">
                    <div className="bg-black/65 backdrop-blur-md text-white text-xs font-bold px-3 py-1.5 rounded-full border border-white/15 shadow-lg">
                        {cameraLabel}
                    </div>
                </div>
            )}
        </>
    );
};

// =====================================================================
// Keyboard: WASD / arrows to move, Space (hold) to dive, Esc for the menu
// =====================================================================
const keyboardState = { diveKey: false };

if (typeof window !== 'undefined') {
    const keys: Record<string, boolean> = { w: false, a: false, s: false, d: false, ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false };
    const MOVE_KEYS = Object.keys(keys);

    const isTyping = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null;
        return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };

    const updateKeyboardInput = () => {
        let x = 0;
        let y = 0;
        if (keys.w || keys.ArrowUp) y -= 1;
        if (keys.s || keys.ArrowDown) y += 1;
        if (keys.a || keys.ArrowLeft) x -= 1;
        if (keys.d || keys.ArrowRight) x += 1;

        // Normalize if diagonal
        if (x !== 0 && y !== 0) {
            const len = Math.sqrt(x * x + y * y);
            x /= len;
            y /= len;
        }
        setInput({ x, y });
    };

    window.addEventListener('keydown', (e) => {
        if (isTyping(e)) return;
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (MOVE_KEYS.includes(key)) {
            keys[key] = true;
            updateKeyboardInput();
        } else if (e.code === 'Space') {
            // In the water Space dives (hold); on land it throws a log
            e.preventDefault();
            if (useGameStore.getState().isInWater) {
                keyboardState.diveKey = true;
                setInput({ dive: true });
            } else if (!e.repeat) {
                startThrowAim(); // Throws on release; hold longer to aim higher
            }
        } else if (key === 'f') {
            if (!e.repeat) startThrowAim();
        } else if (key === 'r' || key === 'e' || key === 'q') {
            const s = useGameStore.getState();
            if (s.isPlacementMode) s.rotatePlacement(key === 'q' ? -Math.PI / 4 : Math.PI / 4);
        } else if (e.key === 'Enter') {
            const s = useGameStore.getState();
            if (s.chucky) {
                // Next line of Chucky's bubble
                if (s.chucky.kind === 'intro' && s.chucky.index === s.chucky.items.length - 1) facts.finishIntro();
                s.nextChucky();
            } else if (s.isPlacementMode) setInput({ isBuilding: true });
        } else if (e.key === 'Escape') {
            const s = useGameStore.getState();
            if (s.chucky) {
                if (s.chucky.kind === 'intro') facts.finishIntro();
                s.closeChucky();
            } else if (s.isGameMenuOpen) s.closeGameMenu();
            else if (s.isBuildMenuOpen) s.closeBuildMenu();
            else if (s.isPlacementMode) s.cancelPlacement();
            else s.openGameMenu();
        }
    });

    window.addEventListener('keyup', (e) => {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (MOVE_KEYS.includes(key)) {
            keys[key] = false;
            updateKeyboardInput();
        } else if (e.code === 'Space') {
            keyboardState.diveKey = false;
            setInput({ dive: false });
            releaseThrow();
        } else if (key === 'f') {
            releaseThrow();
        }
    });

    // Mouse wheel zooms the camera while playing (laptop); menus keep the wheel for scrolling
    window.addEventListener('wheel', (e) => {
        const s = useGameStore.getState();
        if (s.phase !== 'PLAYING' || s.isGameMenuOpen || s.isBuildMenuOpen || e.deltaY === 0) return;
        s.setCameraZoom(s.cameraZoom * (e.deltaY > 0 ? 1.08 : 1 / 1.08));
    }, { passive: true });

    // Losing focus (alt-tab, notification shade) must not leave keys stuck down
    window.addEventListener('blur', () => {
        MOVE_KEYS.forEach(k => { keys[k] = false; });
        keyboardState.diveKey = false;
        setInput({ x: 0, y: 0, dive: false });
        cancelThrowAim();
    });
}
