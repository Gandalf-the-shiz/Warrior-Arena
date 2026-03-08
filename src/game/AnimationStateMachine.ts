import * as THREE from 'three';
import { WarriorModel } from '@/game/WarriorModel';

// ── State enum ───────────────────────────────────────────────────────────────
export enum AnimState {
  IDLE = 'IDLE',
  RUN = 'RUN',
  DODGE = 'DODGE',
  ATTACK_LIGHT_1 = 'ATTACK_LIGHT_1',
  ATTACK_LIGHT_2 = 'ATTACK_LIGHT_2',
  ATTACK_LIGHT_3 = 'ATTACK_LIGHT_3',
  ATTACK_HEAVY = 'ATTACK_HEAVY',
  HIT = 'HIT',
  DEATH = 'DEATH',
}

interface StateConfig {
  duration: number;
  loop: boolean;
  onComplete?: () => void;
}

const STATE_CONFIG: Record<AnimState, StateConfig> = {
  [AnimState.IDLE]:           { duration: Infinity, loop: true },
  [AnimState.RUN]:            { duration: Infinity, loop: true },
  [AnimState.DODGE]:          { duration: 0.45, loop: false },
  [AnimState.ATTACK_LIGHT_1]: { duration: 0.35, loop: false },
  [AnimState.ATTACK_LIGHT_2]: { duration: 0.35, loop: false },
  [AnimState.ATTACK_LIGHT_3]: { duration: 0.55, loop: false },
  [AnimState.ATTACK_HEAVY]:   { duration: 0.75, loop: false },
  [AnimState.HIT]:            { duration: 0.3,  loop: false },
  [AnimState.DEATH]:          { duration: 1.2,  loop: false },
};

/**
 * Procedural animation state machine for the warrior character.
 *
 * All animations are driven by trigonometric functions applied directly to
 * the Three.js sub-group transforms — no skeletal rig or keyframe tracks needed.
 */
export class AnimationStateMachine {
  private state: AnimState = AnimState.IDLE;
  private stateTime = 0;

  // Reusable quaternion / euler objects to avoid GC pressure
  private readonly _q = new THREE.Quaternion();
  private readonly _e = new THREE.Euler();

  constructor(private readonly model: WarriorModel) {}

  get currentState(): AnimState {
    return this.state;
  }

  /**
   * Returns 0–1 progress through the current non-looping state.
   * Returns 0 for infinite / looping states (IDLE, RUN).
   */
  getStateProgress(): number {
    const cfg = STATE_CONFIG[this.state];
    if (cfg.loop || cfg.duration === Infinity) return 0;
    return Math.min(this.stateTime / cfg.duration, 1);
  }

  /**
   * Transition to a new state.  Non-looping states that are still playing will
   * be interrupted by anything except themselves (prevents spamming).
   */
  setState(newState: AnimState, onComplete?: () => void): void {
    if (newState === this.state) return;

    const cfg = STATE_CONFIG[newState];
    cfg.onComplete = onComplete; // Always update — clears stale callbacks when none provided

    this.state = newState;
    this.stateTime = 0;
  }

  /**
   * Advance the current animation by `delta` seconds.
   * @param delta  Frame delta time in seconds.
   * @param time   Total elapsed time in seconds (for continuous animations).
   * @param speed  Movement speed scalar (0–1) used by RUN animation.
   */
  update(delta: number, time: number, speed = 0): void {
    this.stateTime += delta;

    const cfg = STATE_CONFIG[this.state];
    const t = this.stateTime;

    switch (this.state) {
      case AnimState.IDLE:
        this.animateIdle(time);
        break;
      case AnimState.RUN:
        this.animateRun(time, speed);
        break;
      case AnimState.DODGE:
        this.animateDodge(t, cfg.duration);
        break;
      case AnimState.ATTACK_LIGHT_1:
        this.animateAttackLight1(t, cfg.duration);
        break;
      case AnimState.ATTACK_LIGHT_2:
        this.animateAttackLight2(t, cfg.duration);
        break;
      case AnimState.ATTACK_LIGHT_3:
        this.animateAttackLight3(t, cfg.duration);
        break;
      case AnimState.ATTACK_HEAVY:
        this.animateAttackHeavy(t, cfg.duration);
        break;
      case AnimState.HIT:
        this.animateHit(t, cfg.duration);
        break;
      case AnimState.DEATH:
        this.animateDeath(t, cfg.duration);
        break;
    }

    // Handle non-looping state completion
    if (!cfg.loop && t >= cfg.duration) {
      cfg.onComplete?.();
      cfg.onComplete = undefined;
      // Return to idle unless we've died
      if (this.state !== AnimState.DEATH) {
        this.state = AnimState.IDLE;
        this.stateTime = 0;
      }
    }
  }

  // ── Idle ────────────────────────────────────────────────────────────────

  private animateIdle(time: number): void {
    const { torsoGroup, headGroup, leftArmGroup, rightArmGroup,
      leftLegGroup, rightLegGroup, swordGroup } = this.model;

    // Gentle breathing — torso bobs up/down
    torsoGroup.position.y = 0.05 + Math.sin(time * Math.PI) * 0.018;

    // Head very slight sway
    headGroup.rotation.z = Math.sin(time * 0.7) * 0.02;

    // Arms rest
    leftArmGroup.rotation.x = Math.sin(time * 0.8) * 0.04;
    rightArmGroup.rotation.x = -leftArmGroup.rotation.x;

    // Legs straight
    leftLegGroup.rotation.x = 0;
    rightLegGroup.rotation.x = 0;

    // Weapon sway
    swordGroup.rotation.z = Math.sin(time * 0.9) * 0.04;
    swordGroup.rotation.x = 0.15 + Math.sin(time * 0.6) * 0.02;

    // No torso lean
    torsoGroup.rotation.x = 0;
    torsoGroup.rotation.z = 0;
  }

  // ── Run ─────────────────────────────────────────────────────────────────

  private animateRun(time: number, speed: number): void {
    const { torsoGroup, headGroup, leftArmGroup, rightArmGroup,
      leftLegGroup, rightLegGroup, swordGroup } = this.model;

    const freq = 8 * speed;            // gait cycles faster at higher speed
    const legSwing = 0.55 * speed;     // ±degrees leg swing amplitude
    const armSwing = 0.4 * speed;

    const phase = time * freq;

    // Alternate legs
    leftLegGroup.rotation.x  =  Math.sin(phase) * legSwing;
    rightLegGroup.rotation.x = -Math.sin(phase) * legSwing;

    // Arms pump opposite to legs
    leftArmGroup.rotation.x  = -Math.sin(phase) * armSwing;
    rightArmGroup.rotation.x =  Math.sin(phase) * armSwing;

    // Torso slight forward lean
    torsoGroup.rotation.x = 0.09 * speed;

    // Body bob
    torsoGroup.position.y = 0.05 + Math.abs(Math.sin(phase * 2)) * 0.04;

    // Head stays level
    headGroup.rotation.z = 0;

    // More vigorous weapon sway
    swordGroup.rotation.x = 0.15 + Math.sin(phase * 0.5) * 0.12;
    swordGroup.rotation.z = 0;

    torsoGroup.rotation.z = 0;
  }

  // ── Dodge ───────────────────────────────────────────────────────────────

  private animateDodge(t: number, dur: number): void {
    const { torsoGroup } = this.model;

    const p = t / dur; // 0 → 1

    // Quick squash-and-stretch: flatten Y, widen X during leap, snap back
    if (p < 0.35) {
      const pp = p / 0.35;
      torsoGroup.scale.set(1 + pp * 0.2, 1 - pp * 0.2, 1);
    } else {
      const pp = (p - 0.35) / 0.65;
      torsoGroup.scale.set(
        1.2 - pp * 0.2,
        0.8 + pp * 0.2,
        1,
      );
    }
    torsoGroup.rotation.x = Math.sin(p * Math.PI) * 0.35;
  }

  // ── Attack Light 1 ──────────────────────────────────────────────────────
  // Horizontal right-to-left slash

  private animateAttackLight1(t: number, dur: number): void {
    const { torsoGroup, rightArmGroup, swordGroup } = this.model;

    const p = t / dur;
    const swing = Math.sin(p * Math.PI);

    torsoGroup.rotation.y = -swing * 0.5;
    rightArmGroup.rotation.z = -swing * 0.5;
    swordGroup.rotation.z    = -swing * 0.6;
    swordGroup.rotation.x    = 0.15;

    // Reset scale in case of carry-over from dodge
    torsoGroup.scale.set(1, 1, 1);
  }

  // ── Attack Light 2 ──────────────────────────────────────────────────────
  // Diagonal left-to-right slash

  private animateAttackLight2(t: number, dur: number): void {
    const { torsoGroup, rightArmGroup, swordGroup } = this.model;

    const p = t / dur;
    const swing = Math.sin(p * Math.PI);

    torsoGroup.rotation.y = swing * 0.5;
    rightArmGroup.rotation.z = swing * 0.4;
    swordGroup.rotation.z    = swing * 0.5;
    swordGroup.rotation.x    = 0.15 - swing * 0.3;

    torsoGroup.scale.set(1, 1, 1);
  }

  // ── Attack Light 3 ──────────────────────────────────────────────────────
  // Overhead slam

  private animateAttackLight3(t: number, dur: number): void {
    const { torsoGroup, rightArmGroup, swordGroup } = this.model;

    const p = t / dur;

    if (p < 0.45) {
      // Wind-up — raise sword overhead
      const pp = p / 0.45;
      rightArmGroup.rotation.x = -pp * 1.6;
      swordGroup.rotation.x    = 0.15 - pp * 1.2;
      torsoGroup.rotation.x    = pp * 0.15;
    } else {
      // Slam down
      const pp = (p - 0.45) / 0.55;
      rightArmGroup.rotation.x = -1.6 + pp * 2.2;
      swordGroup.rotation.x    = 0.15 - 1.2 + pp * 1.8;
      torsoGroup.rotation.x    = 0.15 - pp * 0.15;
    }

    torsoGroup.rotation.y = 0;
    torsoGroup.scale.set(1, 1, 1);
  }

  // ── Attack Heavy ────────────────────────────────────────────────────────
  // Full 360° spin slash

  private animateAttackHeavy(t: number, dur: number): void {
    const { torsoGroup, rightArmGroup, swordGroup } = this.model;

    const p = t / dur;

    // Spin the entire torso group 360°
    torsoGroup.rotation.y = p * Math.PI * 2;

    // Extend arm out wide during spin
    rightArmGroup.rotation.z = -0.4;
    swordGroup.rotation.x    = 0.15;
    swordGroup.rotation.z    = 0;

    torsoGroup.scale.set(1, 1, 1);
  }

  // ── Hit ─────────────────────────────────────────────────────────────────

  private animateHit(t: number, dur: number): void {
    const { torsoGroup } = this.model;

    const p = t / dur;
    // Brief flinch backward then recover
    torsoGroup.rotation.x = Math.sin(p * Math.PI) * (-0.3);
    torsoGroup.scale.set(1, 1, 1);

    this._q.setFromEuler(this._e.set(0, 0, 0));
  }

  // ── Death ───────────────────────────────────────────────────────────────

  private animateDeath(t: number, dur: number): void {
    const { torsoGroup, leftLegGroup, rightLegGroup } = this.model;

    const p = Math.min(t / dur, 1);

    if (p < 0.4) {
      // Collapse to knees
      const pp = p / 0.4;
      leftLegGroup.rotation.x  = pp * 1.3;
      rightLegGroup.rotation.x = pp * 1.3;
      torsoGroup.rotation.x    = pp * 0.4;
      torsoGroup.position.y    = 0.05 - pp * 0.5;
    } else {
      // Fall forward face-down
      const pp = (p - 0.4) / 0.6;
      leftLegGroup.rotation.x  = 1.3;
      rightLegGroup.rotation.x = 1.3;
      torsoGroup.rotation.x    = 0.4 + pp * 1.0;
      torsoGroup.position.y    = 0.05 - 0.5 - pp * 0.3;
    }

    torsoGroup.scale.set(1, 1, 1);
  }
}
