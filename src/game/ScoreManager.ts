/**
 * ScoreManager — persists the player's best run scores in localStorage.
 *
 * Stored under the key `warrior-arena-best`:
 *   { bestWave: number, bestKills: number, bestRank: StyleRank }
 */

import { StyleRank } from '@/game/StyleMeter';

const STORAGE_KEY = 'warrior-arena-best';

const RANK_ORDER: StyleRank[] = ['D', 'C', 'B', 'A', 'S'];

function rankIndex(r: StyleRank): number {
  return RANK_ORDER.indexOf(r);
}

export interface BestScores {
  bestWave: number;
  bestKills: number;
  bestRank: StyleRank;
}

export class ScoreManager {
  /**
   * Save a completed run's scores, updating the persisted best values.
   */
  save(wave: number, kills: number, rank: StyleRank): void {
    const current = this.getBest();
    const next: BestScores = {
      bestWave:  Math.max(current.bestWave,  wave),
      bestKills: Math.max(current.bestKills, kills),
      bestRank:  rankIndex(rank) > rankIndex(current.bestRank) ? rank : current.bestRank,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors (private browsing, quota exceeded, etc.)
    }
  }

  /** Retrieve the persisted best scores. Returns defaults if nothing saved yet. */
  getBest(): BestScores {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<BestScores>;
        return {
          bestWave:  typeof parsed.bestWave  === 'number' ? parsed.bestWave  : 0,
          bestKills: typeof parsed.bestKills === 'number' ? parsed.bestKills : 0,
          bestRank:  RANK_ORDER.includes(parsed.bestRank as StyleRank)
            ? (parsed.bestRank as StyleRank)
            : 'D',
        };
      }
    } catch {
      // JSON parse error or no storage access
    }
    return { bestWave: 0, bestKills: 0, bestRank: 'D' };
  }
}
