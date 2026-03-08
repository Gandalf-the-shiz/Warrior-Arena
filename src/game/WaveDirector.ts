import { EnemyType } from '@/game/Enemy';

// ---------------------------------------------------------------------------
// Budget costs — heavier enemies cost more points so wave density stays sane
// ---------------------------------------------------------------------------
const ENEMY_COST: Record<EnemyType, number> = {
  [EnemyType.SKELETON]: 1,
  [EnemyType.GHOUL]:    1,
  [EnemyType.BRUTE]:    3,
};

// ---------------------------------------------------------------------------
// Wave archetype — describes the tactical intent of a wave
// ---------------------------------------------------------------------------
/** Describes the tactical intent of a wave. */
export type WaveArchetype =
  | 'baseline'      // Skeleton-led intro wave; sparse and readable
  | 'swarm'         // Ghoul rush; fast pressure, fragile enemies
  | 'mixed'         // Skeleton anchor + ghoul harassment
  | 'brute_anchor'  // 1–2 Brutes with skeleton support
  | 'pressure';     // Dense skeleton/ghoul assault; sustained chaos

interface WaveRecipe {
  archetype: WaveArchetype;
  /** Total budget points to spend on this wave. */
  budget: number;
  /** Hard cap on total enemies (prevents pure budget spam). */
  cap: number;
  /** Units guaranteed before budget fill-in (placed first). */
  guaranteed: EnemyType[];
  /** Weighted pool used to fill remaining budget. */
  fillPool: { type: EnemyType; weight: number }[];
}

// ---------------------------------------------------------------------------
// Authored wave recipes (waves 1–8)
// Waves 9+ use the escalating pressure recipe
// ---------------------------------------------------------------------------
function recipeForWave(wave: number): WaveRecipe {
  switch (wave) {
    // Wave 1 — pure baseline: teach enemy spacing and attack timing
    case 1: return {
      archetype: 'baseline',
      budget: 4, cap: 4,
      guaranteed: [],
      fillPool: [{ type: EnemyType.SKELETON, weight: 1 }],
    };

    // Wave 2 — baseline + ghoul tease: one fast enemy previews the next threat
    case 2: return {
      archetype: 'baseline',
      budget: 6, cap: 6,
      guaranteed: [],
      fillPool: [
        { type: EnemyType.SKELETON, weight: 4 },
        { type: EnemyType.GHOUL,    weight: 1 },
      ],
    };

    // Wave 3 — mixed: skeletons anchor while ghouls pressure
    case 3: return {
      archetype: 'mixed',
      budget: 7, cap: 7,
      guaranteed: [EnemyType.SKELETON, EnemyType.GHOUL],
      fillPool: [
        { type: EnemyType.SKELETON, weight: 2 },
        { type: EnemyType.GHOUL,    weight: 3 },
      ],
    };

    // Wave 4 — ghoul swarm: fast pressure, rewards aggressive play
    case 4: return {
      archetype: 'swarm',
      budget: 8, cap: 8,
      guaranteed: [EnemyType.GHOUL, EnemyType.GHOUL],
      fillPool: [
        { type: EnemyType.GHOUL,    weight: 3 },
        { type: EnemyType.SKELETON, weight: 1 },
      ],
    };

    // Wave 5 — brute anchor: first real brute; skeletons provide supporting pressure
    case 5: return {
      archetype: 'brute_anchor',
      budget: 9, cap: 7,
      guaranteed: [EnemyType.BRUTE],
      fillPool: [
        { type: EnemyType.SKELETON, weight: 3 },
        { type: EnemyType.GHOUL,    weight: 1 },
      ],
    };

    // Wave 6 — pressure: dense mixed assault; rewards crowd control
    case 6: return {
      archetype: 'pressure',
      budget: 11, cap: 10,
      guaranteed: [EnemyType.SKELETON, EnemyType.SKELETON],
      fillPool: [
        { type: EnemyType.SKELETON, weight: 2 },
        { type: EnemyType.GHOUL,    weight: 3 },
      ],
    };

    // Wave 7 — heavy anchor: two brutes create overlapping threat zones
    case 7: return {
      archetype: 'brute_anchor',
      budget: 12, cap: 10,
      guaranteed: [EnemyType.BRUTE, EnemyType.SKELETON],
      fillPool: [
        { type: EnemyType.SKELETON, weight: 2 },
        { type: EnemyType.GHOUL,    weight: 2 },
      ],
    };

    // Wave 8 — full mixed roster: all three archetypes in earnest
    case 8: return {
      archetype: 'mixed',
      budget: 13, cap: 11,
      guaranteed: [EnemyType.BRUTE, EnemyType.GHOUL],
      fillPool: [
        { type: EnemyType.SKELETON, weight: 2 },
        { type: EnemyType.GHOUL,    weight: 2 },
        { type: EnemyType.BRUTE,    weight: 1 },
      ],
    };

    // Wave 9+ — escalating pressure; budget and cap grow with each wave
    default: {
      const extra  = wave - 8;
      const budget = Math.min(13 + Math.floor(extra * 1.5), 24);
      const cap    = Math.min(11 + Math.floor(extra * 0.75), 16);
      return {
        archetype: 'pressure',
        budget, cap,
        guaranteed: [EnemyType.BRUTE, EnemyType.SKELETON],
        fillPool: [
          { type: EnemyType.SKELETON, weight: 2 },
          { type: EnemyType.GHOUL,    weight: 3 },
          { type: EnemyType.BRUTE,    weight: 1 },
        ],
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Weighted random pick
// ---------------------------------------------------------------------------
function pickFromPool(pool: { type: EnemyType; weight: number }[]): EnemyType {
  const total = pool.reduce((s, e) => s + e.weight, 0);
  let roll = Math.random() * total;
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll <= 0) return entry.type;
  }
  return pool[pool.length - 1]!.type;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compose an enemy roster for the given wave number (1-based).
 *
 * Uses a budget/archetype model so each wave has a deliberate feel rather
 * than purely scaling by raw count.  Guaranteed units are placed first;
 * remaining budget is filled from the wave's weighted pool up to the cap.
 *
 * @returns Ordered array of EnemyType values (shuffle before spawning for
 *          even arena distribution).
 */
export function composeWave(wave: number): EnemyType[] {
  const recipe = recipeForWave(wave);
  const roster: EnemyType[] = [...recipe.guaranteed];

  let remaining =
    recipe.budget - roster.reduce((sum, enemyType) => sum + ENEMY_COST[enemyType], 0);

  // Fill remaining budget with affordable pool picks
  while (remaining > 0 && roster.length < recipe.cap) {
    const affordable = recipe.fillPool.filter(e => ENEMY_COST[e.type] <= remaining);
    if (affordable.length === 0) break;
    const chosen = pickFromPool(affordable);
    roster.push(chosen);
    remaining -= ENEMY_COST[chosen];
  }

  return roster;
}

/**
 * Return the archetype label for the given wave (useful for UI or debug).
 */
export function waveArchetype(wave: number): WaveArchetype {
  return recipeForWave(wave).archetype;
}
