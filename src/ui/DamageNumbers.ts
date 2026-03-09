import * as THREE from 'three';
import { StyleRank } from '@/game/StyleMeter';

const FONT_FAMILY = "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif";
const DURATION    = 1.0;   // seconds a number is visible
const FLOAT_PX_S  = 55;    // upward screen drift, pixels per second

interface DamageNumber {
  el:      HTMLDivElement;
  worldPos: THREE.Vector3;
  screenX: number;
  screenY: number;
  vx: number;   // horizontal drift px/s
  vy: number;   // vertical drift px/s (negative = upward)
  age: number;
  alive: boolean;
}

/**
 * DamageNumbers — DOM floating numbers that rise from the hit position.
 *
 * Colour coding:
 *   • White   — normal light attacks
 *   • Red     — heavy attacks (≥ HEAVY threshold)
 *   • Gold    — combo finisher (ATTACK_LIGHT_3)
 *
 * When style rank is A or S a subtle glow is added to the text.
 *
 * Call `spawn()` from the combat hit callback and `update()` every visual frame.
 */
export class DamageNumbers {
  private readonly container: HTMLDivElement;
  private readonly pool: DamageNumber[] = [];
  private readonly projected = new THREE.Vector3();

  constructor(private readonly camera: THREE.Camera) {
    this.container = document.createElement('div');
    Object.assign(this.container.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '15',
      overflow: 'hidden',
    });
    document.body.appendChild(this.container);
  }

  /**
   * Spawn a floating damage number at a 3D world position.
   *
   * @param worldPos   3D position of the hit (e.g. enemy position + Y offset).
   * @param damage     Damage value to display.
   * @param isHeavy    True if this was a heavy attack (red colour).
   * @param isFinisher True if this was the ATTACK_LIGHT_3 finisher (gold colour).
   * @param styleRank  Current style rank — adds glow at A/S.
   */
  spawn(
    worldPos: THREE.Vector3,
    damage: number,
    isHeavy: boolean,
    isFinisher: boolean,
    styleRank: StyleRank,
  ): void {
    // Reuse an inactive pool entry, or allocate a new one
    let num = this.pool.find((n) => !n.alive);

    if (!num) {
      const el = document.createElement('div');
      Object.assign(el.style, {
        position:    'absolute',
        fontFamily:  FONT_FAMILY,
        fontWeight:  'bold',
        pointerEvents: 'none',
        userSelect:  'none',
        display:     'none',
        whiteSpace:  'nowrap',
      });
      this.container.appendChild(el);

      num = {
        el,
        worldPos: new THREE.Vector3(),
        screenX: 0, screenY: 0,
        vx: 0, vy: 0,
        age: 0,
        alive: false,
      };
      this.pool.push(num);
    }

    // Colour and size
    const color = isHeavy ? '#ff5555' : isFinisher ? '#e8d5a0' : '#ffffff';
    const fontSize = Math.min(30, 13 + damage * 0.28);

    let textShadow = '0 1px 4px rgba(0,0,0,0.9)';
    if (styleRank === 'A' || styleRank === 'S') {
      textShadow = `0 0 10px ${color}, 0 0 18px ${color}, 0 1px 4px rgba(0,0,0,0.9)`;
    }

    const el = num.el;
    el.textContent = String(damage);
    el.style.fontSize   = `${fontSize}px`;
    el.style.color      = color;
    el.style.textShadow = textShadow;
    el.style.opacity    = '1';
    el.style.display    = 'block';

    // Randomise horizontal drift so stacked numbers spread out
    num.worldPos.copy(worldPos);
    num.screenX = 0;
    num.screenY = 0;
    num.vx  = (Math.random() - 0.5) * 44;
    num.vy  = -(FLOAT_PX_S + Math.random() * 22);
    num.age = 0;
    num.alive = true;
  }

  /**
   * Advance all active damage numbers by one frame.
   * @param delta  Seconds since last frame.
   */
  update(delta: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;

    for (const num of this.pool) {
      if (!num.alive) continue;

      num.age += delta;

      if (num.age >= DURATION) {
        num.alive = false;
        num.el.style.display = 'none';
        continue;
      }

      // Project world position on the first frame to initialise screen coords
      if (num.age <= delta + 0.001) {
        this.projected.copy(num.worldPos).project(this.camera);
        if (this.projected.z > 1) {
          num.el.style.display = 'none';
          continue;
        }
        num.screenX = (this.projected.x + 1) * 0.5 * w;
        num.screenY = (1 - this.projected.y) * 0.5 * h;
      }

      // Drift in screen space
      num.screenX += num.vx * delta;
      num.screenY += num.vy * delta;

      // Ease out opacity
      const t = num.age / DURATION;
      const opacity = 1 - t * t;

      num.el.style.left    = `${num.screenX}px`;
      num.el.style.top     = `${num.screenY}px`;
      num.el.style.opacity = String(opacity);
    }
  }
}
