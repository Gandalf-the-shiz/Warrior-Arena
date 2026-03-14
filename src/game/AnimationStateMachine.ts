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
 *
 * Arms have elbow articulation via leftForearmGroup / rightForearmGroup.
 * Both arms grip the sword together for all 2-handed attack animations.
 */
export class AnimationStateMachine {
  private state: AnimState = AnimState.IDLE;
  private stateTime = 0;

  // Reusable quaternion / euler objects to avoid GC pressure
  private readonly _q = new THREE.Quaternion();
  private readonly _e = new THREE.Euler();

  // Smoothed/interpolated values for natural secondary motion
  private _smoothTorsoY = 0.05;
  private _smoothTorsoRotX = 0;
  private _smoothTorsoRotZ = 0;
  private _smoothTorsoRotY = 0;
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
    cfg.onComplete = onComplete;

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

  // ── Easing helpers ───────────────────────────────────────────────────────

  private _lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private _easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  private _easeInCubic(t: number): number {
    return t * t * t;
  }

  private _easeOutBack(t: number): number {
    const c = 1.7; // overshoot coefficient — controls how far past 1.0 the value bounces
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  }

  // ── Idle ────────────────────────────────────────────────────────────────

  private animateIdle(time: number, delta: number): void {
    const { torsoGroup, headGroup, leftArmGroup, rightArmGroup,
      leftForearmGroup, rightForearmGroup,
      leftLegGroup, rightLegGroup, swordGroup } = this.model;

    const lerpRate = 1 - Math.exp(-12 * delta);

    // Breathing: chest rises/falls
    const breathCycle = Math.sin(time * Math.PI * 0.5);
    const targetTorsoY = 0.05 + breathCycle * 0.015;
    this._smoothTorsoY = this._lerp(this._smoothTorsoY, targetTorsoY, lerpRate);
    torsoGroup.position.y = this._smoothTorsoY;

    // Very subtle hip sway
    const hipSway = Math.sin(time * 0.4) * 0.012;
    this._smoothTorsoRotZ = this._lerp(this._smoothTorsoRotZ, hipSway, lerpRate * 0.4);
    torsoGroup.rotation.z = this._smoothTorsoRotZ;

    // Head subtle look-around
    headGroup.rotation.z = Math.sin(time * 0.55) * 0.018;
    headGroup.rotation.y = Math.sin(time * 0.3) * 0.04;

    // Right arm holds sword at side — carry pose with blade angled 45-65° upward
    const breathSway = breathCycle * 0.015;
    const rightShoulderTarget = 0.20 + breathSway;
    this._smoothRightArmX = this._lerp(this._smoothRightArmX, rightShoulderTarget, lerpRate * 0.5);
    rightArmGroup.rotation.x = this._smoothRightArmX;
    rightArmGroup.rotation.z = -0.40 - Math.sin(time * 0.6) * 0.008;
    rightForearmGroup.rotation.x = -0.55 + breathCycle * 0.015;

    // Left arm hangs freely at side — no sword grip
    const leftShoulderTarget = breathSway;
    this._smoothLeftArmX = this._lerp(this._smoothLeftArmX, leftShoulderTarget, lerpRate * 0.5);
    leftArmGroup.rotation.x = this._smoothLeftArmX;
    leftArmGroup.rotation.z =  0.20 + Math.sin(time * 0.6) * 0.008;
    leftForearmGroup.rotation.x = -0.15 + breathCycle * 0.01;

    // Legs rest
    this._smoothLeftLegX  = this._lerp(this._smoothLeftLegX,  0, lerpRate * 0.3);
    this._smoothRightLegX = this._lerp(this._smoothRightLegX, 0, lerpRate * 0.3);
    leftLegGroup.rotation.x  = this._smoothLeftLegX;
    rightLegGroup.rotation.x = this._smoothRightLegX;

    // Sword sways gently in right hand (forearm-local space) — 45-65° carry angle
    swordGroup.rotation.z = Math.sin(time * 0.75) * 0.04 - 0.10;
    swordGroup.rotation.x = 0.90 + breathCycle * 0.018;

    // Torso lean reset
    this._smoothTorsoRotX = this._lerp(this._smoothTorsoRotX, 0, lerpRate * 0.5);
    torsoGroup.rotation.x = this._smoothTorsoRotX;
    this._smoothTorsoRotY = this._lerp(this._smoothTorsoRotY, 0, lerpRate * 0.4);
    torsoGroup.rotation.y = this._smoothTorsoRotY;
  }

  // ── Run ─────────────────────────────────────────────────────────────────

  private animateRun(time: number, speed: number, delta: number): void {
    const { torsoGroup, headGroup, leftArmGroup, rightArmGroup,
      leftForearmGroup, rightForearmGroup,
      leftLegGroup, rightLegGroup, swordGroup } = this.model;

    const lerpRate = 1 - Math.exp(-12 * delta);
    const freq = 8 * speed;
    const legSwing = 0.60 * speed;

    const phase = time * freq;

    // Legs pump
    const leftLegTarget  =  Math.sin(phase) * legSwing + Math.sin(phase * 2) * 0.08 * speed;
    const rightLegTarget = -Math.sin(phase) * legSwing - Math.sin(phase * 2) * 0.08 * speed;
    this._smoothLeftLegX  = this._lerp(this._smoothLeftLegX,  leftLegTarget,  lerpRate * 1.5);
    this._smoothRightLegX = this._lerp(this._smoothRightLegX, rightLegTarget, lerpRate * 1.5);
    leftLegGroup.rotation.x  = this._smoothLeftLegX;
    rightLegGroup.rotation.x = this._smoothRightLegX;

    // Right arm: carries sword with slight counter-stride bob
    const rightArmBob = -Math.sin(phase) * 0.20 * speed;
    const rightShoulderTarget = 0.20 + rightArmBob;
    this._smoothRightArmX = this._lerp(this._smoothRightArmX, rightShoulderTarget, lerpRate * 1.5);
    rightArmGroup.rotation.x = this._smoothRightArmX;
    rightArmGroup.rotation.z = -0.40;

    // Left arm: natural arm pump — opposite to left leg (in phase with right leg)
    const leftArmPump = Math.sin(phase) * 0.50 * speed;
    const leftShoulderTarget = leftArmPump;
    this._smoothLeftArmX = this._lerp(this._smoothLeftArmX, leftShoulderTarget, lerpRate * 1.5);
    leftArmGroup.rotation.x = this._smoothLeftArmX;
    leftArmGroup.rotation.z = 0.20;

    // Forearms maintain natural bend with slight oscillation
    rightForearmGroup.rotation.x = -0.55 + Math.sin(phase) * 0.04 * speed;
    leftForearmGroup.rotation.x  = -0.15 + Math.sin(phase) * 0.05 * speed;

    // Hip rotation
    const hipRotTarget = Math.sin(phase + 0.5) * 0.12 * speed;
    this._smoothTorsoRotY = this._lerp(this._smoothTorsoRotY, hipRotTarget, lerpRate * 1.2);
    torsoGroup.rotation.y = this._smoothTorsoRotY;

    // Forward lean
    const leanTarget = 0.10 * speed;
    this._smoothTorsoRotX = this._lerp(this._smoothTorsoRotX, leanTarget, lerpRate);
    torsoGroup.rotation.x = this._smoothTorsoRotX;

    // Body bob
    const targetTorsoY = 0.05 + Math.abs(Math.sin(phase)) * 0.04 * speed;
    this._smoothTorsoY = this._lerp(this._smoothTorsoY, targetTorsoY, lerpRate * 1.5);
    torsoGroup.position.y = this._smoothTorsoY;

    // Head stays level
    headGroup.rotation.z = 0;
    headGroup.rotation.y = -this._smoothTorsoRotY * 0.3;

    const sideTiltTarget = Math.sin(phase * 0.5) * 0.02 * speed;
    this._smoothTorsoRotZ = this._lerp(this._smoothTorsoRotZ, sideTiltTarget, lerpRate);
    torsoGroup.rotation.z = this._smoothTorsoRotZ;

    // Sword tilts slightly with each step (forearm-local space) — maintains 45-65° carry angle
    swordGroup.rotation.z = Math.sin(phase) * 0.05 * speed - 0.10;
    swordGroup.rotation.x = 0.90 + Math.sin(phase) * 0.04 * speed;
  }

  // ── Dodge ───────────────────────────────────────────────────────────────

  private animateDodge(t: number, dur: number): void {
    const { torsoGroup, leftArmGroup, rightArmGroup,
      leftForearmGroup, rightForearmGroup } = this.model;

    const p = t / dur;

    // Quick squash-and-stretch during roll
    if (p < 0.35) {
      const pp = p / 0.35;
      torsoGroup.scale.set(1 + pp * 0.2, 1 - pp * 0.2, 1);
    } else {
      const pp = (p - 0.35) / 0.65;
      torsoGroup.scale.set(1.2 - pp * 0.2, 0.8 + pp * 0.2, 1);
    }
    torsoGroup.rotation.x = Math.sin(p * Math.PI) * 0.35;

    // Right arm tucks sword close during roll — more elbow bend
    const tuck = Math.sin(p * Math.PI);
    rightForearmGroup.rotation.x = -0.55 - tuck * 0.50;
    rightArmGroup.rotation.x = 0.20 + tuck * 0.30;
    rightArmGroup.rotation.z = -0.40;

    // Left arm swings freely during dodge
    leftForearmGroup.rotation.x = -0.15 - tuck * 0.20;
    leftArmGroup.rotation.x = tuck * 0.35;
    leftArmGroup.rotation.z = 0.20;
  }

  // ── Attack Light 1 ──────────────────────────────────────────────────────
  // Wide horizontal right-to-left slash — Dark Souls greatsword R1 #1

  private animateAttackLight1(t: number, dur: number): void {
    const { torsoGroup, headGroup, leftArmGroup, rightArmGroup,
      leftForearmGroup, rightForearmGroup, swordGroup } = this.model;

    const p = t / dur;
    torsoGroup.scale.set(1, 1, 1);

    if (p < 0.25) {
      // Phase 1: Wind-up — coil to the right, left arm reaches in to grip
      const pp = this._easeOutCubic(p / 0.25);
      torsoGroup.rotation.y = -0.60 * pp;
      torsoGroup.position.y = 0.05 - 0.05 * pp;
      torsoGroup.rotation.z = 0;

      // Right arm pulls sword to the right side
      rightArmGroup.rotation.x = this._lerp(0.20, 0.30, pp);
      rightArmGroup.rotation.z = this._lerp(-0.40, -0.70, pp);
      rightForearmGroup.rotation.x = this._lerp(-0.55, -0.50, pp);

      // Left arm reaches inward to grip the sword handle
      leftArmGroup.rotation.x = this._lerp(0.00, 0.40, pp);
      leftArmGroup.rotation.z = this._lerp(0.20, -0.15, pp);
      leftForearmGroup.rotation.x = this._lerp(-0.15, -0.65, pp);

      // Blade angled forward in forearm space — prevents body clipping on swing
      swordGroup.rotation.x = this._lerp(0.90, 0.45, pp);
      swordGroup.rotation.z = this._lerp(-0.10, -0.25, pp);

      headGroup.rotation.y = -0.15 * pp;
    } else if (p < 0.60) {
      // Phase 2: Explosive swing right-to-left — both arms sweep together
      const pp = this._easeOutBack((p - 0.25) / 0.35);
      torsoGroup.rotation.y = this._lerp(-0.60, 0.50, pp);
      torsoGroup.rotation.z = -0.12 * Math.sin(pp * Math.PI);
      torsoGroup.position.y = 0.05 - 0.05 * (1 - pp);

      // Right arm sweeps the sword in a broad forward arc
      rightArmGroup.rotation.x = this._lerp(0.30, 0.55, pp);
      rightArmGroup.rotation.z = this._lerp(-0.70, 0.50, pp);
      rightForearmGroup.rotation.x = this._lerp(-0.50, -0.85, pp);

      // Left arm tracks sword grip — two-handed swing illusion
      leftArmGroup.rotation.x = this._lerp(0.40, 0.60, pp);
      leftArmGroup.rotation.z = this._lerp(-0.15, 0.40, pp);
      leftForearmGroup.rotation.x = this._lerp(-0.65, -0.90, pp);

      // Keep blade pitched forward throughout swing — arc stays in front of body
      swordGroup.rotation.x = this._lerp(0.45, 0.30, pp);
      swordGroup.rotation.z = this._lerp(-0.25, -0.15, pp);

      headGroup.rotation.y = this._lerp(-0.15, 0.10, pp);
    } else {
      // Phase 3: Follow-through and recovery
      const pp = this._easeOutCubic((p - 0.60) / 0.40);
      torsoGroup.rotation.y = this._lerp(0.50, 0, pp);
      torsoGroup.rotation.z = this._lerp(-0.06, 0, pp);
      torsoGroup.position.y = 0.05;

      // Right arm recovers to carry
      rightArmGroup.rotation.x = this._lerp(0.55, 0.20, pp);
      rightArmGroup.rotation.z = this._lerp(0.50, -0.40, pp);
      rightForearmGroup.rotation.x = this._lerp(-0.85, -0.55, pp);

      // Left arm releases and returns to side
      leftArmGroup.rotation.x = this._lerp(0.60, 0.00, pp);
      leftArmGroup.rotation.z = this._lerp(0.40, 0.20, pp);
      leftForearmGroup.rotation.x = this._lerp(-0.90, -0.15, pp);

      swordGroup.rotation.x = this._lerp(0.30, 0.90, pp);
      swordGroup.rotation.z = this._lerp(-0.15, -0.10, pp);

      headGroup.rotation.y = this._lerp(0.10, 0, pp);
    }
  }

  // ── Attack Light 2 ──────────────────────────────────────────────────────
  // Rising diagonal left-to-right slash — Dark Souls greatsword R1 #2

  private animateAttackLight2(t: number, dur: number): void {
    const { torsoGroup, leftArmGroup, rightArmGroup,
      leftForearmGroup, rightForearmGroup,
      leftLegGroup, swordGroup } = this.model;

    const p = t / dur;
    torsoGroup.scale.set(1, 1, 1);

    if (p < 0.20) {
      // Phase 1: Wind-up — sword drops low on left side, left arm grips lower handle
      const pp = this._easeOutCubic(p / 0.20);
      torsoGroup.rotation.y = 0.35 * pp;
      torsoGroup.position.y = 0.05;

      // Right arm reaches across to left side, low
      rightArmGroup.rotation.x = this._lerp(0.20, 0.30, pp);
      rightArmGroup.rotation.z = this._lerp(-0.40, 0.55, pp);
      rightForearmGroup.rotation.x = this._lerp(-0.55, -0.50, pp);

      // Left arm grips near the lower grip / pommel area
      leftArmGroup.rotation.x = this._lerp(0.00, 0.25, pp);
      leftArmGroup.rotation.z = this._lerp(0.20, 0.60, pp);
      leftForearmGroup.rotation.x = this._lerp(-0.15, -0.55, pp);

      // Sword tilts forward in forearm space — prevents clipping on upswing
      swordGroup.rotation.z = this._lerp(-0.10, 0.25, pp);
      swordGroup.rotation.x = this._lerp(0.90, 0.20, pp);

      leftLegGroup.rotation.x = 0.15 * pp;
    } else if (p < 0.55) {
      // Phase 2: Rising diagonal slash low-left to upper-right
      const pp = this._easeOutBack((p - 0.20) / 0.35);
      torsoGroup.rotation.y = this._lerp(0.35, -0.45, pp);
      torsoGroup.position.y = 0.05 + 0.03 * pp;
      torsoGroup.rotation.z = 0.10 * Math.sin(pp * Math.PI);

      // Right arm lifts sword upward and across to the right
      rightArmGroup.rotation.x = this._lerp(0.30, 0.70, pp);
      rightArmGroup.rotation.z = this._lerp(0.55, -0.25, pp);
      rightForearmGroup.rotation.x = this._lerp(-0.50, -1.00, pp);

      // Left arm tracks the rising swing — two-handed lift
      leftArmGroup.rotation.x = this._lerp(0.25, 0.65, pp);
      leftArmGroup.rotation.z = this._lerp(0.60, 0.25, pp);
      leftForearmGroup.rotation.x = this._lerp(-0.55, -1.05, pp);

      // Sword sweeps upward — arc stays in front of body (positive x keeps blade forward)
      swordGroup.rotation.z = this._lerp(0.25, -0.40, pp);
      swordGroup.rotation.x = this._lerp(0.20, 0.35, pp);

      leftLegGroup.rotation.x = this._lerp(0.15, 0, pp);
    } else {
      // Phase 3: Recovery — sword high on right side, arms return
      const pp = this._easeOutCubic((p - 0.55) / 0.45);
      torsoGroup.rotation.y = this._lerp(-0.45, 0, pp);
      torsoGroup.position.y = this._lerp(0.08, 0.05, pp);
      torsoGroup.rotation.z = 0;

      // Right arm returns to carry
      rightArmGroup.rotation.x = this._lerp(0.70, 0.20, pp);
      rightArmGroup.rotation.z = this._lerp(-0.25, -0.40, pp);
      rightForearmGroup.rotation.x = this._lerp(-1.00, -0.55, pp);

      // Left arm releases and falls back to side
      leftArmGroup.rotation.x = this._lerp(0.65, 0.00, pp);
      leftArmGroup.rotation.z = this._lerp(0.25, 0.20, pp);
      leftForearmGroup.rotation.x = this._lerp(-1.05, -0.15, pp);

      swordGroup.rotation.z = this._lerp(-0.40, -0.10, pp);
      swordGroup.rotation.x = this._lerp(0.35, 0.90, pp);

      leftLegGroup.rotation.x = 0;
    }
  }

  // ── Attack Light 3 ──────────────────────────────────────────────────────
  // Devastating overhead slam — Dark Souls greatsword R1 #3

  private animateAttackLight3(t: number, dur: number): void {
    const { torsoGroup, headGroup, leftArmGroup, rightArmGroup,
      leftForearmGroup, rightForearmGroup,
      leftLegGroup, rightLegGroup, swordGroup } = this.model;

    const p = t / dur;
    torsoGroup.scale.set(1, 1, 1);

    if (p < 0.40) {
      // Phase 1: Wind-up — raise sword HIGH overhead with dramatic pause
      const pp = this._easeOutCubic(p / 0.40);

      // Right arm (sword arm) rises way above head
      rightArmGroup.rotation.x = this._lerp(0.20, -1.60, pp);
      rightArmGroup.rotation.z = this._lerp(-0.40, -0.10, pp);
      rightForearmGroup.rotation.x = this._lerp(-0.55, -0.20, pp);

      // Left arm also lifts to grip near the lower handle
      leftArmGroup.rotation.x = this._lerp(0.00, -1.40, pp);
      leftArmGroup.rotation.z = this._lerp(0.20, 0.10, pp);
      leftForearmGroup.rotation.x = this._lerp(-0.15, -0.15, pp);

      // Sword rises overhead in forearm space — blade stays pitched forward (positive x = forward tilt)
      swordGroup.rotation.x = this._lerp(0.90, 0.80, pp);
      swordGroup.rotation.z = this._lerp(-0.10, 0, pp);

      // Warrior rises slightly, torso arches back
      torsoGroup.position.y = 0.05 + 0.06 * pp;
      torsoGroup.rotation.x = -0.15 * pp;

      // Head tilts up to look at sword
      headGroup.rotation.x = -0.20 * pp;
      headGroup.rotation.y = 0;
    } else if (p < 0.65) {
      // Phase 2: EXPLOSIVE downward SLAM — both arms drive forward, arc in front of body
      const raw = (p - 0.40) / 0.25;
      const pp = this._easeInCubic(raw);

      // Right arm crashes down and forward (NOT through the torso — arms are angled forward)
      rightArmGroup.rotation.x = this._lerp(-1.60, 0.80, pp);
      rightArmGroup.rotation.z = this._lerp(-0.10, -0.10, pp);
      rightForearmGroup.rotation.x = this._lerp(-0.20, -1.10, pp);

      // Left arm slams down alongside the right — full bodyweight
      leftArmGroup.rotation.x = this._lerp(-1.40, 0.65, pp);
      leftArmGroup.rotation.z = this._lerp(0.10, 0.10, pp);
      leftForearmGroup.rotation.x = this._lerp(-0.15, -1.20, pp);

      // Sword swings down and forward in forearm space — arc stays in front
      swordGroup.rotation.x = this._lerp(0.80, 1.00, pp);
      swordGroup.rotation.z = 0;

      // Torso CRUNCHES forward — full bodyweight into the strike
      torsoGroup.rotation.x = this._lerp(-0.15, 0.30, pp);
      torsoGroup.position.y = this._lerp(0.11, -0.07, pp);

      // Knees buckle from the force
      leftLegGroup.rotation.x  = 0.30 * pp;
      rightLegGroup.rotation.x = 0.30 * pp;

      headGroup.rotation.x = this._lerp(-0.20, 0.10, pp);
    } else {
      // Phase 3: Impact recovery — long and committed, slowly rise back
      const pp = this._easeOutCubic((p - 0.65) / 0.35);

      // Right arm returns to carry
      rightArmGroup.rotation.x = this._lerp(0.80, 0.20, pp);
      rightArmGroup.rotation.z = this._lerp(-0.10, -0.40, pp);
      rightForearmGroup.rotation.x = this._lerp(-1.10, -0.55, pp);

      // Left arm releases and falls to side
      leftArmGroup.rotation.x = this._lerp(0.65, 0.00, pp);
      leftArmGroup.rotation.z = this._lerp(0.10, 0.20, pp);
      leftForearmGroup.rotation.x = this._lerp(-1.20, -0.15, pp);

      swordGroup.rotation.x = this._lerp(1.00, 0.90, pp);
      swordGroup.rotation.z = this._lerp(0, -0.10, pp);

      torsoGroup.rotation.x = this._lerp(0.30, 0, pp);
      torsoGroup.position.y = this._lerp(-0.07, 0.05, pp);

      leftLegGroup.rotation.x  = this._lerp(0.30, 0, pp);
      rightLegGroup.rotation.x = this._lerp(0.30, 0, pp);

      headGroup.rotation.x = this._lerp(0.10, 0, pp);
    }
  }

  // ── Attack Heavy ────────────────────────────────────────────────────────
  // Full 360° spin slash — both arms extended for maximum reach

  private animateAttackHeavy(t: number, dur: number): void {
    const { torsoGroup, leftArmGroup, rightArmGroup,
      leftForearmGroup, rightForearmGroup, swordGroup } = this.model;

    const p = t / dur;

    // Spin the entire torso 360°
    torsoGroup.rotation.y = p * Math.PI * 2;

    // Vertical bob — dip at start, rise during spin
    torsoGroup.position.y = 0.05 - Math.sin(p * Math.PI) * 0.06;

    // Both arms converge on sword grip — left arm reaches across body to hold hilt
    rightArmGroup.rotation.x = 0.30;
    rightArmGroup.rotation.z = -0.60;
    leftArmGroup.rotation.x  = 0.30;
    leftArmGroup.rotation.z  = -0.25;

    // Forearms reach toward grip — left elbow bent to close the distance to hilt
    rightForearmGroup.rotation.x = -0.25;
    leftForearmGroup.rotation.x  = -0.70;

    // Sword extends outward in forearm-local space for maximum reach
    swordGroup.rotation.x = 0.20;
    swordGroup.rotation.z = 0.10;

    torsoGroup.scale.set(1, 1, 1);
  }

  // ── Hit ─────────────────────────────────────────────────────────────────

  private animateHit(t: number, dur: number): void {
    const { torsoGroup, leftArmGroup, rightArmGroup,
      leftForearmGroup, rightForearmGroup } = this.model;

    const p = t / dur;
    // Brief flinch backward, right arm pulls sword close (protective)
    torsoGroup.rotation.x = Math.sin(p * Math.PI) * (-0.3);
    torsoGroup.scale.set(1, 1, 1);

    const curl = Math.sin(p * Math.PI) * 0.4;
    // Right arm curls sword close protectively
    rightForearmGroup.rotation.x = -0.55 - curl;
    rightArmGroup.rotation.x = 0.20 + curl * 0.5;

    // Left arm reacts independently — jerks back from impact
    leftArmGroup.rotation.x = 0.00 + curl * 0.3;
    leftForearmGroup.rotation.x = -0.15 - curl * 0.3;

    this._q.setFromEuler(this._e.set(0, 0, 0));
  }

  // ── Death ───────────────────────────────────────────────────────────────

  private animateDeath(t: number, dur: number): void {
    const { torsoGroup, leftArmGroup, rightArmGroup,
      leftForearmGroup, rightForearmGroup,
      leftLegGroup, rightLegGroup, swordGroup } = this.model;

    const p = Math.min(t / dur, 1);

    if (p < 0.4) {
      // Collapse to knees — arms go limp
      const pp = p / 0.4;
      leftLegGroup.rotation.x  = pp * 1.3;
      rightLegGroup.rotation.x = pp * 1.3;
      torsoGroup.rotation.x    = pp * 0.4;
      torsoGroup.position.y    = 0.05 - pp * 0.5;

      // Right arm drops limply — sword loosens from grip
      rightArmGroup.rotation.x = this._lerp(0.20, 1.20, pp);
      rightArmGroup.rotation.z = this._lerp(-0.40, -0.65, pp);
      rightForearmGroup.rotation.x = this._lerp(-0.55, -0.20, pp);

      // Left arm drops limply
      leftArmGroup.rotation.x = this._lerp(0.00, 1.20, pp);
      leftArmGroup.rotation.z = this._lerp(0.20, 0.65, pp);
      leftForearmGroup.rotation.x = this._lerp(-0.15, -0.30, pp);

      // Sword rotates away as grip loosens (forearm-local space)
      swordGroup.rotation.x = this._lerp(0.90, 1.40, pp);
    } else {
      // Fall forward face-down — sword fully dropped
      const pp = (p - 0.4) / 0.6;
      leftLegGroup.rotation.x  = 1.3;
      rightLegGroup.rotation.x = 1.3;
      torsoGroup.rotation.x    = 0.4 + pp * 1.0;
      torsoGroup.position.y    = 0.05 - 0.5 - pp * 0.3;

      // Arms fully limp
      rightArmGroup.rotation.x = 1.20 + pp * 0.30;
      leftArmGroup.rotation.x  = 1.20 + pp * 0.30;

      rightForearmGroup.rotation.x = -0.20 + pp * 0.30;
      leftForearmGroup.rotation.x  = -0.30 + pp * 0.30;

      // Sword continues to fall away
      swordGroup.rotation.x = 1.40 + pp * 0.80;
    }

    torsoGroup.scale.set(1, 1, 1);
  }

  // ── Dash Attack ────────────────────────────────────────────────────────
  // Forward thrust — both arms extend sword straight ahead

  private animateDashAttack(t: number, dur: number): void {
    const { torsoGroup, leftArmGroup, rightArmGroup,
      leftForearmGroup, rightForearmGroup, swordGroup } = this.model;

    const p = t / dur;
    const swing = Math.sin(p * Math.PI);

    // Forward lean during lunge
    torsoGroup.rotation.x = swing * 0.45;
    torsoGroup.rotation.y = 0;

    // Right arm thrusts sword directly forward
    rightArmGroup.rotation.x = 0.20 - swing * 1.20;
    rightArmGroup.rotation.z = -0.40 + swing * 0.10;

    // Left arm braces the thrust — reaches forward alongside the right (2H illusion)
    leftArmGroup.rotation.x = 0.00 - swing * 1.10;
    leftArmGroup.rotation.z = 0.20 - swing * 0.10;

    // Forearms extend fully for maximum reach
    rightForearmGroup.rotation.x = -0.55 + swing * 0.30;
    leftForearmGroup.rotation.x  = -0.15 + swing * 0.20;

    // Sword points straight ahead in forearm-local space — blade forward, no body clipping
    swordGroup.rotation.x = 0.90 + swing * 0.20;
    swordGroup.rotation.z = -0.10 * (1 - swing);

    torsoGroup.scale.set(1, 1, 1);
  }

  // ── Block ──────────────────────────────────────────────────────────────
  // Shield guard — left forearm raises shield, right keeps sword at side

  private animateBlock(time: number): void {
    const { torsoGroup, leftArmGroup, rightArmGroup,
      leftForearmGroup, rightForearmGroup, swordGroup } = this.model;

    // Slight crouch
    torsoGroup.position.y = 0.0 + Math.sin(time * 1.2) * 0.005;
    torsoGroup.rotation.x = 0.08;

    // Left arm raises shield across chest
    leftArmGroup.rotation.x = -0.8;
    leftArmGroup.rotation.z =  0.4;
    leftForearmGroup.rotation.x = -1.5; // forearm lifts shield up

    // Right arm keeps sword in guard position (sword is on the right forearm)
    rightArmGroup.rotation.x = 0.30;
    rightArmGroup.rotation.z = -0.10;
    rightForearmGroup.rotation.x = -0.70;

    // Sword held upright in guard stance (forearm-local space)
    swordGroup.rotation.x = 0.10;
    swordGroup.rotation.z = -0.10;

    torsoGroup.scale.set(1, 1, 1);
  }

  // ── Shield Bash ────────────────────────────────────────────────────────
  // Left forearm punches forward with shield

  private animateShieldBash(t: number, dur: number): void {
    const { torsoGroup, leftArmGroup, leftForearmGroup } = this.model;

    const p = t / dur;
    const swing = Math.sin(p * Math.PI);

    // Left arm thrusts forward
    leftArmGroup.rotation.x = -0.8 + swing * 0.6;
    leftArmGroup.rotation.z = 0.4 - swing * 0.15;
    // Forearm punches forward
    leftForearmGroup.rotation.x = -1.5 + swing * 1.0;

    torsoGroup.rotation.x = 0.08 + swing * 0.15;
    torsoGroup.scale.set(1, 1, 1);
  }
}

