/**
 * AudioManager — fully procedural Web Audio API sound engine.
 * Zero external files. All audio is synthesised at runtime.
 *
 * Background music is layered:
 *   1. Low drone (always on)
 *   2. War drums (combat-intensity driven)
 *   3. Dark string / brass chord progressions (combat-intensity driven)
 *
 * Sound effects: slash, hit, playerHit, grunt, enemyDeath, dodge, waveStart, playerDeath.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;

  // ── Master gain ─────────────────────────────────────────────────────────
  private masterGain: GainNode | null = null;

  // ── Drone layer ─────────────────────────────────────────────────────────
  private droneGain: GainNode | null = null;

  // ── Drum layer ──────────────────────────────────────────────────────────
  private drumInterval: ReturnType<typeof setInterval> | null = null;
  private drumBeat = 0;

  // ── Melodic layer ───────────────────────────────────────────────────────
  private chordOscs: OscillatorNode[] = [];
  private chordGain: GainNode | null = null;
  private chordFilter: BiquadFilterNode | null = null;
  private chordIndex = 0;
  private chordTimer = 0;
  private chordDuration = 3.0; // seconds between chord changes

  // A minor arp: Am, Dm, Em, Am (root frequencies in Hz)
  private readonly CHORD_ROOTS = [220, 146.83, 164.81, 220]; // A3, D3, E3, A3

  // ── Intensity tracking ──────────────────────────────────────────────────
  private intensity = 0; // 0.0 – 1.0
  private intensityDecayRate = 0.15; // per second
  private lastIntensityUpdate = 0;

  // Flag so we only start the audio context once a user gesture fires
  private started = false;

  // ── Unlock on first gesture ─────────────────────────────────────────────
  constructor() {
    const unlock = (): void => {
      this.ensureStarted();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Set the current combat intensity (0 = idle, 1 = full battle).
   * Call every game-loop frame.
   */
  setCombatIntensity(value: number): void {
    const now = performance.now() / 1000;
    const dt = Math.min(now - this.lastIntensityUpdate, 0.1);
    this.lastIntensityUpdate = now;

    if (value > this.intensity) {
      this.intensity = value; // instant jump up
    } else {
      this.intensity = Math.max(0, this.intensity - this.intensityDecayRate * dt);
    }

    this.applyIntensity(dt);
  }

  /** Short whooshing slash noise — call when player swings. */
  playSlash(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = 0.08;

    const buf = this.makeNoiseBuffer(ctx, dur);
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200 + (Math.random() - 0.5) * 400;
    bp.Q.value = 8;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    src.connect(bp).connect(gain).connect(this.masterGain!);
    src.start(t);
    src.stop(t + dur + 0.01);
  }

  /** Low grunt noise — call with every sword swing. */
  playGrunt(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = 0.06 + Math.random() * 0.02;

    const buf = this.makeNoiseBuffer(ctx, dur);
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 100 + Math.random() * 300;
    bp.Q.value = 3 + Math.random() * 4;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    src.connect(bp).connect(gain).connect(this.masterGain!);
    src.start(t);
    src.stop(t + dur + 0.01);
  }

  /** Metal clang + crunch — call when an enemy is hit. */
  playHit(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    this.metalClang(ctx, [520, 620, 780, 1040], 0.3, 0.5);
    // Crunch noise
    this.shortNoiseBurst(ctx, 800, 5, 0.2, 0.06);
  }

  /** Heavier clang — call when the player takes damage. */
  playPlayerHit(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    this.metalClang(ctx, [350, 420, 530, 700], 0.5, 0.65);
    // Low thud
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 50;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(g).connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  /** Bone crunch + descending tone — call on enemy death. */
  playEnemyDeath(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;
    // Bone crunch
    this.shortNoiseBurst(ctx, 800, 6, 0.45, 0.08);
    // Descending tone
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(g).connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  /** Quick whoosh — call when player dodges. */
  playDodge(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = 0.1;
    const buf = this.makeNoiseBuffer(ctx, dur);
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(500, t);
    hp.frequency.linearRampToValueAtTime(3000, t + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    src.connect(hp).connect(gain).connect(this.masterGain!);
    src.start(t);
    src.stop(t + dur + 0.01);
  }

  /** 3-note ascending brass fanfare — call when a wave starts. */
  playWaveStart(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const notes = [220, 261.63, 329.63]; // A3 → C4 → E4
    let t = ctx.currentTime + 0.05;
    for (const freq of notes) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.4, t + 0.02);
      g.gain.setValueAtTime(0.4, t + 0.13);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.frequency.value = freq;
      osc.connect(lp).connect(g).connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.22);
      t += 0.15;
    }
  }

  /** Dramatic death — music fades, deep descending tone. */
  playPlayerDeath(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Fade master out
    this.masterGain!.gain.setValueAtTime(this.masterGain!.gain.value, t);
    this.masterGain!.gain.linearRampToValueAtTime(0.05, t + 1.0);

    // Deep descending tone
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 1.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    // Simple delay feedback for reverb feel
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.18;
    const fbGain = ctx.createGain();
    fbGain.gain.value = 0.4;
    osc.connect(g).connect(this.masterGain!);
    osc.connect(delay);
    delay.connect(fbGain);
    fbGain.connect(delay);
    fbGain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 2.0);
  }

  /** Short ascending chime — call when a pickup is collected. */
  playPickup(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    // C5 → E5, 80 ms each
    const notes = [523.25, 659.25]; // C5, E5
    let t = ctx.currentTime + 0.01;
    for (const freq of notes) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      osc.connect(g).connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.1);
      t += 0.08;
    }
  }

  /** Shimmer sweep — call when a power-up is collected. */
  playPowerUp(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const dur = 0.3;

    // Sine sweep 400 Hz → 1200 Hz over 300 ms
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.setValueAtTime(0.3, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.15);

    // Reverb-like tail via short delay
    const delay = ctx.createDelay(0.3);
    delay.delayTime.value = 0.06;
    const fbGain = ctx.createGain();
    fbGain.gain.value = 0.35;
    osc.connect(g).connect(this.masterGain!);
    osc.connect(delay);
    delay.connect(fbGain);
    fbGain.connect(delay);
    fbGain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + dur + 0.3);
  }

  /**
   * Resume the AudioContext after a user gesture.
   * Call after the title screen is dismissed.
   */
  resume(): void {
    const ctx = this.ensureStarted();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => { /* ignore — browser may block in some environments */ });
    }
  }

  /**
   * Set the master output volume (0.0 – 1.0).
   * Exposed for the PauseMenu volume slider.
   */
  setMasterVolume(volume: number): void {
    const ctx = this.ensureStarted();
    if (!ctx || !this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, volume)),
      ctx.currentTime,
      0.05,
    );
  }

  /** Deep war horn blast — call when a new wave is announced. */
  playWaveAnnounce(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    const dur = 1.8;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, t);
    // Slight pitch bend up for drama
    osc.frequency.linearRampToValueAtTime(95, t + dur * 0.7);
    osc.frequency.linearRampToValueAtTime(75, t + dur);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.3);   // slow attack
    g.gain.setValueAtTime(0.55, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur); // long release

    osc.connect(lp).connect(g).connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + dur + 0.05);

    // Sub-layer: octave up for richness
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(160, t);
    osc2.frequency.linearRampToValueAtTime(190, t + dur * 0.7);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(0.18, t + 0.3);
    g2.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc2.connect(lp).connect(g2).connect(this.masterGain!);
    osc2.start(t);
    osc2.stop(t + dur + 0.05);
  }

  /** UI click — short high blip on pause. */
  playPause(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(g).connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  /** UI click — slightly lower pitch on unpause. */
  playUnpause(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(g).connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  /**
   * Dramatic death rumble — two layered triangle oscillators (30 Hz + 60 Hz).
   * Crescendo over 0.5 s, sustain 1 s, slow decay 1.5 s.
   */
  playDeathSequence(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;

    const makeLayer = (freq: number, vol: number): void => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.5);      // crescendo
      g.gain.setValueAtTime(vol, t + 1.5);               // sustain
      g.gain.exponentialRampToValueAtTime(0.001, t + 3.0); // slow decay
      osc.connect(g).connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 3.1);
    };

    makeLayer(30, 0.5);
    makeLayer(60, 0.25);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private ensureStarted(): AudioContext | null {
    if (this.started && this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.7;
      this.masterGain.connect(this.ctx.destination);
      this.startBackgroundMusic();
      this.started = true;
      this.lastIntensityUpdate = performance.now() / 1000;
    } catch {
      return null;
    }
    return this.ctx;
  }

  private startBackgroundMusic(): void {
    const ctx = this.ctx!;

    // ── 1. Low drone ──────────────────────────────────────────────────────
    const droneOsc = ctx.createOscillator();
    droneOsc.type = 'sawtooth';
    droneOsc.frequency.value = 55; // A1
    const droneLp = ctx.createBiquadFilter();
    droneLp.type = 'lowpass';
    droneLp.frequency.value = 200;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.06;
    droneOsc.connect(droneLp).connect(this.droneGain).connect(this.masterGain!);
    droneOsc.start();

    // ── 2. War drums (interval based) ─────────────────────────────────────
    this.startDrums(ctx);

    // ── 3. Melodic string/brass layer ─────────────────────────────────────
    this.chordFilter = ctx.createBiquadFilter();
    this.chordFilter.type = 'lowpass';
    this.chordFilter.frequency.value = 400;
    this.chordGain = ctx.createGain();
    this.chordGain.gain.value = 0;
    this.chordFilter.connect(this.chordGain).connect(this.masterGain!);
    this.buildChord(ctx, this.CHORD_ROOTS[0]!);
  }

  private startDrums(ctx: AudioContext): void {
    let tempo = 700; // ms between beats
    const fireDrum = (): void => {
      if (!this.ctx) return;
      // Kick on every beat
      this.kickDrum(ctx);
      // Snare on alternating beats
      if (this.drumBeat % 2 === 1) {
        this.snareDrum(ctx);
      }
      this.drumBeat++;
      // Reschedule with current tempo
      const newTempo = Math.max(300, 700 - Math.round(this.intensity * 400));
      if (newTempo !== tempo) {
        tempo = newTempo;
        if (this.drumInterval !== null) clearInterval(this.drumInterval);
        this.drumInterval = setInterval(fireDrum, tempo);
      }
    };
    this.drumInterval = setInterval(fireDrum, tempo);
  }

  private kickDrum(ctx: AudioContext): void {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.05);
    const g = ctx.createGain();
    const vol = 0.05 + this.intensity * 0.25;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(g).connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  private snareDrum(ctx: AudioContext): void {
    const t = ctx.currentTime;
    const buf = this.makeNoiseBuffer(ctx, 0.1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1000;
    bp.Q.value = 3;
    const g = ctx.createGain();
    const vol = 0.02 + this.intensity * 0.1;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    src.connect(bp).connect(g).connect(this.masterGain!);
    src.start(t);
    src.stop(t + 0.12);
  }

  private buildChord(ctx: AudioContext, rootHz: number): void {
    // Clear old oscillators — stop() throws if the oscillator already reached its stop time
    for (const o of this.chordOscs) {
      try { o.stop(); } catch (_e) { /* oscillator already stopped — safe to ignore */ }
    }
    this.chordOscs = [];
    // Minor triad: root, minor-third (+3 semitones), fifth (+7 semitones)
    const ratio = [1, 1.1892, 1.4983, 2.0];
    for (const r of ratio) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = rootHz * r + (Math.random() - 0.5) * 2;
      osc.connect(this.chordFilter!);
      osc.start();
      this.chordOscs.push(osc);
    }
    // Octave up for brass feel (very quiet)
    const brass = ctx.createOscillator();
    brass.type = 'sawtooth';
    brass.frequency.value = rootHz * 2.0;
    const brassGain = ctx.createGain();
    brassGain.gain.value = 0.25;
    brass.connect(brassGain).connect(this.chordFilter!);
    brass.start();
    this.chordOscs.push(brass);
  }

  private applyIntensity(dt: number): void {
    if (!this.ctx || !this.droneGain || !this.chordGain || !this.chordFilter) return;
    const t = this.ctx.currentTime;
    const i = this.intensity;

    // Drone always present, slightly stronger in combat
    this.droneGain.gain.setTargetAtTime(0.04 + i * 0.06, t, 0.5);

    // Melodic layer fades in above 0.3 intensity
    const chordVol = Math.max(0, (i - 0.3) / 0.7) * 0.18;
    this.chordGain.gain.setTargetAtTime(chordVol, t, 0.8);

    // Filter opens up with intensity (brighter at high intensity)
    const cutoff = 400 + i * 1600;
    this.chordFilter.frequency.setTargetAtTime(cutoff, t, 0.5);

    // Advance chord progression using actual delta time to avoid FPS-dependent drift
    if (i > 0.3) {
      this.chordTimer += dt;
      if (this.chordTimer >= this.chordDuration) {
        this.chordTimer = 0;
        this.chordIndex = (this.chordIndex + 1) % this.CHORD_ROOTS.length;
        this.buildChord(this.ctx, this.CHORD_ROOTS[this.chordIndex] ?? this.CHORD_ROOTS[0]!);
      }
    }
  }

  // ── Low-level helpers ─────────────────────────────────────────────────────

  private metalClang(
    ctx: AudioContext,
    freqs: number[],
    volume: number,
    decay: number,
  ): void {
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    g.connect(this.masterGain!);
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * (1 + (Math.random() - 0.5) * 0.04);
      osc.connect(g);
      osc.start(t);
      osc.stop(t + decay + 0.02);
    }
  }

  private shortNoiseBurst(
    ctx: AudioContext,
    centerHz: number,
    Q: number,
    volume: number,
    duration: number,
  ): void {
    const t = ctx.currentTime;
    const buf = this.makeNoiseBuffer(ctx, duration);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = centerHz;
    bp.Q.value = Q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(bp).connect(g).connect(this.masterGain!);
    src.start(t);
    src.stop(t + duration + 0.01);
  }

  /** Create a mono white-noise AudioBuffer of the given duration. */
  private makeNoiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.max(1, Math.ceil(sampleRate * duration));
    const buf = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frameCount; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }
}
