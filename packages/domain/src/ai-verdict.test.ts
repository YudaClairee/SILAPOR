// Task 2: pure AI-verdict mapping tests (pure — no I/O).
// Sample master lists defined locally (not imports); the helper takes
// master-list codes as parameters so domain stays dependency-free.
import { describe, expect, it } from 'vitest';
import { mapAiVerdict } from './ai-verdict.js';

const CATS = ['PLUMBING', 'HVAC', 'ELECTRICAL'] as const;
const ISSUES = ['LEAKING', 'NOISY', 'DEAD_OUTLET'] as const;

describe('mapAiVerdict', () => {
  it('fails wrong-asset instead of recoding', () => {
    const r = mapAiVerdict({ impliedCategory: 'PLUMBING', assetCategory: 'HVAC', category: 'PLUMBING', issueType: 'LEAKING', priority: 'HIGH', categories: CATS, issueTypes: ISSUES });
    expect(r).toEqual({ ok: false, reason: 'WRONG_ASSET' });
  });

  it('passes through a matching verdict with priority untouched', () => {
    const r = mapAiVerdict({ impliedCategory: 'PLUMBING', assetCategory: 'PLUMBING', category: 'PLUMBING', issueType: 'LEAKING', priority: 'HIGH', categories: CATS, issueTypes: ISSUES });
    expect(r).toEqual({ ok: true, categoryCode: 'PLUMBING', issueTypeCode: 'LEAKING', priority: 'HIGH' });
  });

  it('returns UNKNOWN_CODE for an unknown category', () => {
    const r = mapAiVerdict({ impliedCategory: 'ROOFING', assetCategory: 'ROOFING', category: 'ROOFING', issueType: 'LEAKING', priority: 'HIGH', categories: CATS, issueTypes: ISSUES });
    expect(r).toEqual({ ok: false, reason: 'UNKNOWN_CODE' });
  });

  it('returns UNKNOWN_CODE for an unknown issue type', () => {
    const r = mapAiVerdict({ impliedCategory: 'PLUMBING', assetCategory: 'PLUMBING', category: 'PLUMBING', issueType: 'FLOODED', priority: 'HIGH', categories: CATS, issueTypes: ISSUES });
    expect(r).toEqual({ ok: false, reason: 'UNKNOWN_CODE' });
  });

  it('returns UNCLEAR_EVIDENCE when no category is implied', () => {
    const r = mapAiVerdict({ impliedCategory: '', assetCategory: 'PLUMBING', category: 'PLUMBING', issueType: 'LEAKING', priority: 'HIGH', categories: CATS, issueTypes: ISSUES });
    expect(r).toEqual({ ok: false, reason: 'UNCLEAR_EVIDENCE' });
  });
});
