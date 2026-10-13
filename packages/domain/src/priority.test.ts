// P5-1 priority scoring tests (Phase 5 backend). Pure, no I/O.
import { describe, expect, it } from 'vitest';
import {
  PRIORITY_LEVELS,
  SCORING_CONFIG_VERSION,
  frequencyBonus,
  mapScoreToPriority,
  scorePriority,
  type PriorityScoreInput,
} from './index.js';

function input(overrides: Partial<PriorityScoreInput> = {}): PriorityScoreInput {
  return {
    categoryWeight: 10,
    assetWeight: 10,
    locationScore: 10,
    affectedReporters: 1,
    issueTypeCode: null,
    ...overrides,
  };
}

describe('PRIORITY_LEVELS', () => {
  it('contains exactly LOW, MEDIUM, HIGH (no CRITICAL)', () => {
    expect([...PRIORITY_LEVELS]).toEqual(['LOW', 'MEDIUM', 'HIGH']);
    expect(PRIORITY_LEVELS).not.toContain('CRITICAL');
  });
});

describe('SCORING_CONFIG_VERSION', () => {
  it('is 1', () => {
    expect(SCORING_CONFIG_VERSION).toBe(1);
  });
});

describe('mapScoreToPriority', () => {
  it('maps 0-39 to LOW', () => {
    expect(mapScoreToPriority(0)).toBe('LOW');
    expect(mapScoreToPriority(39)).toBe('LOW');
  });

  it('maps 40-69 to MEDIUM', () => {
    expect(mapScoreToPriority(40)).toBe('MEDIUM');
    expect(mapScoreToPriority(69)).toBe('MEDIUM');
  });

  it('maps 70-100 to HIGH', () => {
    expect(mapScoreToPriority(70)).toBe('HIGH');
    expect(mapScoreToPriority(100)).toBe('HIGH');
  });

  it('never maps to CRITICAL', () => {
    for (const score of [0, 39, 40, 69, 70, 100]) {
      expect(mapScoreToPriority(score)).not.toBe('CRITICAL');
    }
  });
});

describe('frequencyBonus', () => {
  it('follows the caller tier: 1→0, 2→5, 3-4→10, ≥5→15; 0→0', () => {
    expect(frequencyBonus(0)).toBe(0);
    expect(frequencyBonus(1)).toBe(0);
    expect(frequencyBonus(2)).toBe(5);
    expect(frequencyBonus(3)).toBe(10);
    expect(frequencyBonus(4)).toBe(10);
    expect(frequencyBonus(5)).toBe(15);
    expect(frequencyBonus(42)).toBe(15);
  });
});

describe('scorePriority clamps', () => {
  it('clamps category 40 → 35', () => {
    const r = scorePriority(
      input({ categoryWeight: 40, assetWeight: 0, locationScore: 0, affectedReporters: 0 }),
    );
    expect(r.factors.category).toBe(35);
    expect(r.score).toBe(35);
  });

  it('clamps asset 30 → 25', () => {
    const r = scorePriority(
      input({ categoryWeight: 0, assetWeight: 30, locationScore: 0, affectedReporters: 0 }),
    );
    expect(r.factors.asset).toBe(25);
    expect(r.score).toBe(25);
  });

  it('clamps location 30 → 25', () => {
    const r = scorePriority(
      input({ categoryWeight: 0, assetWeight: 0, locationScore: 30, affectedReporters: 0 }),
    );
    expect(r.factors.location).toBe(25);
    expect(r.score).toBe(25);
  });

  it('clamps negative components to 0', () => {
    const r = scorePriority(
      input({ categoryWeight: -5, assetWeight: -1, locationScore: -9, affectedReporters: 0 }),
    );
    expect(r.factors).toMatchObject({ category: 0, asset: 0, location: 0 });
    expect(r.score).toBe(0);
    expect(r.suggestedPriority).toBe('LOW');
  });

  it('caps the maxed total at 100 → HIGH', () => {
    const r = scorePriority(
      input({ categoryWeight: 40, assetWeight: 30, locationScore: 30, affectedReporters: 9 }),
    );
    expect(r.factors).toMatchObject({ category: 35, asset: 25, location: 25, frequency: 15 });
    expect(r.score).toBe(100);
    expect(r.suggestedPriority).toBe('HIGH');
  });
});

describe('scorePriority null handling', () => {
  it('uses new-scale medians 17/12/12 and scoringComplete=false when any weight is null', () => {
    const r = scorePriority(
      input({ categoryWeight: null, assetWeight: null, locationScore: null, affectedReporters: 1 }),
    );
    expect(r.factors).toMatchObject({ category: 17, asset: 12, location: 12, frequency: 0 });
    expect(r.score).toBe(41);
    expect(r.suggestedPriority).toBe('MEDIUM');
    expect(r.scoringComplete).toBe(false);
  });

  it('marks scoringComplete=false when only one weight is missing', () => {
    expect(scorePriority(input({ locationScore: null })).scoringComplete).toBe(false);
    expect(scorePriority(input({ categoryWeight: null })).scoringComplete).toBe(false);
    expect(scorePriority(input({ assetWeight: null })).scoringComplete).toBe(false);
  });

  it('marks scoringComplete=true when all three weights are present', () => {
    expect(scorePriority(input()).scoringComplete).toBe(true);
  });
});

describe('scorePriority DANGEROUS override', () => {
  it('bumps a low score to HIGH but keeps the score as computed', () => {
    const r = scorePriority(
      input({
        categoryWeight: 10,
        assetWeight: 5,
        locationScore: 5,
        affectedReporters: 0,
        issueTypeCode: 'DANGEROUS',
      }),
    );
    expect(r.score).toBe(20);
    expect(r.suggestedPriority).toBe('HIGH');
  });

  it('leaves an already-HIGH suggestion untouched', () => {
    const r = scorePriority(
      input({ categoryWeight: 40, assetWeight: 30, locationScore: 30, affectedReporters: 9, issueTypeCode: 'DANGEROUS' }),
    );
    expect(r.score).toBe(100);
    expect(r.suggestedPriority).toBe('HIGH');
  });

  it('does not bump other issue type codes', () => {
    const r = scorePriority(
      input({
        categoryWeight: 10,
        assetWeight: 5,
        locationScore: 5,
        affectedReporters: 0,
        issueTypeCode: 'LEAK',
      }),
    );
    expect(r.score).toBe(20);
    expect(r.suggestedPriority).toBe('LOW');
  });
});

describe('scorePriority result shape', () => {
  it('returns score, factors, scoringComplete, and config version', () => {
    const r = scorePriority(
      input({ categoryWeight: 10, assetWeight: 8, locationScore: 6, affectedReporters: 3 }),
    );
    expect(r.score).toBe(34);
    expect(r.suggestedPriority).toBe('LOW');
    expect(r.factors).toEqual({ category: 10, asset: 8, location: 6, frequency: 10, affectedReporters: 3 });
    expect(r.scoringComplete).toBe(true);
    expect(r.scoringConfigVersion).toBe(1);
  });

  it('maps boundary totals 39/69 correctly end to end', () => {
    const low39 = scorePriority(
      input({ categoryWeight: 20, assetWeight: 10, locationScore: 9, affectedReporters: 0 }),
    );
    expect(low39.score).toBe(39);
    expect(low39.suggestedPriority).toBe('LOW');
    const medium69 = scorePriority(
      input({ categoryWeight: 35, assetWeight: 25, locationScore: 9, affectedReporters: 0 }),
    );
    expect(medium69.score).toBe(69);
    expect(medium69.suggestedPriority).toBe('MEDIUM');
  });

  it('reaches MEDIUM/HIGH through unclamped combinations', () => {
    const medium = scorePriority(
      input({ categoryWeight: 20, assetWeight: 10, locationScore: 10, affectedReporters: 0 }),
    );
    expect(medium.score).toBe(40);
    expect(medium.suggestedPriority).toBe('MEDIUM');
    const high = scorePriority(
      input({ categoryWeight: 35, assetWeight: 25, locationScore: 10, affectedReporters: 0 }),
    );
    expect(high.score).toBe(70);
    expect(high.suggestedPriority).toBe('HIGH');
  });
});
