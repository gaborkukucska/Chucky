// Joint games: invite friends with a QR code. It holds a link to this game on the
// computer running it (its Wi-Fi address and port) plus the room code, e.g.
//   http://192.168.1.5:3000/?join=BARK-27
// Scanning it opens the game with the code filled in: pick a team, tap Join.
//
// The game server tells us its Wi-Fi address(es) at /api/lan (server/multiplayerServer.ts),
// because a page opened as http://localhost:3000 can't know it. If this page was itself
// opened through a network address, that address is used as is.

import React, { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';

const JOIN_PARAM = 'join';
const LAN_URL = '/api/lan';

const isLocalHost = (host: string) =>
    host === 'localhost' || host === '[::1]' || host.startsWith('127.') || host === '0.0.0.0';

/** A room code from an invite link (?join=BARK-27), or '' */
export const readJoinCode = () => {
    try {
        const raw = new URLSearchParams(window.location.search).get(JOIN_PARAM) || '';
        return raw.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
    } catch {
        return '';
    }
};

/** Take ?join=... off the address bar (once it's been used), so a reload doesn't reopen it */
export const clearJoinCode = () => {
    try {
        const url = new URL(window.location.href);
        if (!url.searchParams.has(JOIN_PARAM)) return;
        url.searchParams.delete(JOIN_PARAM);
        window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch { /* ignore */ }
};

// The server's Wi-Fi address(es), fetched once
let lanRequest: Promise<{ addresses: string[]; port: number } | null> | null = null;
const fetchLan = () => {
    if (!lanRequest) {
        lanRequest = fetch(LAN_URL, { cache: 'no-store' })
            .then(res => (res.ok ? res.json() : null))
            .then(data => (data && Array.isArray(data.addresses) ? { addresses: data.addresses.map(String), port: Number(data.port) || 0 } : null))
            .catch(() => null);
    }
    return lanRequest;
};

/** The QR code as one SVG path (dark squares), with the quiet margin scanners need */
const QrSvg = ({ text, size }: { text: string; size: number }) => {
    const { path, count } = useMemo(() => {
        const qr = qrcode(0, 'M'); // Smallest version that fits, medium error correction
        qr.addData(text);
        qr.make();
        const n = qr.getModuleCount();
        let d = '';
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
            }
        }
        return { path: d, count: n + 8 };
    }, [text]);
    return (
        <svg width={size} height={size} viewBox={`0 0 ${count} ${count}`} shapeRendering="crispEdges" role="img" aria-label="Invite QR code">
            <rect width={count} height={count} fill="#ffffff" />
            <path d={path} fill="#000000" />
        </svg>
    );
};

export const InviteQR = ({ code }: { code: string }) => {
    const { protocol, hostname, host } = window.location;
    const local = isLocalHost(hostname);
    const [lan, setLan] = useState<{ addresses: string[]; port: number } | null>(null);
    const [loading, setLoading] = useState(local);
    const [pick, setPick] = useState(0);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!local) return;
        let alive = true;
        fetchLan().then((data) => {
            if (!alive) return;
            setLan(data);
            setLoading(false);
        });
        return () => { alive = false; };
    }, [local]);

    // Opened through a network address already: that's the one others can use too
    const hosts = local
        ? (lan?.addresses ?? []).map(a => `${a}:${lan?.port || window.location.port}`)
        : [host];
    const chosen = hosts[Math.min(pick, hosts.length - 1)];
    const link = chosen ? `${protocol}//${chosen}/?${JOIN_PARAM}=${encodeURIComponent(code)}` : '';

    const share = async () => {
        if (!link) return;
        try {
            if (navigator.share) {
                await navigator.share({ title: 'Chucky the Woodchuck', text: `Join my game ${code}!`, url: link });
                return;
            }
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { /* cancelled, or no clipboard on plain http: the link is shown to copy by hand */ }
    };

    return (
        <div className="bg-white/5 border border-white/10 rounded-xl p-3 mb-3 flex flex-col items-center text-center">
            <div className="text-[10px] uppercase tracking-wider text-white/50 font-bold mb-2">📱 Invite friends on this Wi-Fi</div>
            {loading && <div className="text-xs text-white/60 py-8">Finding this computer's Wi-Fi address…</div>}
            {!loading && !link && (
                <div className="text-xs text-white/60 py-3">
                    Couldn't find a Wi-Fi address for this computer. Friends can open the <b>Network</b> address the server printed and join with the code <b className="text-white">{code}</b>.
                </div>
            )}
            {!loading && link && (
                <>
                    <div className="rounded-lg overflow-hidden shadow-lg">
                        <QrSvg text={link} size={184} />
                    </div>
                    <p className="text-[11px] text-white/70 mt-2">Scan with a phone camera to join <b className="text-white">{code}</b></p>
                    <div className="select-text text-[10px] font-mono text-sky-200 break-all mt-1">{link}</div>
                    {hosts.length > 1 && (
                        <div className="flex flex-wrap justify-center gap-1 mt-2">
                            {hosts.map((h, i) => (
                                <button
                                    key={h}
                                    onClick={() => setPick(i)}
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${i === pick ? 'bg-sky-500/30 border-sky-300 text-white' : 'bg-white/5 border-white/15 text-white/60'}`}
                                >
                                    {h}
                                </button>
                            ))}
                        </div>
                    )}
                    {hosts.length > 1 && <p className="text-[9px] text-white/40 mt-1">More than one network: pick the one your friends' phones are on.</p>}
                    <button
                        onClick={share}
                        className="mt-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 text-[11px] font-bold"
                    >
                        {copied ? '✓ Link copied' : '🔗 Share link'}
                    </button>
                </>
            )}
        </div>
    );
};
