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
  DASH_ATTACK = 'DASH_ATTACK',
  BLOCK = 'BLOCK',
  SHIELD_BASH = 'SHIELD_BASH',
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
  [AnimState.DASH_ATTACK]:    { duration: 0.45, loop: false },
  [AnimState.BLOCK]:          { duration: Infinity, loop: true },
  [AnimState.SHIELD_BASH]:    { duration: 0.35, loop: false },
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

  // Smoothed/interpolated values for natural secondary motion
  private _smoothTorsoY = 0.05;       // smoothed torso bob
  private _smoothTorsoRotX = 0;       // smoothed torso forward lean
  private _smoothTorsoRotZ = 0;       // smoothed torso side-tilt
  private _smoothTorsoRotY = 0;       // smoothed hip rotation during run
  private _smoothLeftArmX = 0;
  private _smoothRightArmX = 0;
  private _smoothLeftLegX = 0;
  private _smoothRightLegX = 0;

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
        this.animateIdle(time, delta);
        break;
      case AnimState.RUN:
        this.animateRun(time, speed, delta);
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
      case AnimState.DASH_ATTACK:
        this.animateDashAttack(t, cfg.duration);
        break;
      case AnimState.BLOCK:
        this.animateBlock(time);
        break;
      case AnimState.SHIELD_BASH:
        this.animateShieldBash(t, cfg.duration);
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

  // ── Helpers ─────────────────────────────────────────────────────────────

  private _lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  // ── Idle ────────────────────────────────────────────────────────────────

  private animateIdle(time: number, delta: number): void {
    const { torsoGroup, headGroup, leftArmGroup, rightArmGroup,
      leftLegGroup, rightLegGroup, swordGroup } = this.model;

    const lerpRate = 1 - Math.exp(-12 * delta); // smooth exponential lerp (~12 rad/s settling)

    // Breathing: chest rises/falls with slight shoulder movement
    const breathCycle = Math.sin(time * Math.PI * 0.5); // ~0.5 Hz breath
    const targetTorsoY = 0.05 + breathCycle * 0.015;
    this._smoothTorsoY = this._lerp(this._smoothTorsoY, targetTorsoY, lerpRate);
    torsoGroup.position.y = this._smoothTorsoY;

    // Very subtle weight shift: hips sway side to side
    const hipSway = Math.sin(time * 0.4) * 0.012;
    const targetTorsoZ = hipSway;
    this._smoothTorsoRotZ = this._lerp(this._smoothTorsoRotZ, targetTorsoZ, lerpRate * 0.4);
    torsoGroup.rotation.z = this._smoothTorsoRotZ;

    // Head: slight look-around oscillation
    headGroup.rotation.z = Math.sin(time * 0.55) * 0.018;
    headGroup.rotation.y = Math.sin(time * 0.3) * 0.04; // subtle glance left/right

    // Arms: natural rest pose with slight breathing sway
    const leftArmTarget = breathCycle * 0.03 + Math.sin(time * 0.65) * 0.025;
    const rightArmTarget = -leftArmTarget + Math.sin(time * 0.55 + 1.0) * 0.015;
    this._smoothLeftArmX = this._lerp(this._smoothLeftArmX, leftArmTarget, lerpRate * 0.5);
    this._smoothRightArmX = this._lerp(this._smoothRightArmX, rightArmTarget, lerpRate * 0.5);
    leftArmGroup.rotation.x = this._smoothLeftArmX;
    rightArmGroup.rotation.x = this._smoothRightArmX;
    // Slight natural elbow-out rest angle
    leftArmGroup.rotation.z = -0.06 + Math.sin(time * 0.6) * 0.01;
    rightArmGroup.rotation.z = 0.06 - Math.sin(time * 0.6) * 0.01;

    // Legs: very slight weight-shift foot settling
    this._smoothLeftLegX = this._lerp(this._smoothLeftLegX, 0, lerpRate * 0.3);
    this._smoothRightLegX = this._lerp(this._smoothRightLegX, 0, lerpRate * 0.3);
    leftLegGroup.rotation.x = this._smoothLeftLegX;
    rightLegGroup.rotation.x = this._smoothRightLegX;

    // Weapon sway follows breathing
    swordGroup.rotation.z = Math.sin(time * 0.75) * 0.04;
    swordGroup.rotation.x = 0.15 + breathCycle * 0.018;

    // Torso lean reset
    this._smoothTorsoRotX = this._lerp(this._smoothTorsoRotX, 0, lerpRate * 0.5);
    torsoGroup.rotation.x = this._smoothTorsoRotX;
    this._smoothTorsoRotY = this._lerp(this._smoothTorsoRotY, 0, lerpRate * 0.4);
    torsoGroup.rotation.y = this._smoothTorsoRotY;
  }

  // ── Run ─────────────────────────────────────────────────────────────────

  private animateRun(time: number, speed: number, delta: number): void {
    const { torsoGroup, headGroup, leftArmGroup, rightArmGroup,
      leftLegGroup, rightLegGroup, swordGroup } = this.model;

    const lerpRate = 1 - Math.exp(-12 * delta); // smooth exponential lerp (~12 rad/s settling)
    const freq = 8 * speed;            // gait cycles faster at higher speed
    const legSwing = 0.60 * speed;     // ±degrees leg swing amplitude
    const armSwing = 0.45 * speed;

    const phase = time * freq;

    // Legs with slight knee-bend simulation: secondary harmonic adds knee flex
    const leftLegTarget  =  Math.sin(phase) * legSwing + Math.sin(phase * 2) * 0.08 * speed;
    const rightLegTarget = -Math.sin(phase) * legSwing - Math.sin(phase * 2) * 0.08 * speed;
    this._smoothLeftLegX = this._lerp(this._smoothLeftLegX, leftLegTarget, lerpRate * 1.5);
    this._smoothRightLegX = this._lerp(this._smoothRightLegX, rightLegTarget, lerpRate * 1.5);
    leftLegGroup.rotation.x  = this._smoothLeftLegX;
    rightLegGroup.rotation.x = this._smoothRightLegX;

    // Arms pump opposite to legs, with elbow-bend offset on secondary harmonic
    const leftArmTarget  = -Math.sin(phase) * armSwing - Math.sin(phase * 2) * 0.06 * speed;
    const rightArmTarget =  Math.sin(phase) * armSwing + Math.sin(phase * 2) * 0.06 * speed;
    this._smoothLeftArmX = this._lerp(this._smoothLeftArmX, leftArmTarget, lerpRate * 1.5);
    this._smoothRightArmX = this._lerp(this._smoothRightArmX, rightArmTarget, lerpRate * 1.5);
    leftArmGroup.rotation.x  = this._smoothLeftArmX;
    rightArmGroup.rotation.x = this._smoothRightArmX;
    leftArmGroup.rotation.z  = -0.06;
    rightArmGroup.rotation.z =  0.06;

    // Hip rotation: torso counter-swings against legs for natural gait
    const hipRotTarget = Math.sin(phase + 0.5) * 0.12 * speed;
    this._smoothTorsoRotY = this._lerp(this._smoothTorsoRotY, hipRotTarget, lerpRate * 1.2);
    torsoGroup.rotation.y = this._smoothTorsoRotY;

    // Torso forward lean increases with speed
    const leanTarget = 0.10 * speed;
    this._smoothTorsoRotX = this._lerp(this._smoothTorsoRotX, leanTarget, lerpRate);
    torsoGroup.rotation.x = this._smoothTorsoRotX;

    // Body bob — double the gait frequency (two bobs per stride cycle)
    const targetTorsoY = 0.05 + Math.abs(Math.sin(phase)) * 0.04 * speed;
    this._smoothTorsoY = this._lerp(this._smoothTorsoY, targetTorsoY, lerpRate * 1.5);
    torsoGroup.position.y = this._smoothTorsoY;

    // Head counter-rotates slightly to stay level
    headGroup.rotation.z = 0;
    headGroup.rotation.y = -this._smoothTorsoRotY * 0.3;

    // Side-tilt resets
    const sideTiltTarget = Math.sin(phase * 0.5) * 0.02 * speed;
    this._smoothTorsoRotZ = this._lerp(this._smoothTorsoRotZ, sideTiltTarget, lerpRate);
    torsoGroup.rotation.z = this._smoothTorsoRotZ;

    // More vigorous weapon sway follows arm
    swordGroup.rotation.x = 0.15 + Math.sin(phase) * 0.10 * speed;
    swordGroup.rotation.z = 0;
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
  // Horizontal right-to-left slash with wind-up anticipation

  private animateAttackLight1(t: number, dur: number): void {
    const { torsoGroup, rightArmGroup, leftArmGroup, swordGroup } = this.model;

    const p = t / dur;
    const swing = Math.sin(p * Math.PI);

    // Wind-up anticipation in the first 20%: slight opposite lean before swinging
    const anticipation = p < 0.2 ? Math.sin((p / 0.2) * Math.PI * 0.5) * 0.15 : 0;

    torsoGroup.rotation.y = anticipation - swing * 0.5;
    rightArmGroup.rotation.z = anticipation * 0.5 - swing * 0.5;
    // Non-attacking arm pulls back for balance
    leftArmGroup.rotation.z = -0.1 + swing * 0.2;
    swordGroup.rotation.z    = -swing * 0.6;
    swordGroup.rotation.x    = 0.15;

    // Weight transfer: slight side lean during swing
    torsoGroup.rotation.z = Math.sin(p * Math.PI) * -0.08;

    // Reset scale in case of carry-over from dodge
    torsoGroup.scale.set(1, 1, 1);
  }

  // ── Attack Light 2 ──────────────────────────────────────────────────────
  // Diagonal left-to-right slash with follow-through

  private animateAttackLight2(t: number, dur: number): void {
    const { torsoGroup, rightArmGroup, leftArmGroup, swordGroup } = this.model;

    const p = t / dur;
    const swing = Math.sin(p * Math.PI);

    torsoGroup.rotation.y = swing * 0.5;
    rightArmGroup.rotation.z = swing * 0.4;
    // Non-attacking arm reacts for balance
    leftArmGroup.rotation.z = -0.08 - swing * 0.12;
    swordGroup.rotation.z    = swing * 0.5;
    swordGroup.rotation.x    = 0.15 - swing * 0.3;

    // Weight transfer
    torsoGroup.rotation.z = Math.sin(p * Math.PI) * 0.08;

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

  // ── Dash Attack ────────────────────────────────────────────────────────
  // Forward lunge: sword thrust straight ahead

  private animateDashAttack(t: number, dur: number): void {
    const { torsoGroup, rightArmGroup, swordGroup } = this.model;

    const p = t / dur;
    // Forward lean during lunge, arm thrust forward
    torsoGroup.rotation.x = Math.sin(p * Math.PI) * 0.45;
    rightArmGroup.rotation.x = -0.8 + p * 0.8;
    swordGroup.rotation.x = -0.6 + p * 0.6;
    swordGroup.rotation.z = 0;
    torsoGroup.rotation.y = 0;
    torsoGroup.scale.set(1, 1, 1);
  }

  // ── Block ──────────────────────────────────────────────────────────────
  // Left arm raised across chest — shield guard pose

  private animateBlock(time: number): void {
    const { torsoGroup, leftArmGroup, rightArmGroup, swordGroup } = this.model;

    // Slight crouch — torso lowered
    torsoGroup.position.y = 0.0 + Math.sin(time * 1.2) * 0.005;
    torsoGroup.rotation.x = 0.08; // slight forward lean

    // Shield arm: raised diagonally across chest
    leftArmGroup.rotation.x = -1.1;
    leftArmGroup.rotation.z = 0.5;

    // Sword arm relaxed at side
    rightArmGroup.rotation.x = 0.15;
    rightArmGroup.rotation.z = -0.1;
    swordGroup.rotation.x = 0.0;
    swordGroup.rotation.z = 0.0;

    torsoGroup.scale.set(1, 1, 1);
  }

  // ── Shield Bash ────────────────────────────────────────────────────────
  // Left arm thrusts forward in a shield bash

  private animateShieldBash(t: number, dur: number): void {
    const { torsoGroup, leftArmGroup } = this.model;

    const p = t / dur;
    // Forward thrust — push arm out and pull back
    const swing = Math.sin(p * Math.PI);
    leftArmGroup.rotation.x = -1.1 + swing * 0.8;
    leftArmGroup.rotation.z = 0.5 - swing * 0.2;
    torsoGroup.rotation.x = 0.08 + swing * 0.15;
    torsoGroup.scale.set(1, 1, 1);
  }
}
