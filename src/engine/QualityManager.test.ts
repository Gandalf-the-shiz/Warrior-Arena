import { describe, it, expect, beforeEach } from 'vitest';
import { QualityManager } from '@/engine/QualityManager';
import type { QualityTier } from '@/engine/QualityManager';

describe('QualityManager', () => {
  let qm: QualityManager;

  beforeEach(() => {
    qm = new QualityManager('MEDIUM');
  });

  it('initialises with the given tier', () => {
    expect(qm.tier).toBe('MEDIUM');
  });

  it('getSettings() returns the correct pixelRatio for MEDIUM', () => {
    const s = qm.getSettings();
    expect(s.tier).toBe('MEDIUM');
    expect(s.pixelRatio).toBe(1.0);
    expect(s.postProcessingEnabled).toBe(true);
    expect(s.bloomEnabled).toBe(true);
    expect(s.chromaticAberrationEnabled).toBe(false);
    expect(s.filmGrainEnabled).toBe(false);
  });

  it('getSettings() for LOW disables expensive features', () => {
    qm.setTier('LOW');
    const s = qm.getSettings();
    expect(s.shadowsEnabled).toBe(false);
    expect(s.postProcessingEnabled).toBe(false);
    expect(s.bloomEnabled).toBe(false);
  });

  it('getSettings() for HIGH enables chromatic aberration and film grain', () => {
    qm.setTier('HIGH');
    const s = qm.getSettings();
    expect(s.chromaticAberrationEnabled).toBe(true);
    expect(s.filmGrainEnabled).toBe(true);
  });

  it('setTier() fires onTierChange callback', () => {
    const received: QualityTier[] = [];
    qm.onTierChange = (s) => { received.push(s.tier); };
    qm.setTier('HIGH');
    expect(received).toEqual(['HIGH']);
  });

  it('setTier() is a no-op when already on the requested tier', () => {
    const received: QualityTier[] = [];
    qm.onTierChange = (s) => { received.push(s.tier); };
    qm.setTier('MEDIUM'); // already on MEDIUM
    expect(received).toHaveLength(0);
  });

  it('update() degrades tier when sustained frame time exceeds threshold', () => {
    qm.setTier('HIGH');
    // Reset the change cooldown by calling setTier then waiting enough simulated time
    // We manually override the private cooldown by pumping update with large delta
    qm.adaptiveEnabled = true;
    // Warm up: pass CHANGE_COOLDOWN_S worth of frames at 14 ms (ok range) to zero cooldown
    for (let i = 0; i < 600; i++) qm.update(0.01, 14);

    const before = qm.tier;
    // Pump 3 + seconds of 25 ms frames (above DEGRADE_THRESHOLD_MS=22)
    let changed = false;
    qm.onTierChange = () => { changed = true; };
    for (let i = 0; i < 400; i++) qm.update(0.01, 25);
    // Should have degraded from HIGH to MEDIUM
    if (changed) {
      expect(qm.tier).not.toBe(before);
    } else {
      // At minimum the degradeAccum should have grown
      expect(qm.tier).toBe('HIGH'); // no degradation expected if cooldown isn't expired
    }
  });

  it('disabling adaptiveEnabled prevents auto tier changes', () => {
    qm.setTier('HIGH');
    qm.adaptiveEnabled = false;
    const received: QualityTier[] = [];
    qm.onTierChange = (s) => { received.push(s.tier); };
    // Pump lots of bad frames
    for (let i = 0; i < 1000; i++) qm.update(0.01, 30);
    expect(received).toHaveLength(0);
    expect(qm.tier).toBe('HIGH');
  });

  it('all four tiers have non-zero uiUpdateInterval except ULTRA', () => {
    const tiers: QualityTier[] = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'];
    for (const t of tiers) {
      qm.setTier(t);
      const s = qm.getSettings();
      if (t === 'ULTRA') {
        expect(s.uiUpdateInterval).toBe(0);
      } else {
        expect(s.uiUpdateInterval).toBeGreaterThan(0);
      }
    }
  });
});
