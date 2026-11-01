// Developer menu: switch power-ups and magic on/off and spawn things to test them.
// It only exists with `npm run dev` (Vite mode "devtools", see package.json): App.tsx renders
// it behind a compile-time check, so `npm start` and production builds don't include it.

import React, { useEffect, useState } from 'react';
import { useGameStore, MAGIC_INFO, DevPowerup, DevAction } from '../store';
import { currentWoodchuckPos } from '../globals';
import type { MagicType } from '../types';

const POWERUPS: { kind: 'tree' | 'log' | 'speed'; icon: string; label: string }[] = [
    { kind: 'tree', icon: '🪓', label: 'Mega Chomp' },
    { kind: 'log', icon: '🧲', label: 'Magnet' },
    { kind: 'speed', icon: '⚡', label: 'Zoomies' },
];
const MAGIC: MagicType[] = ['shield', 'triple', 'bubble', 'double'];
const HELPERS: { action: DevAction; label: string; soloOnly?: boolean }[] = [
    { action: 'magic', label: '🎁 Drop magic item' },
    { action: 'piranha', label: '🐟 Piranha here' },
    { action: 'wolf', label: '🐺 Wolf' },  // They only stay at night: a solo game jumps to night
    { action: 'bear', label: '🐻 Bear' },
    { action: 'wood', label: '🪵 +50 logs' },
    { action: 'heal', label: '❤️ Full health' },
    { action: 'night', label: '🌙 Night', soloOnly: true }, // A joint game's clock comes from the room
    { action: 'day', label: '☀️ Day', soloOnly: true },
];

const secs = (end: number) => Math.max(0, Math.ceil((end - Date.now()) / 1000));

export const DevPanel = () => {
    const [open, setOpen] = useState(false);
    const [, setTick] = useState(0);
    // Only what the panel shows (the clock changes every frame - don't re-render for that)
    const inJointGame = useGameStore(state => state.mp.status !== 'off');
    const magic = useGameStore(state => state.magic);
    const treeEnd = useGameStore(state => (state.isTreePowerupActive ? state.treePowerupEndTime : 0));
    const logEnd = useGameStore(state => (state.isLogPowerupActive ? state.logPowerupEndTime : 0));
    const speedEnd = useGameStore(state => (state.isSpeedPowerupActive ? state.speedPowerupEndTime : 0));

    // Keep the countdowns ticking while the panel is open
    useEffect(() => {
        if (!open) return;
        const interval = setInterval(() => setTick(t => t + 1), 250);
        return () => clearInterval(interval);
    }, [open]);

    const now = Date.now();
    const powerupEnd: Record<'tree' | 'log' | 'speed', number> = { tree: treeEnd, log: logEnd, speed: speedEnd };
    const toggle = (kind: DevPowerup, end: number) => useGameStore.getState().devPowerup(kind, !(end > now));
    const act = (action: DevAction) =>
        useGameStore.getState().devAction(action, [currentWoodchuckPos.x, currentWoodchuckPos.y, currentWoodchuckPos.z]);

    const row = (key: string, icon: string, label: string, end: number, onClick: () => void) => {
        const on = end > now;
        return (
            <button
                key={key}
                onClick={onClick}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[11px] font-bold text-left transition-colors
                    ${on ? 'bg-fuchsia-600/40 border-fuchsia-300 text-white' : 'bg-white/5 border-white/10 text-white/80 hover:bg-white/10'}`}
            >
                <span className="text-sm">{icon}</span>
                <span className="flex-1">{label}</span>
                <span className="font-mono text-[10px]">{on ? `${secs(end)}s` : 'off'}</span>
            </button>
        );
    };

    return (
        <>
            <button
                onClick={() => setOpen(o => !o)}
                className={`fixed left-2 top-[42%] z-50 w-9 h-9 rounded-lg border-2 border-dashed flex items-center justify-center shadow-lg active:scale-90 transition-all
                    ${open ? 'bg-fuchsia-700/80 border-fuchsia-200' : 'bg-black/60 border-fuchsia-400/80'}`}
                aria-label="Dev power-up menu"
                title="Dev power-up menu (npm run dev only)"
            >
                <span className="text-base">🛠️</span>
            </button>

            {open && (
                <div className="fixed left-12 top-1/2 -translate-y-1/2 z-[55] w-56 max-h-[75vh] overflow-y-auto bg-black/80 backdrop-blur-md text-white rounded-xl border border-fuchsia-400/60 shadow-2xl p-2.5 space-y-2">
                    <div className="flex items-center">
                        <div className="flex-1">
                            <div className="text-xs font-black tracking-tight">🛠️ Dev power-ups</div>
                            <div className="text-[9px] text-white/50">npm run dev only · tap to switch on/off</div>
                        </div>
                        <button onClick={() => setOpen(false)} className="w-6 h-6 rounded-md bg-white/10 text-xs" aria-label="Close dev menu">✕</button>
                    </div>

                    <div>
                        <div className="text-[9px] uppercase tracking-wider text-white/50 font-bold mb-1">Power-ups</div>
                        <div className="space-y-1">
                            {POWERUPS.map(p => row(p.kind, p.icon, p.label, powerupEnd[p.kind], () => toggle(p.kind, powerupEnd[p.kind])))}
                        </div>
                    </div>

                    <div>
                        <div className="text-[9px] uppercase tracking-wider text-white/50 font-bold mb-1">Magic</div>
                        <div className="space-y-1">
                            {MAGIC.map(t => row(t, MAGIC_INFO[t].icon, MAGIC_INFO[t].label, magic[t], () => toggle(t, magic[t])))}
                        </div>
                    </div>

                    <div>
                        <div className="text-[9px] uppercase tracking-wider text-white/50 font-bold mb-1">Test helpers</div>
                        <div className="grid grid-cols-2 gap-1">
                            {HELPERS.filter(h => !(h.soloOnly && inJointGame)).map(h => (
                                <button
                                    key={h.action}
                                    onClick={() => act(h.action)}
                                    className="px-1.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 active:bg-white/20 border border-white/10 text-[10px] font-bold text-white/85"
                                >
                                    {h.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
