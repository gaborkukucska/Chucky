// Synthesized audio (no external assets), mixed on three channels that can be
// muted separately from the Settings menu:
//
//   music        - the bit-jazz loop
//   environment  - ambience: river (louder near the water, muffled under it),
//                  a little wind, birds by day, crickets at night
//   sfx          - chomps, pickups, level-ups, placement splash
//
// Everything is routed channel bus -> master -> speakers. A muted channel also
// stops scheduling new sounds, so it costs no CPU. Nothing is scheduled while
// the AudioContext isn't running (before the first tap, or while the tab is
// hidden), so sounds can't pile up and burst out on resume.

export type AudioChannel = 'music' | 'environment' | 'sfx';
export type AudioSettings = Record<AudioChannel, boolean>;

export interface EnvironmentState {
    riverDistance: number;   // Metres from Chucky to the river's edge (0 = in the water)
    isNight: boolean;
    isUnderwater: boolean;
}

const MASTER_VOLUME = 1.0;   // Individual sounds carry their own levels (unchanged from before)
const FADE_TIME = 0.15;      // s - channel mute / unmute fade
const RIVER_HEAR_DISTANCE = 35;
const RIVER_MIN_GAIN = 0.015;
const RIVER_MAX_GAIN = 0.2;
const WIND_GAIN = 0.012;
const RIVER_CUTOFF = 900;    // Hz
const UNDERWATER_CUTOFF = 320;

class AudioService {
    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private buses: Partial<Record<AudioChannel, GainNode>> = {};
    private settings: AudioSettings = { music: true, environment: true, sfx: true };
    private unlocked = false;

    // Music
    private musicWanted = false;   // startMusic() was called (after the first tap)
    private musicTimer: ReturnType<typeof setTimeout> | null = null;
    private noteIndex = 0;

    // Environment
    private noiseBuffer: AudioBuffer | null = null;
    private noiseSource: AudioBufferSourceNode | null = null;
    private riverFilter: BiquadFilterNode | null = null;
    private riverGain: GainNode | null = null;
    private windGain: GainNode | null = null;
    private birdTimer: ReturnType<typeof setTimeout> | null = null;
    private cricketTimer: ReturnType<typeof setTimeout> | null = null;
    private env: EnvironmentState = { riverDistance: 100, isNight: false, isUnderwater: false };

    constructor() {
        try {
            // @ts-ignore - webkit prefix for older Safari
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContextClass();
            this.master = this.ctx.createGain();
            this.master.gain.value = MASTER_VOLUME;
            this.master.connect(this.ctx.destination);
            (['music', 'environment', 'sfx'] as AudioChannel[]).forEach(ch => {
                const bus = this.ctx!.createGain();
                bus.gain.value = this.settings[ch] ? 1 : 0;
                bus.connect(this.master!);
                this.buses[ch] = bus;
            });
        } catch (e) {
            console.error('Web Audio API not supported');
            this.ctx = null;
        }

        // Pause all audio while the tab/app is in the background (saves battery on phones)
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (!this.ctx || !this.unlocked) return;
                if (document.hidden) {
                    this.ctx.suspend().catch(() => { /* ignore */ });
                } else {
                    this.ctx.resume().then(() => this.restartSchedulers()).catch(() => { /* ignore */ });
                }
            });
        }
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    /** Call from a user gesture (tap / click / key). Safe to call repeatedly. */
    public async resume() {
        if (!this.ctx) return;
        this.unlocked = true;
        if (this.ctx.state === 'suspended' && !document.hidden) {
            try { await this.ctx.resume(); } catch { /* ignore */ }
        }
        this.restartSchedulers();
    }

    private get running() {
        return !!this.ctx && this.ctx.state === 'running';
    }

    private restartSchedulers() {
        if (!this.running) return;
        if (this.settings.music && this.musicWanted && !this.musicTimer) this.musicLoop();
        if (this.settings.environment) this.startEnvironment();
    }

    // ------------------------------------------------------------------
    // Settings
    // ------------------------------------------------------------------

    public getSettings(): AudioSettings {
        return { ...this.settings };
    }

    public applySettings(settings: AudioSettings) {
        (Object.keys(this.settings) as AudioChannel[]).forEach(ch => this.setChannelEnabled(ch, settings[ch]));
    }

    public setChannelEnabled(channel: AudioChannel, enabled: boolean) {
        this.settings[channel] = enabled;
        const bus = this.buses[channel];
        if (this.ctx && bus) {
            const now = this.ctx.currentTime;
            bus.gain.cancelScheduledValues(now);
            bus.gain.setValueAtTime(bus.gain.value, now);
            bus.gain.linearRampToValueAtTime(enabled ? 1 : 0, now + FADE_TIME);
        }
        if (channel === 'music') {
            if (enabled) {
                if (this.running && this.musicWanted && !this.musicTimer) this.musicLoop();
            } else if (this.musicTimer) {
                clearTimeout(this.musicTimer);
                this.musicTimer = null;
            }
        }
        if (channel === 'environment') {
            if (enabled) {
                if (this.running) this.startEnvironment();
            } else {
                // Let the fade finish, then stop the noise source and the schedulers
                setTimeout(() => { if (!this.settings.environment) this.stopEnvironment(); }, FADE_TIME * 1000 + 50);
            }
        }
    }

    // ------------------------------------------------------------------
    // Sound effects
    // ------------------------------------------------------------------

    private sfxReady() {
        return this.running && this.settings.sfx && !!this.buses.sfx;
    }

    public playChop() {
        if (!this.sfxReady()) return;
        const ctx = this.ctx!;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        // Short, percussive "wood" sound
        osc.type = 'square';
        osc.frequency.setValueAtTime(100, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.05);

        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);

        osc.connect(gain);
        gain.connect(this.buses.sfx!);

        osc.start();
        osc.stop(ctx.currentTime + 0.05);
    }

    public playChomp() {
        if (!this.sfxReady()) return;
        const ctx = this.ctx!;
        // Tree fall / success sound
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.4);

        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

        osc.connect(gain);
        gain.connect(this.buses.sfx!);

        osc.start();
        osc.stop(ctx.currentTime + 0.4);
    }

    public playSplash() {
        if (!this.sfxReady()) return;
        const ctx = this.ctx!;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        // Low "plop"
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(10, ctx.currentTime + 0.3);

        gain.gain.setValueAtTime(0.5, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);

        osc.connect(gain);
        gain.connect(this.buses.sfx!);

        osc.start();
        osc.stop(ctx.currentTime + 0.3);
    }

    public playSuccess() {
        if (!this.sfxReady()) return;
        const ctx = this.ctx!;
        const now = ctx.currentTime;
        [440, 554, 659].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.1, now + i * 0.1);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.3);
            osc.connect(gain);
            gain.connect(this.buses.sfx!);
            osc.start(now + i * 0.1);
            osc.stop(now + i * 0.1 + 0.3);
        });
    }

    public playLevelUp() {
        if (!this.sfxReady()) return;
        const ctx = this.ctx!;
        const now = ctx.currentTime;

        // Ascending major arpeggio: C5, E5, G5, C6
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + i * 0.1);
            gain.gain.setValueAtTime(0.1, now + i * 0.1);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.4);
            osc.connect(gain);
            gain.connect(this.buses.sfx!);
            osc.start(now + i * 0.1);
            osc.stop(now + i * 0.1 + 0.4);
        });
    }

    /** Whoosh of a thrown log */
    public playThrow() {
        if (!this.sfxReady()) return;
        const ctx = this.ctx!;
        const buffer = this.getNoiseBuffer();
        if (!buffer) return;
        const now = ctx.currentTime;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = 1.2;
        filter.frequency.setValueAtTime(1400, now);
        filter.frequency.exponentialRampToValueAtTime(350, now + 0.25);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.6, now + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
        source.connect(filter).connect(gain).connect(this.buses.sfx!);
        source.start(now, Math.random() * 1.5);
        source.stop(now + 0.3);
    }

    /** Thud of a thrown log hitting something */
    public playHit() {
        if (!this.sfxReady()) return;
        const ctx = this.ctx!;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(45, now + 0.15);
        gain.gain.setValueAtTime(0.45, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(gain);
        gain.connect(this.buses.sfx!);
        osc.start(now);
        osc.stop(now + 0.2);
    }

    // ------------------------------------------------------------------
    // Music - minimalist bit-jazz loop (walking bass, chords, swing)
    // ------------------------------------------------------------------

    /** Starts the loop (once). Muted music doesn't play until it's switched back on. */
    public startMusic() {
        this.musicWanted = true;
        if (this.running && this.settings.music && !this.musicTimer) this.musicLoop();
    }

    private musicLoop = () => {
        this.musicTimer = null;
        if (!this.ctx || !this.settings.music) return;
        const tempo = 0.5; // seconds per beat
        // Only schedule while the context runs; the visibility handler restarts the loop
        if (!this.running) return;

        const ctx = this.ctx;
        const out = this.buses.music!;
        const now = ctx.currentTime;

        // Bass line (walking): A2 C3 D3 Eb3 | E3 Eb3 D3 C3 | D3 F3 G3 Ab3 | A3 Ab3 G3 F3
        const bassNotes = [110, 130, 146, 155, 164, 155, 146, 130, 146, 174, 196, 207, 220, 207, 196, 174];
        // Chord progression: Am7 -> Dm7 -> G7 -> Cmaj7
        const chords = [
            [440, 523, 659, 783],
            [293, 349, 440, 523],
            [392, 493, 587, 698],
            [261, 329, 392, 493],
        ];
        const noteIndex = this.noteIndex;

        // Swing: alternate long and short beats
        const isOffBeat = noteIndex % 2 !== 0;
        const swingDelay = isOffBeat ? 0.05 : 0;

        // Bass note
        const bassOsc = ctx.createOscillator();
        const bassGain = ctx.createGain();
        bassOsc.type = 'triangle';
        bassOsc.frequency.value = bassNotes[noteIndex % bassNotes.length];
        bassGain.gain.setValueAtTime(0.12, now + swingDelay);
        bassGain.gain.exponentialRampToValueAtTime(0.01, now + swingDelay + tempo * 0.8);
        bassOsc.connect(bassGain);
        bassGain.connect(out);
        bassOsc.start(now + swingDelay);
        bassOsc.stop(now + swingDelay + tempo);

        // Kick drum on 1 and 3
        if (noteIndex % 4 === 0 || noteIndex % 4 === 2) {
            const kickOsc = ctx.createOscillator();
            const kickGain = ctx.createGain();
            kickOsc.type = 'sine';
            kickOsc.frequency.setValueAtTime(150, now + swingDelay);
            kickOsc.frequency.exponentialRampToValueAtTime(0.01, now + swingDelay + 0.5);
            kickGain.gain.setValueAtTime(0.4, now + swingDelay);
            kickGain.gain.exponentialRampToValueAtTime(0.01, now + swingDelay + 0.5);
            kickOsc.connect(kickGain);
            kickGain.connect(out);
            kickOsc.start(now + swingDelay);
            kickOsc.stop(now + swingDelay + 0.5);
        }

        // Chord stab every 4 beats (on the 1)
        if (noteIndex % 4 === 0) {
            const chordIdx = Math.floor(noteIndex / 4) % chords.length;
            chords[chordIdx].forEach((freq) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.03 + Math.random() * 0.02, now + swingDelay);
                gain.gain.exponentialRampToValueAtTime(0.001, now + swingDelay + 1.2);
                osc.connect(gain);
                gain.connect(out);
                osc.start(now + swingDelay);
                osc.stop(now + swingDelay + 1.2);
            });
        }

        // Ride cymbal on the off-beats (quiet)
        if (isOffBeat) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.value = 8000 + Math.random() * 2000;
            gain.gain.setValueAtTime(0.01, now + swingDelay);
            gain.gain.exponentialRampToValueAtTime(0.001, now + swingDelay + 0.1);
            osc.connect(gain);
            gain.connect(out);
            osc.start(now + swingDelay);
            osc.stop(now + swingDelay + 0.15);
        }

        // Melody from the C major pentatonic scale
        const scale = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66];
        if (Math.random() > 0.6) {
            const melOsc = ctx.createOscillator();
            const melGain = ctx.createGain();
            melOsc.type = 'sine';
            melOsc.frequency.value = scale[Math.floor(Math.random() * scale.length)];
            const timeOffset = tempo * (Math.random() > 0.5 ? 0.5 : 0.25);
            melGain.gain.setValueAtTime(0.04, now + swingDelay + timeOffset);
            melGain.gain.exponentialRampToValueAtTime(0.001, now + swingDelay + timeOffset + 0.4);
            melOsc.connect(melGain);
            melGain.connect(out);
            melOsc.start(now + swingDelay + timeOffset);
            melOsc.stop(now + swingDelay + timeOffset + 0.4);
        }

        this.noteIndex++;
        this.musicTimer = setTimeout(this.musicLoop, tempo * 1000);
    };

    // ------------------------------------------------------------------
    // Environment - river, wind, birds (day), crickets (night)
    // ------------------------------------------------------------------

    /** Called a few times per second by the game with Chucky's surroundings. */
    public updateEnvironment(state: EnvironmentState) {
        this.env = state;
        if (!this.ctx || !this.riverGain || !this.riverFilter || !this.windGain) return;
        const now = this.ctx.currentTime;
        const near = Math.max(0, Math.min(1, 1 - state.riverDistance / RIVER_HEAR_DISTANCE));
        const riverTarget = state.isUnderwater ? RIVER_MAX_GAIN * 1.2 : RIVER_MIN_GAIN + (RIVER_MAX_GAIN - RIVER_MIN_GAIN) * near * near;
        this.riverGain.gain.setTargetAtTime(riverTarget, now, 0.4);
        this.riverFilter.frequency.setTargetAtTime(state.isUnderwater ? UNDERWATER_CUTOFF : RIVER_CUTOFF, now, 0.15);
        // Gusty wind: slow wobble, quieter under water
        const gust = 0.6 + 0.4 * Math.sin(now * 0.37) * Math.sin(now * 0.13 + 1);
        this.windGain.gain.setTargetAtTime(state.isUnderwater ? 0 : WIND_GAIN * gust, now, 0.8);
    }

    private getNoiseBuffer() {
        if (this.noiseBuffer || !this.ctx) return this.noiseBuffer;
        // 2 s of brown-ish noise (integrated white noise) - a soft, rushing water sound
        const length = this.ctx.sampleRate * 2;
        const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let last = 0;
        for (let i = 0; i < length; i++) {
            const white = Math.random() * 2 - 1;
            last = (last + 0.02 * white) / 1.02;
            data[i] = last * 3.5;
        }
        // Cross-fade the ends so the loop has no click
        const fade = Math.floor(this.ctx.sampleRate * 0.05);
        for (let i = 0; i < fade; i++) {
            const t = i / fade;
            data[length - fade + i] = data[length - fade + i] * (1 - t) + data[i] * t;
        }
        this.noiseBuffer = buffer;
        return buffer;
    }

    private startEnvironment() {
        if (!this.running || !this.settings.environment) return;
        const ctx = this.ctx!;
        const out = this.buses.environment!;

        if (!this.noiseSource) {
            const buffer = this.getNoiseBuffer();
            if (!buffer) return;
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.loop = true;

            // River: low-passed noise (muffled further under water)
            const riverFilter = ctx.createBiquadFilter();
            riverFilter.type = 'lowpass';
            riverFilter.frequency.value = RIVER_CUTOFF;
            riverFilter.Q.value = 0.5;
            const riverGain = ctx.createGain();
            riverGain.gain.value = RIVER_MIN_GAIN;
            source.connect(riverFilter).connect(riverGain).connect(out);

            // Wind: band-passed noise
            const windFilter = ctx.createBiquadFilter();
            windFilter.type = 'bandpass';
            windFilter.frequency.value = 420;
            windFilter.Q.value = 0.7;
            const windGain = ctx.createGain();
            windGain.gain.value = WIND_GAIN;
            source.connect(windFilter).connect(windGain).connect(out);

            source.start();
            this.noiseSource = source;
            this.riverFilter = riverFilter;
            this.riverGain = riverGain;
            this.windGain = windGain;
            this.updateEnvironment(this.env);
        }
        if (!this.birdTimer) this.birdTimer = setTimeout(this.birdLoop, 1000 + Math.random() * 2000);
        if (!this.cricketTimer) this.cricketTimer = setTimeout(this.cricketLoop, 800 + Math.random() * 1200);
    }

    private stopEnvironment() {
        if (this.birdTimer) clearTimeout(this.birdTimer);
        if (this.cricketTimer) clearTimeout(this.cricketTimer);
        this.birdTimer = null;
        this.cricketTimer = null;
        if (this.noiseSource) {
            try { this.noiseSource.stop(); } catch { /* ignore */ }
            this.noiseSource.disconnect();
        }
        this.riverGain?.disconnect();
        this.windGain?.disconnect();
        this.noiseSource = null;
        this.riverFilter = null;
        this.riverGain = null;
        this.windGain = null;
    }

    private envReady() {
        return this.running && this.settings.environment && !!this.buses.environment;
    }

    private birdLoop = () => {
        this.birdTimer = null;
        if (!this.settings.environment) return;
        if (this.envReady() && !this.env.isNight && !this.env.isUnderwater) {
            const ctx = this.ctx!;
            const out = this.buses.environment!;
            const now = ctx.currentTime;
            const base = 2400 + Math.random() * 1800;
            const notes = 2 + Math.floor(Math.random() * 4);
            const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
            if (pan) {
                pan.pan.value = Math.random() * 1.6 - 0.8;
                pan.connect(out);
            }
            for (let i = 0; i < notes; i++) {
                const t = now + i * (0.09 + Math.random() * 0.05);
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                const f = base * (0.9 + Math.random() * 0.25);
                osc.frequency.setValueAtTime(f, t);
                osc.frequency.exponentialRampToValueAtTime(f * (Math.random() > 0.5 ? 1.25 : 0.8), t + 0.07);
                gain.gain.setValueAtTime(0.0001, t);
                gain.gain.exponentialRampToValueAtTime(0.025, t + 0.015);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
                osc.connect(gain);
                gain.connect(pan || out);
                osc.start(t);
                osc.stop(t + 0.09);
            }
        }
        this.birdTimer = setTimeout(this.birdLoop, 1500 + Math.random() * 4500);
    };

    private cricketLoop = () => {
        this.cricketTimer = null;
        if (!this.settings.environment) return;
        if (this.envReady() && this.env.isNight && !this.env.isUnderwater) {
            const ctx = this.ctx!;
            const out = this.buses.environment!;
            const now = ctx.currentTime;
            const f = 4300 + Math.random() * 500;
            const pulses = 3 + Math.floor(Math.random() * 4);
            for (let i = 0; i < pulses; i++) {
                const t = now + i * 0.075;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = f;
                gain.gain.setValueAtTime(0.0001, t);
                gain.gain.exponentialRampToValueAtTime(0.012, t + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
                osc.connect(gain);
                gain.connect(out);
                osc.start(t);
                osc.stop(t + 0.05);
            }
        }
        this.cricketTimer = setTimeout(this.cricketLoop, 700 + Math.random() * 1600);
    };
}

export const audioService = new AudioService();
