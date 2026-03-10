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

  // ── Phase 3 sound effects ─────────────────────────────────────────────────

  /** Spike trap activation — metallic grinding noise + low triangle. */
  playSpikeTrap(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = 0.3;

    // Metallic scraping — noise through bandpass at 400 Hz
    const buf = this.makeNoiseBuffer(ctx, dur);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 400;
    bp.Q.value = 5;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.3, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp).connect(ng).connect(this.masterGain!);
    src.start(t);
    src.stop(t + dur + 0.01);

    // Low triangle at 80 Hz
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 80;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.18, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(og).connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  }

  /** Fire pillar jet — filtered noise highpass 800 Hz, 2s with crackling. */
  playFireJet(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = 2.0;

    const buf = this.makeNoiseBuffer(ctx, dur);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 800;
    const g = ctx.createGain();
    // Amplitude ramp: quiet → loud → fade
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.3);
    g.gain.setValueAtTime(0.22, t + 1.5);
    g.gain.linearRampToValueAtTime(0.001, t + dur);
    src.connect(hp).connect(g).connect(this.masterGain!);
    src.start(t);
    src.stop(t + dur + 0.01);

    // Crackling overlay — short noise bursts at random intervals
    for (let i = 0; i < 8; i++) {
      const ot = t + Math.random() * dur;
      this.shortNoiseBurst(ctx, 2000 + Math.random() * 2000, 3, 0.08, 0.05);
      void ot; // suppress lint warning — shortNoiseBurst uses ctx.currentTime internally
    }
  }

  /** Thunder rumble — 40 Hz triangle slow attack + noise crackle. */
  playThunder(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Deep 40 Hz rumble
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 40;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.5);    // slow attack
    g.gain.setValueAtTime(0.35, t + 1.0);
    g.gain.exponentialRampToValueAtTime(0.001, t + 4.0); // long release
    osc.connect(g).connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 4.1);

    // Noise crackle layer
    const nbuf = this.makeNoiseBuffer(ctx, 0.8);
    const nsrc = ctx.createBufferSource();
    nsrc.buffer = nbuf;
    const nlp = ctx.createBiquadFilter();
    nlp.type = 'lowpass';
    nlp.frequency.value = 400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.2, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    nsrc.connect(nlp).connect(ng).connect(this.masterGain!);
    nsrc.start(t + 0.3);
    nsrc.stop(t + 1.2);
  }

  // ── Gore & Dismemberment sounds ───────────────────────────────────────────

  /**
   * Wet bone-crack + flesh-tear sound for dismemberment.
   * Layers: noise burst (bone crack) + low thud + filtered noise (wet squelch).
   */
  playDismember(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Bone crack — sharp high-freq noise burst
    this.shortNoiseBurst(ctx, 2200, 3, 0.35, 0.06);

    // Low thud (impact body)
    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(80, t);
    thud.frequency.exponentialRampToValueAtTime(30, t + 0.12);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.4, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    thud.connect(tg).connect(this.masterGain!);
    thud.start(t);
    thud.stop(t + 0.18);

    // Wet squelch — low-freq filtered noise
    this.shortNoiseBurst(ctx, 300, 4, 0.28, 0.12);
  }

  /**
   * Arterial spray hissing sound — directional pressurised fluid sound.
   */
  playArterialSpray(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = 0.35;

    const buf = this.makeNoiseBuffer(ctx, dur);
    const src = ctx.createBufferSource();
    src.buffer = buf;

    // Band-pass filter for hissing quality
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1800, t);
    bp.frequency.linearRampToValueAtTime(800, t + dur); // drops in pitch as pressure falls
    bp.Q.value = 2.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    src.connect(bp).connect(gain).connect(this.masterGain!);
    src.start(t);
    src.stop(t + dur + 0.01);
  }

  /**
   * Wet splat impact — called when gore chunks hit the ground.
   */
  playGoreChunk(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;

    // Very short wet impact: lowpass-filtered noise burst
    this.shortNoiseBurst(ctx, 250, 3, 0.18, 0.05);
  }

  /**
   * Sharp skull crack + wet separation — for head dismemberment.
   */
  playHeadSplit(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Sharp crack at high frequency
    this.shortNoiseBurst(ctx, 3500, 5, 0.4, 0.04);

    // Resonant crack tone (bone)
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(550, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(g).connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.15);

    // Wet separation — low filtered noise
    this.shortNoiseBurst(ctx, 400, 3.5, 0.22, 0.10);
  }

  /** Finisher execution impact — sub bass + metallic ring + noise burst. */
  playFinisher(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;

    // 40 Hz sub sine (0.2s)
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 40;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.5, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    sub.connect(sg).connect(this.masterGain!);
    sub.start(t);
    sub.stop(t + 0.22);

    // Metallic ring — 800 Hz sine decaying over 0.5s
    const ring = ctx.createOscillator();
    ring.type = 'sine';
    ring.frequency.value = 800;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.3, t);
    rg.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    ring.connect(rg).connect(this.masterGain!);
    ring.start(t);
    ring.stop(t + 0.52);

    // Noise burst (0.1s)
    this.shortNoiseBurst(ctx, 1000, 4, 0.4, 0.1);
  }

  /** Boss spawn roar — very low sawtooth 50 Hz with LFO growl modulation, 1.5s. */
  playBossRoar(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = 1.5;

    // Base sawtooth at 50 Hz
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 50;

    // LFO at 5 Hz for growl modulation (AM synthesis)
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.4;
    lfo.connect(lfoGain);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.45, t + 0.5);   // slow attack
    g.gain.setValueAtTime(0.45, t + 1.0);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    // Modulate amplitude with LFO
    lfoGain.connect(g.gain);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;

    osc.connect(lp).connect(g).connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }

  /** Boss ground slam — massive sub bass 30 Hz + noise + delayed echoes. */
  playBossSlam(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Sub bass hit — 30 Hz, 0.5s decay
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(g).connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.55);

    // Noise burst
    this.shortNoiseBurst(ctx, 200, 2, 0.35, 0.15);

    // Delayed echo (reverb-like) — repeat at 0.3s and 0.6s, decreasing volume
    for (const [delay, vol] of [[0.3, 0.3] as const, [0.6, 0.15] as const]) {
      const e = ctx.createOscillator();
      e.type = 'sine';
      e.frequency.value = 35;
      const eg = ctx.createGain();
      eg.gain.setValueAtTime(vol, t + delay);
      eg.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.3);
      e.connect(eg).connect(this.masterGain!);
      e.start(t + delay);
      e.stop(t + delay + 0.35);
    }
  }

  /** Skill selection confirmation — ascending C5→E5→G5 arpeggio. */
  playSkillSelect(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const nt = t + i * 0.08;
      g.gain.setValueAtTime(0.2, nt);
      g.gain.exponentialRampToValueAtTime(0.001, nt + 0.2);
      osc.connect(g).connect(this.masterGain!);
      osc.start(nt);
      osc.stop(nt + 0.22);
    });
  }

  /** Weather transition — filtered noise sweep from low to high, 2s. */
  playWeatherTransition(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = 2.0;

    const buf = this.makeNoiseBuffer(ctx, dur);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(100, t);
    bp.frequency.exponentialRampToValueAtTime(4000, t + dur);
    bp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.15, t + 0.5);
    g.gain.setValueAtTime(0.12, t + 1.5);
    g.gain.linearRampToValueAtTime(0.001, t + dur);
    src.connect(bp).connect(g).connect(this.masterGain!);
    src.start(t);
    src.stop(t + dur + 0.01);
  }

  // ── Phase 3 sound effects end ─────────────────────────────────────────────

  // ── New sound effects ─────────────────────────────────────────────────

  /** Dull metallic thud — block absorbing a hit. */
  playBlock(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    this.metalClang(ctx, [180, 240, 320], 0.35, 0.25);
    this.shortNoiseBurst(ctx, 300, 4, 0.15, 0.06);
  }

  /** Sharp metallic ring with reverb — perfect parry. */
  playPerfectParry(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;
    // Bright high-frequency clang
    this.metalClang(ctx, [880, 1100, 1320, 1760], 0.5, 0.8);
    // Reverb shimmer (decaying noise)
    const buf = this.makeNoiseBuffer(ctx, 0.4);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    src.connect(hp).connect(g).connect(this.masterGain!);
    src.start(t);
    src.stop(t + 0.42);
  }

  /** Heavy impact — shield bash connecting. */
  playShieldBash(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    this.metalClang(ctx, [200, 280, 400], 0.55, 0.3);
    this.shortNoiseBurst(ctx, 500, 3, 0.3, 0.08);
  }

  /** Ascending C major arpeggio — level up! */
  playLevelUp(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;
    // C4=261.63, E4=329.63, G4=392, C5=523.25
    const notes = [261.63, 329.63, 392.0, 523.25];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const start = t + i * 0.1;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.3, start + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
      osc.connect(g).connect(this.masterGain!);
      osc.start(start);
      osc.stop(start + 0.42);

      // Slight harmonic overlay
      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = freq * 2;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0, start);
      g2.gain.linearRampToValueAtTime(0.08, start + 0.03);
      g2.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc2.connect(g2).connect(this.masterGain!);
      osc2.start(start);
      osc2.stop(start + 0.37);
    });
  }

  /** Power-up chime at 5-kill streak. */
  playKillStreak5(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = [440, 554.37, 659.25]; // A4, C#5, E5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const start = t + i * 0.08;
      g.gain.setValueAtTime(0.18, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      osc.connect(g).connect(this.masterGain!);
      osc.start(start);
      osc.stop(start + 0.32);
    });
  }

  /** War horn — 10-kill streak. */
  playKillStreak10(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = [110, 146.83, 196, 220]; // A2 ascending war horn
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t + i * 0.15);
      osc.frequency.linearRampToValueAtTime(freq * 1.05, t + i * 0.15 + 0.1);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1200;
      const g = ctx.createGain();
      const start = t + i * 0.15;
      g.gain.setValueAtTime(0.22, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
      osc.connect(lp).connect(g).connect(this.masterGain!);
      osc.start(start);
      osc.stop(start + 0.55);
    });
  }

  /** Short filtered noise burst footstep — vary pitch randomly ±20%. */
  playFootstep(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const pitchVariance = 0.8 + Math.random() * 0.4;
    this.shortNoiseBurst(ctx, 200 * pitchVariance, 3, 0.04, 0.04);
  }

  /** War drum + horn blast — Commander rally. */
  playCommanderRally(): void {
    const ctx = this.ensureStarted();
    if (!ctx) return;
    const t = ctx.currentTime;
    // War drum
    const kick = ctx.createOscillator();
    kick.type = 'sine';
    kick.frequency.setValueAtTime(120, t);
    kick.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    const kg = ctx.createGain();
    kg.gain.setValueAtTime(0.5, t);
    kg.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    kick.connect(kg).connect(this.masterGain!);
    kick.start(t);
    kick.stop(t + 0.4);

    // Horn blast (two hits)
    [0.1, 0.35].forEach((offset) => {
      const horn = ctx.createOscillator();
      horn.type = 'sawtooth';
      horn.frequency.value = 146.83;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.25, t + offset);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.35);
      horn.connect(lp).connect(g).connect(this.masterGain!);
      horn.start(t + offset);
      horn.stop(t + offset + 0.38);
    });
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
