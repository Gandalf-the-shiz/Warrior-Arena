/**
 * XP & Leveling system for within-run character progression.
 *
 * XP sources: Skeleton=10, Ghoul=15, Brute=25, Boss=100.
 * Style rank multiplier: D=1x, C=1.5x, B=2x, A=3x, S=5x.
 *
 * Levels 1–10 with increasing XP thresholds.
 * Each level-up grants +10 max HP, +5 max stamina, +5% damage, +2% speed.
 */
import type { StyleRank } from '@/game/StyleMeter';

export type EnemyXPType = 'SKELETON' | 'GHOUL' | 'BRUTE' | 'BOSS';

const XP_PER_TYPE: Record<EnemyXPType, number> = {
  SKELETON: 10,
  GHOUL: 15,
  BRUTE: 25,
  BOSS: 100,
};

const RANK_MULTIPLIER: Record<StyleRank, number> = {
  D: 1.0,
  C: 1.5,
  B: 2.0,
  A: 3.0,
  S: 5.0,
};

/** XP required to REACH each level (level 1 = 0 XP threshold). */
const LEVEL_THRESHOLDS = [0, 0, 100, 250, 500, 800, 1200, 1700, 2500, 3500, 5000];
const MAX_LEVEL = 10;

export class LevelSystem {
  private _level = 1;
  private _xp = 0;
  private _levelsGained = 0; // counter so caller can detect new level-ups

  // Accumulated bonuses from level-ups
  private _maxHpBonus = 0;
  private _maxStaminaBonus = 0;
  private _damageMultiplier = 1.0; // 1.0 + 5% per level above 1
  private _speedMultiplier = 1.0;  // 1.0 + 2% per level above 1

  /** Optional callback fired whenever a level-up occurs. */
  onLevelUp: ((newLevel: number) => void) | null = null;

  get level(): number { return this._level; }
  get xp(): number { return this._xp; }

  /** XP needed to reach next level (0 at max level). */
  get xpToNextLevel(): number {
    if (this._level >= MAX_LEVEL) return 0;
    return (LEVEL_THRESHOLDS[this._level + 1] ?? 0) - (LEVEL_THRESHOLDS[this._level] ?? 0);
  }

  /** XP accumulated toward current level threshold. */
  get xpInCurrentLevel(): number {
    return this._xp - (LEVEL_THRESHOLDS[this._level] ?? 0);
  }

  /** 0–1 fill fraction for current level's XP bar. */
  get xpFraction(): number {
    if (this._level >= MAX_LEVEL) return 1.0;
    const needed = this.xpToNextLevel;
    return needed > 0 ? Math.min(1, this.xpInCurrentLevel / needed) : 1;
  }

  getLevel(): number { return this._level; }
  getDamageMultiplier(): number { return this._damageMultiplier; }
  getSpeedMultiplier(): number { return this._speedMultiplier; }
  getMaxHpBonus(): number { return this._maxHpBonus; }
  getMaxStaminaBonus(): number { return this._maxStaminaBonus; }

  /**
   * Award XP for an enemy kill.
   * @param type  Enemy type for base XP value.
   * @param rank  Current style rank for multiplier.
   */
  addXP(type: EnemyXPType, rank: StyleRank): void {
    const base = XP_PER_TYPE[type] ?? 10;
    const mult = RANK_MULTIPLIER[rank] ?? 1.0;
    this._xp += Math.round(base * mult);
    this.checkLevelUp();
  }

  private checkLevelUp(): void {
    while (this._level < MAX_LEVEL) {
      const needed = LEVEL_THRESHOLDS[this._level + 1] ?? Infinity;
      if (this._xp < needed) break;
      this._level++;
      this._levelsGained++;
      // Apply per-level bonuses
      this._maxHpBonus += 10;
      this._maxStaminaBonus += 5;
      this._damageMultiplier = 1.0 + (this._level - 1) * 0.05;
      this._speedMultiplier  = 1.0 + (this._level - 1) * 0.02;
      this.onLevelUp?.(this._level);
    }
  }
}
