/**
 * SkillSystem — tracks active temporary buffs granted between waves.
 * Durations are measured in waves (decremented when a new wave starts).
 *
 * PlayerController reads getters from SkillSystem to apply modifiers.
 */

export interface SkillEffect {
  id: SkillId;
  wavesRemaining: number;
}

export type SkillId =
  | 'sharpened_blade'
  | 'iron_skin'
  | 'lightning_reflexes'
  | 'second_wind'
  | 'burning_strikes'
  | 'ghost_step'
  | 'berserker_rage'
  | 'soul_harvest'
  | 'arena_champion';

export type SkillRarity = 'Common' | 'Rare' | 'Epic' | 'Legendary';

export interface SkillDefinition {
  id: SkillId;
  name: string;
  description: string;
  icon: string;
  rarity: SkillRarity;
  waveDuration: number; // 0 = instant
}

export const ALL_SKILLS: SkillDefinition[] = [
  {
    id: 'sharpened_blade',
    name: 'Sharpened Blade',
    description: '+25% damage for 2 waves',
    icon: '🗡️',
    rarity: 'Common',
    waveDuration: 2,
  },
  {
    id: 'iron_skin',
    name: 'Iron Skin',
    description: '-30% damage taken for 2 waves',
    icon: '🛡️',
    rarity: 'Common',
    waveDuration: 2,
  },
  {
    id: 'lightning_reflexes',
    name: 'Lightning Reflexes',
    description: '+50% move speed for 1 wave',
    icon: '⚡',
    rarity: 'Rare',
    waveDuration: 1,
  },
  {
    id: 'second_wind',
    name: 'Second Wind',
    description: 'Restore 50 HP immediately',
    icon: '❤️',
    rarity: 'Common',
    waveDuration: 0,
  },
  {
    id: 'burning_strikes',
    name: 'Burning Strikes',
    description: 'Attacks deal +5 bonus fire damage for 2 waves',
    icon: '🔥',
    rarity: 'Rare',
    waveDuration: 2,
  },
  {
    id: 'ghost_step',
    name: 'Ghost Step',
    description: 'Dodge cooldown halved, longer i-frames for 2 waves',
    icon: '💨',
    rarity: 'Rare',
    waveDuration: 2,
  },
  {
    id: 'berserker_rage',
    name: 'Berserker Rage',
    description: '+75% damage but -25% max HP for 3 waves',
    icon: '⚔️',
    rarity: 'Epic',
    waveDuration: 3,
  },
  {
    id: 'soul_harvest',
    name: 'Soul Harvest',
    description: 'Killing an enemy restores 10 HP for 2 waves',
    icon: '💀',
    rarity: 'Epic',
    waveDuration: 2,
  },
  {
    id: 'arena_champion',
    name: 'Arena Champion',
    description: 'All stats +20% for 1 wave',
    icon: '🌟',
    rarity: 'Legendary',
    waveDuration: 1,
  },
];

export const RARITY_COLORS: Record<SkillRarity, string> = {
  Common:    '#aaaaaa',
  Rare:      '#4488ff',
  Epic:      '#aa44ff',
  Legendary: '#ffaa00',
};

/**
 * Manages active skill effects and exposes stat multipliers.
 */
export class SkillSystem {
  private readonly activeEffects: SkillEffect[] = [];

  /** Called when a new wave starts — decrements wave durations and prunes expired effects. */
  onNewWave(): void {
    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const effect = this.activeEffects[i]!;
      if (effect.wavesRemaining > 0) {
        effect.wavesRemaining--;
      }
      if (effect.wavesRemaining === 0) {
        this.activeEffects.splice(i, 1);
      }
    }
  }

  /** Apply a skill. Instant skills (waveDuration=0) are not stored. */
  applySkill(def: SkillDefinition, player: { hp: number; maxHp: number }): void {
    if (def.id === 'second_wind') {
      // Instant heal
      player.hp = Math.min(player.hp + 50, player.maxHp);
      return;
    }
    if (def.waveDuration === 0) return;

    // Remove existing effect with same id to avoid stacking
    const existing = this.activeEffects.findIndex(e => e.id === def.id);
    if (existing !== -1) {
      this.activeEffects.splice(existing, 1);
    }
    this.activeEffects.push({ id: def.id, wavesRemaining: def.waveDuration });
  }

  isActive(id: SkillId): boolean {
    return this.activeEffects.some(e => e.id === id);
  }

  /** Total damage multiplier from all active skills. */
  getDamageMultiplier(): number {
    let mult = 1.0;
    if (this.isActive('sharpened_blade')) mult += 0.25;
    if (this.isActive('burning_strikes')) mult += 0.1; // proxy for +5 damage
    if (this.isActive('berserker_rage')) mult += 0.75;
    if (this.isActive('arena_champion')) mult += 0.20;
    return mult;
  }

  /** Damage reduction multiplier (lower = less damage taken). */
  getDefenseMultiplier(): number {
    let mult = 1.0;
    if (this.isActive('iron_skin')) mult -= 0.30;
    if (this.isActive('berserker_rage')) mult += 0.0; // no defense penalty at this time
    if (this.isActive('arena_champion')) mult -= 0.20;
    return Math.max(0.1, mult);
  }

  /** Move speed multiplier. */
  getMoveSpeedMultiplier(): number {
    let mult = 1.0;
    if (this.isActive('lightning_reflexes')) mult += 0.50;
    if (this.isActive('arena_champion')) mult += 0.20;
    return mult;
  }

  /** Dodge cooldown multiplier (lower = faster). */
  getDodgeCooldownMultiplier(): number {
    let mult = 1.0;
    if (this.isActive('ghost_step')) mult *= 0.5;
    return mult;
  }

  /** Whether bonus i-frames are active during dodge. */
  hasBonusIFrames(): boolean {
    return this.isActive('ghost_step') || this.isActive('arena_champion');
  }

  /** Whether soul harvest (on-kill heal) is active. */
  hasSoulHarvest(): boolean {
    return this.isActive('soul_harvest');
  }

  /** Whether burning strikes trail glow should be shown. */
  hasBurningStrikes(): boolean {
    return this.isActive('burning_strikes');
  }

  /** Get list of currently active effects (for display purposes). */
  getActiveEffects(): readonly SkillEffect[] {
    return this.activeEffects;
  }

  /** Pick 3 random skills from the pool, weighted by rarity. */
  static pickRandomSkills(count = 3): SkillDefinition[] {
    const pool = [...ALL_SKILLS];
    const picked: SkillDefinition[] = [];
    while (picked.length < count && pool.length > 0) {
      const idx = Math.floor(Math.random() * pool.length);
      picked.push(pool.splice(idx, 1)[0]!);
    }
    return picked;
  }
}
