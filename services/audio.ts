// Simple audio synthesizer to avoid external assets
class AudioService {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private isMuted: boolean = false;

  constructor() {
    try {
      // @ts-ignore
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass();
      this.gainNode = this.ctx.createGain();
      this.gainNode.connect(this.ctx.destination);
      this.gainNode.gain.value = 0.3; // Master volume
    } catch (e) {
      console.error("Web Audio API not supported");
    }
  }

  public async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  public playChop() {
    if (!this.ctx || this.isMuted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    // Short, percussive "wood" sound
    osc.type = 'square';
    osc.frequency.setValueAtTime(100, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.05);
    
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.05);
  }

  public playChomp() {
    if (!this.ctx || this.isMuted) return;
    // Tree fall / Success sound
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, this.ctx.currentTime + 0.4);
    
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.4);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.4);
  }

  public playSplash() {
    if (!this.ctx || this.isMuted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    // White noise approximation for splash is hard with just oscillator, using low freq sine for "plop"
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(10, this.ctx.currentTime + 0.3);
    
    gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.3);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.3);
  }

  public playSuccess() {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    [440, 554, 659].forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.1, now + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.3);
      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.3);
    });
  }

  public playLevelUp() {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    
    // Ascending major arpeggio
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    
    notes.forEach((freq, i) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.1);
        
        gain.gain.setValueAtTime(0.1, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.4);
        
        osc.connect(gain);
        gain.connect(this.ctx!.destination);
        
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.4);
    });
  }

  public startMusic() {
    if (!this.ctx || this.isMuted) return;
    
    // Minimalist Bit Jazz Loop using oscillators
    // Simple walking bass + chord progression + swing
    
    // Bass line (walking)
    const bassNotes = [
        110, 130, 146, 155, // A2, C3, D3, Eb3
        164, 155, 146, 130, // E3, Eb3, D3, C3
        146, 174, 196, 207, // D3, F3, G3, Ab3
        220, 207, 196, 174  // A3, Ab3, G3, F3
    ];
    
    // Chord progression (Am7 -> Dm7 -> G7 -> Cmaj7)
    const chords = [
        [440, 523, 659, 783], // Am7
        [293, 349, 440, 523], // Dm7
        [392, 493, 587, 698], // G7
        [261, 329, 392, 493]  // Cmaj7
    ];
    
    let noteIndex = 0;
    
    // Play loop
    const playLoop = () => {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const tempo = 0.5; // seconds per beat
        
        // Swing factor: alternate between long and short beats
        const isOffBeat = noteIndex % 2 !== 0;
        const swingDelay = isOffBeat ? 0.05 : 0;
        
        // Bass Note
        const bassOsc = this.ctx.createOscillator();
        const bassGain = this.ctx.createGain();
        bassOsc.type = 'triangle';
        const bassFreq = bassNotes[noteIndex % bassNotes.length];
        bassOsc.frequency.value = bassFreq;
        bassGain.gain.setValueAtTime(0.12, now + swingDelay);
        bassGain.gain.exponentialRampToValueAtTime(0.01, now + swingDelay + tempo * 0.8);
        bassOsc.connect(bassGain);
        bassGain.connect(this.ctx.destination);
        bassOsc.start(now + swingDelay);
        bassOsc.stop(now + swingDelay + tempo);
        
        // Kick Drum (Low Beat) on 1 and 3
        if (noteIndex % 4 === 0 || noteIndex % 4 === 2) {
            const kickOsc = this.ctx.createOscillator();
            const kickGain = this.ctx.createGain();
            kickOsc.type = 'sine';
            kickOsc.frequency.setValueAtTime(150, now + swingDelay);
            kickOsc.frequency.exponentialRampToValueAtTime(0.01, now + swingDelay + 0.5);
            kickGain.gain.setValueAtTime(0.4, now + swingDelay);
            kickGain.gain.exponentialRampToValueAtTime(0.01, now + swingDelay + 0.5);
            kickOsc.connect(kickGain);
            kickGain.connect(this.ctx.destination);
            kickOsc.start(now + swingDelay);
            kickOsc.stop(now + swingDelay + 0.5);
        }
        
        // Chord Stab every 4 beats (on the 1)
        if (noteIndex % 4 === 0) {
            const chordIdx = Math.floor(noteIndex / 4) % chords.length;
            chords[chordIdx].forEach((freq, i) => {
                const osc = this.ctx!.createOscillator();
                const gain = this.ctx!.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;
                // Add some variation to chord voicing
                gain.gain.setValueAtTime(0.03 + Math.random() * 0.02, now + swingDelay);
                gain.gain.exponentialRampToValueAtTime(0.001, now + swingDelay + 1.2);
                osc.connect(gain);
                gain.connect(this.ctx!.destination);
                osc.start(now + swingDelay);
                osc.stop(now + swingDelay + 1.2);
            });
        }
        
        // Ride Cymbal (higher noise) every off-beat - Lower volume
        if (isOffBeat) {
             const osc = this.ctx.createOscillator();
             const gain = this.ctx.createGain();
             osc.type = 'square';
             osc.frequency.value = 8000 + Math.random() * 2000;
             gain.gain.setValueAtTime(0.01, now + swingDelay); // Lower volume
             gain.gain.exponentialRampToValueAtTime(0.001, now + swingDelay + 0.1);
             osc.connect(gain);
             gain.connect(this.ctx.destination);
             osc.start(now + swingDelay);
             osc.stop(now + swingDelay + 0.15);
        }

        // Expanded Melody
        // Pentatonic scale (C Major Pentatonic: C, D, E, G, A)
        const scale = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66];
        if (Math.random() > 0.6) { // More frequent
            const melOsc = this.ctx.createOscillator();
            const melGain = this.ctx.createGain();
            melOsc.type = 'sine';
            // Pick a note from scale
            const note = scale[Math.floor(Math.random() * scale.length)];
            melOsc.frequency.value = note;
            
            // Randomize timing slightly
            const timeOffset = tempo * (Math.random() > 0.5 ? 0.5 : 0.25);
            
            melGain.gain.setValueAtTime(0.04, now + swingDelay + timeOffset);
            melGain.gain.exponentialRampToValueAtTime(0.001, now + swingDelay + timeOffset + 0.4);
            
            melOsc.connect(melGain);
            melGain.connect(this.ctx.destination);
            melOsc.start(now + swingDelay + timeOffset);
            melOsc.stop(now + swingDelay + timeOffset + 0.4);
        }

        noteIndex++;
        setTimeout(playLoop, tempo * 1000);
    };
    
    playLoop();
  }
}

export const audioService = new AudioService();