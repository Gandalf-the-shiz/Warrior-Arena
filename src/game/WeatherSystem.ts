import * as THREE from 'three';
import type { Renderer } from '@/engine/Renderer';
import type { AudioManager } from '@/engine/AudioManager';
import type { WaveAnnouncer } from '@/ui/WaveAnnouncer';

export type WeatherState = 'CLEAR' | 'FOG' | 'BLOOD_MOON' | 'STORM';

/**
 * Manages dynamic weather states that shift the atmosphere every few waves.
 *
 * States: CLEAR → FOG, BLOOD_MOON, STORM (random transition every 3 waves)
 * Each transition takes 3 seconds to interpolate.
 */
export class WeatherSystem {
  private current: WeatherState = 'CLEAR';
  private target: WeatherState = 'CLEAR';
  private transitionT = 1.0; // 1 = fully at target
  private readonly TRANSITION_DURATION = 3.0;

  private lastWaveTransition = 0;
  private readonly WAVES_PER_CHANGE = 3;

  // Scene lights — set in init
  private ambientLight: THREE.AmbientLight | null = null;
  private sunLight: THREE.DirectionalLight | null = null;
  private hemisphereLight: THREE.HemisphereLight | null = null;

  // Storm lightning tracking
  private lightningTimer = 0;
  private nextLightningDelay = 0;

  // Rain particle system
  private rainPoints: THREE.Points | null = null;
  private rainVelocities: Float32Array | null = null;
  private readonly RAIN_COUNT = 600;

  // Fog wisps for FOG state
  private fogWisps: THREE.Points | null = null;
  private fogWispVelocities: Float32Array | null = null;
  private readonly WISP_COUNT = 200;

  // Blood moon ambient pulsing
  private bloodMoonTimer = 0;

  constructor(
    private readonly renderer: Renderer,
    private readonly audio: AudioManager,
  ) {}

  /**
   * Set scene lights for weather modulation.
   * Call after Arena is created and lights are added to the scene.
   */
  setLights(
    ambient: THREE.AmbientLight,
    sun: THREE.DirectionalLight,
    hemi: THREE.HemisphereLight,
  ): void {
    this.ambientLight = ambient;
    this.sunLight = sun;
    this.hemisphereLight = hemi;
  }

  /**
   * Check if a weather transition should happen based on wave number.
   * Call once when a new wave starts.
   */
  maybeTransition(
    wave: number,
    announcer?: WaveAnnouncer,
  ): void {
    if (wave < 3) return; // waves 1-2 always CLEAR
    if (wave - this.lastWaveTransition < this.WAVES_PER_CHANGE) return;

    this.lastWaveTransition = wave;

    const available: WeatherState[] = ['CLEAR', 'FOG', 'STORM'];
    if (wave >= 6) available.push('BLOOD_MOON');

    // Don't pick same state twice in a row
    const choices = available.filter(w => w !== this.current);
    const newWeather = choices[Math.floor(Math.random() * choices.length)]!;

    this.startTransition(newWeather, announcer, wave);
  }

  private startTransition(
    newState: WeatherState,
    announcer?: WaveAnnouncer,
    wave?: number,
  ): void {
    if (newState === this.current) return;
    this.current = this.target;
    this.target = newState;
    this.transitionT = 0;

    this.audio.playWeatherTransition();

    if (newState === 'BLOOD_MOON' && announcer && wave !== undefined) {
      announcer.announce(wave, 'BLOOD MOON RISES');
    }

    // Create rain particles for STORM
    if (newState === 'STORM' && !this.rainPoints) {
      this.createRainParticles();
    }
    // Create fog wisps for FOG
    if (newState === 'FOG' && !this.fogWisps) {
      this.createFogWisps();
    }
  }

  /**
   * Called every frame with real (unscaled) delta time.
   * @param delta real delta time
   * @param onScreenFlash callback for lightning flash
   * @param onCameraShake callback for thunder shake
   */
  update(
    delta: number,
    onScreenFlash?: () => void,
    onCameraShake?: (intensity: number, duration: number) => void,
  ): void {
    // Advance transition
    if (this.transitionT < 1.0) {
      this.transitionT = Math.min(1.0, this.transitionT + delta / this.TRANSITION_DURATION);
      this.applyWeather(this.transitionT);
    }

    // Storm lightning
    if (this.target === 'STORM' && this.transitionT > 0.5) {
      this.lightningTimer += delta;
      if (this.lightningTimer >= this.nextLightningDelay) {
        this.lightningTimer = 0;
        this.nextLightningDelay = 5 + Math.random() * 5; // 5-10 seconds
        onScreenFlash?.();
        onCameraShake?.(0.15, 0.25);
        this.audio.playThunder();
      }
    }

    // Blood moon ambient pulse
    if ((this.target === 'BLOOD_MOON' || this.current === 'BLOOD_MOON') && this.ambientLight) {
      this.bloodMoonTimer += delta;
      const pulse = Math.sin(this.bloodMoonTimer * 1.2) * 0.1 + 0.85;
      this.ambientLight.intensity = THREE.MathUtils.lerp(0.3, 0.5, pulse);
    }

    // Animate rain particles
    if (this.rainPoints && this.rainVelocities && this.target === 'STORM') {
      this.updateRain(delta);
    }

    // Animate fog wisps
    if (this.fogWisps && this.fogWispVelocities && this.target === 'FOG') {
      this.updateFogWisps(delta);
    }

    // Hide particles when weather changes away
    if (this.rainPoints && this.target !== 'STORM') {
      this.rainPoints.visible = false;
    } else if (this.rainPoints) {
      this.rainPoints.visible = this.transitionT > 0.5;
    }

    if (this.fogWisps && this.target !== 'FOG') {
      this.fogWisps.visible = false;
    } else if (this.fogWisps) {
      this.fogWisps.visible = this.transitionT > 0.5;
    }
  }

  /** Current weather state (for WaveAnnouncer etc.). */
  get currentWeather(): WeatherState {
    return this.target;
  }

  /** Returns speed modifier for enemies (blood moon makes them faster). */
  getEnemySpeedModifier(): number {
    if (this.target === 'BLOOD_MOON' && this.transitionT > 0.8) {
      return 1.2; // 20% faster
    }
    return 1.0;
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private applyWeather(t: number): void {
    // Interpolate fog and lighting based on target state
    switch (this.target) {
      case 'CLEAR':
        this.renderer.setWeatherOverrides(
          new THREE.Color(0xd4c8a0).lerp(new THREE.Color(0xd4c8a0), t),
          THREE.MathUtils.lerp(0.002, 0.002, t),
          new THREE.Color(0x87ceeb).lerp(new THREE.Color(0x87ceeb), t),
        );
        if (this.ambientLight) {
          this.ambientLight.color.lerp(new THREE.Color(0x404060), t);
          this.ambientLight.intensity = THREE.MathUtils.lerp(this.ambientLight.intensity, 0.6, t * 0.1);
        }
        if (this.sunLight) {
          this.sunLight.color.lerp(new THREE.Color(0xffe8c0), t);
          this.sunLight.intensity = THREE.MathUtils.lerp(this.sunLight.intensity, 1.0, t * 0.05);
        }
        break;

      case 'FOG':
        this.renderer.setWeatherOverrides(
          new THREE.Color(0xa0a8b0), // grey fog color
          THREE.MathUtils.lerp(0.002, 0.04, t),
          new THREE.Color(0x87ceeb).lerp(new THREE.Color(0x8898a8), t),
        );
        if (this.ambientLight) {
          this.ambientLight.color.lerp(new THREE.Color(0x303050), t);
          this.ambientLight.intensity = THREE.MathUtils.lerp(this.ambientLight.intensity, 0.42, t * 0.06);
        }
        break;

      case 'BLOOD_MOON':
        this.renderer.setWeatherOverrides(
          new THREE.Color(0xff3300).lerp(new THREE.Color(0xd4c8a0), 1 - t * 0.5),
          THREE.MathUtils.lerp(0.002, 0.006, t),
          new THREE.Color(0x87ceeb).lerp(new THREE.Color(0x2a0a05), t),
        );
        if (this.sunLight) {
          this.sunLight.color.lerp(new THREE.Color(0xff3300), t);
        }
        if (this.hemisphereLight) {
          this.hemisphereLight.groundColor.lerp(new THREE.Color(0x3a0808), t);
        }
        break;

      case 'STORM':
        this.renderer.setWeatherOverrides(
          new THREE.Color(0x404060),
          THREE.MathUtils.lerp(0.002, 0.012, t),
          new THREE.Color(0x87ceeb).lerp(new THREE.Color(0x1a1a28), t),
        );
        if (this.ambientLight) {
          this.ambientLight.color.lerp(new THREE.Color(0x202030), t);
          this.ambientLight.intensity = THREE.MathUtils.lerp(this.ambientLight.intensity, 0.3, t * 0.05);
        }
        if (this.sunLight) {
          this.sunLight.color.lerp(new THREE.Color(0x8888bb), t);
          this.sunLight.intensity = THREE.MathUtils.lerp(this.sunLight.intensity, 0.5, t * 0.05);
        }
        break;
    }
  }

  private createRainParticles(): void {
    const positions = new Float32Array(this.RAIN_COUNT * 3);
    this.rainVelocities = new Float32Array(this.RAIN_COUNT * 3);
    for (let i = 0; i < this.RAIN_COUNT; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 60;
      positions[i * 3 + 1] = Math.random() * 20;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
      this.rainVelocities[i * 3]     = -0.5;
      this.rainVelocities[i * 3 + 1] = -18 - Math.random() * 5;
      this.rainVelocities[i * 3 + 2] = -1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x8888cc,
      size: 0.05,
      transparent: true,
      opacity: 0.6,
    });
    this.rainPoints = new THREE.Points(geo, mat);
    this.renderer.scene.add(this.rainPoints);
  }

  private updateRain(delta: number): void {
    if (!this.rainPoints || !this.rainVelocities) return;
    const pos = this.rainPoints.geometry.attributes['position'] as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < this.RAIN_COUNT; i++) {
      arr[i * 3]     += this.rainVelocities[i * 3]! * delta;
      arr[i * 3 + 1] += this.rainVelocities[i * 3 + 1]! * delta;
      arr[i * 3 + 2] += this.rainVelocities[i * 3 + 2]! * delta;
      // Reset when below ground
      if (arr[i * 3 + 1]! < -1) {
        arr[i * 3]     = (Math.random() - 0.5) * 60;
        arr[i * 3 + 1] = 20 + Math.random() * 5;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 60;
      }
    }
    pos.needsUpdate = true;
  }

  private createFogWisps(): void {
    const positions = new Float32Array(this.WISP_COUNT * 3);
    this.fogWispVelocities = new Float32Array(this.WISP_COUNT * 3);
    for (let i = 0; i < this.WISP_COUNT; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 50;
      positions[i * 3 + 1] = 0.3 + Math.random() * 2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 50;
      this.fogWispVelocities[i * 3]     = (Math.random() - 0.5) * 0.4;
      this.fogWispVelocities[i * 3 + 1] = Math.random() * 0.1;
      this.fogWispVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xaabbcc,
      size: 0.3,
      transparent: true,
      opacity: 0.35,
    });
    this.fogWisps = new THREE.Points(geo, mat);
    this.renderer.scene.add(this.fogWisps);
  }

  private updateFogWisps(delta: number): void {
    if (!this.fogWisps || !this.fogWispVelocities) return;
    const pos = this.fogWisps.geometry.attributes['position'] as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < this.WISP_COUNT; i++) {
      arr[i * 3]     += this.fogWispVelocities[i * 3]! * delta;
      arr[i * 3 + 1] += this.fogWispVelocities[i * 3 + 1]! * delta;
      arr[i * 3 + 2] += this.fogWispVelocities[i * 3 + 2]! * delta;
      // Drift wrap
      if (Math.abs(arr[i * 3]!) > 25)   this.fogWispVelocities[i * 3]! *= -1;
      if (arr[i * 3 + 1]! > 3)          this.fogWispVelocities[i * 3 + 1]! = -Math.abs(this.fogWispVelocities[i * 3 + 1]!);
      if (arr[i * 3 + 1]! < 0.1)        this.fogWispVelocities[i * 3 + 1]! = Math.abs(this.fogWispVelocities[i * 3 + 1]!);
      if (Math.abs(arr[i * 3 + 2]!) > 25) this.fogWispVelocities[i * 3 + 2]! *= -1;
    }
    pos.needsUpdate = true;
  }
}
