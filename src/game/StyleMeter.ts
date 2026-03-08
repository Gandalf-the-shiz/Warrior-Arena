/**
 * Style Meter — tracks successive hits without taking damage.
 *
 * Ranks: D (0-2) → C (3-5) → B (6-9) → A (10-14) → S (15+)
 * - Taking damage instantly resets to D.
 * - Rank decays back toward D after 4 seconds of no hits.
 */
export type StyleRank = 'D' | 'C' | 'B' | 'A' | 'S';

const RANK_THRESHOLDS: Array<{ rank: StyleRank; min: number }> = [
  { rank: 'S', min: 15 },
  { rank: 'A', min: 10 },
  { rank: 'B', min: 6  },
  { rank: 'C', min: 3  },
  { rank: 'D', min: 0  },
];

const DECAY_DELAY = 4.0;   // seconds before decay starts
const DECAY_RATE  = 3.0;   // combo-count points lost per second during decay

export class StyleMeter {
  private comboCount = 0;
  private decayTimer = 0;   // countdown; when 0 decay kicks in

  get rank(): StyleRank {
    const count = Math.floor(this.comboCount);
    for (const { rank, min } of RANK_THRESHOLDS) {
      if (count >= min) return rank;
    }
    return 'D';
  }

  get combo(): number {
    return Math.floor(this.comboCount);
  }

  /** Call when the player successfully lands a hit. */
  registerHit(): void {
    this.comboCount++;
    this.decayTimer = DECAY_DELAY;
  }

  /** Call when the player takes damage — resets everything. */
  onPlayerDamage(): void {
    this.comboCount = 0;
    this.decayTimer = 0;
  }

  /** Update decay logic — call once per visual frame. */
  update(delta: number): void {
    if (this.comboCount <= 0) {
      this.comboCount = 0;
      return;
    }

    if (this.decayTimer > 0) {
      this.decayTimer -= delta;
    } else {
      // Decay toward 0 after the idle window expires
      this.comboCount = Math.max(0, this.comboCount - DECAY_RATE * delta);
    }
  }
}
