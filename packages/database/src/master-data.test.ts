// Unit tests for P2-5 master-data validators + archive/audit shapes.
// Offline: no DATABASE_URL, no drizzle queries — pure functions only.
import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTION_ARCHIVED,
  AUDIT_ACTION_CREATED,
  AUDIT_ACTION_UPDATED,
  ENTITY_FACILITY_ASSETS,
  ENTITY_FACILITY_CATEGORIES,
  ENTITY_ISSUE_TYPES,
  ENTITY_LOCATIONS,
  ENTITY_TECHNICIANS,
  auditActionForUpdate,
  buildAuditValues,
  normalizeListOptions,
  validateAssetInput,
  validateCategoryInput,
  validateIssueTypeInput,
  validateLocationInput,
  validateTechnicianInput,
} from './master-data.js';
import * as masterData from './master-data.js';

describe('validateCategoryInput', () => {
  it('accepts a valid category at the weight boundaries 0 and 40', () => {
    expect(
      validateCategoryInput({ code: 'ELECTRICAL', name: 'Electrical', weight: 0 }),
    ).toEqual([]);
    expect(
      validateCategoryInput({ code: 'HVAC', name: 'HVAC', weight: 40 }),
    ).toEqual([]);
  });

  it('rejects weight -1 and 41', () => {
    expect(
      validateCategoryInput({ code: 'X', name: 'X', weight: -1 }),
    ).not.toEqual([]);
    expect(
      validateCategoryInput({ code: 'X', name: 'X', weight: 41 }),
    ).not.toEqual([]);
  });

  it('rejects empty name, empty code, and overlong code', () => {
    expect(validateCategoryInput({ code: 'X', name: '' }).length).toBeGreaterThan(0);
    expect(validateCategoryInput({ code: '', name: 'Ok' }).length).toBeGreaterThan(0);
    expect(
      validateCategoryInput({ code: 'C'.repeat(33), name: 'Ok' }).length,
    ).toBeGreaterThan(0);
  });

  it('rejects non-object input', () => {
    expect(validateCategoryInput(null)).not.toEqual([]);
    expect(validateCategoryInput('ELECTRICAL')).not.toEqual([]);
  });
});

describe('validateIssueTypeInput', () => {
  it('accepts the generic NULL-category shape', () => {
    expect(validateIssueTypeInput({ code: 'BROKEN', name: 'Broken' })).toEqual([]);
    expect(
      validateIssueTypeInput({ code: 'BROKEN', name: 'Broken', categoryId: null }),
    ).toEqual([]);
  });

  it('accepts a set category id without touching the database', () => {
    expect(
      validateIssueTypeInput({ code: 'X', name: 'X', categoryId: 'some-uuid' }),
    ).toEqual([]);
  });

  it('rejects empty name and blank category id', () => {
    expect(validateIssueTypeInput({ code: 'X', name: '' }).length).toBeGreaterThan(0);
    expect(
      validateIssueTypeInput({ code: 'X', name: 'X', categoryId: '  ' }).length,
    ).toBeGreaterThan(0);
  });
});

describe('validateLocationInput', () => {
  const valid = {
    type: 'ROOM',
    code: '22.4C.02.015',
    name: 'Ruang Kuliah',
    parentId: null,
    buildingCode: 'C',
    floorNumber: 2,
    usageTier: 'TIER_1',
    tierScore: 30,
    reporterHidden: false,
    isActive: true,
  };

  it('accepts a fully-populated valid location', () => {
    expect(validateLocationInput(valid)).toEqual([]);
  });

  it('rejects a bad type enum value', () => {
    expect(validateLocationInput({ ...valid, type: 'VILLE' }).length).toBeGreaterThan(0);
  });

  it('rejects tierScore 31 and -1 but accepts 0 and 30', () => {
    expect(validateLocationInput({ ...valid, tierScore: 31 }).length).toBeGreaterThan(0);
    expect(validateLocationInput({ ...valid, tierScore: -1 }).length).toBeGreaterThan(0);
    expect(validateLocationInput({ ...valid, tierScore: 0 })).toEqual([]);
  });

  it('rejects empty name, empty code, and overlong code', () => {
    expect(validateLocationInput({ ...valid, name: '   ' }).length).toBeGreaterThan(0);
    expect(validateLocationInput({ ...valid, code: '' }).length).toBeGreaterThan(0);
    expect(validateLocationInput({ ...valid, code: 'C'.repeat(65) }).length).toBeGreaterThan(
      0,
    );
  });

  it('rejects a bad usageTier enum value', () => {
    expect(validateLocationInput({ ...valid, usageTier: 'TIER_5' }).length).toBeGreaterThan(
      0,
    );
  });
});

describe('validateAssetInput', () => {
  const valid = {
    assetCode: 'AC-001',
    name: 'AC Split 1 PK',
    categoryId: null,
    locationId: null,
    weight: 30,
    quantity: 2,
    isActive: true,
  };

  it('accepts a valid asset at the weight boundary 30', () => {
    expect(validateAssetInput(valid)).toEqual([]);
  });

  it('rejects weight -1 and 31', () => {
    expect(validateAssetInput({ ...valid, weight: -1 }).length).toBeGreaterThan(0);
    expect(validateAssetInput({ ...valid, weight: 31 }).length).toBeGreaterThan(0);
  });

  it('rejects negative quantity but accepts null and 0', () => {
    expect(validateAssetInput({ ...valid, quantity: -1 }).length).toBeGreaterThan(0);
    expect(validateAssetInput({ ...valid, quantity: null })).toEqual([]);
    expect(validateAssetInput({ ...valid, quantity: 0 })).toEqual([]);
  });

  it('rejects empty name and empty assetCode', () => {
    expect(validateAssetInput({ ...valid, name: '' }).length).toBeGreaterThan(0);
    expect(validateAssetInput({ ...valid, assetCode: '' }).length).toBeGreaterThan(0);
  });
});

describe('validateTechnicianInput', () => {
  it('accepts a valid technician (displayName need not be unique)', () => {
    expect(
      validateTechnicianInput({ technicianCode: 'TECH-001', displayName: 'Ahmad' }),
    ).toEqual([]);
  });

  it('rejects empty displayName and empty technicianCode', () => {
    expect(
      validateTechnicianInput({ technicianCode: 'TECH-001', displayName: '  ' }).length,
    ).toBeGreaterThan(0);
    expect(
      validateTechnicianInput({ technicianCode: '', displayName: 'Ahmad' }).length,
    ).toBeGreaterThan(0);
  });
});

describe('normalizeListOptions', () => {
  it('defaults to active-only, limit 50, offset 0', () => {
    expect(normalizeListOptions()).toEqual({ includeInactive: false, limit: 50, offset: 0 });
    expect(normalizeListOptions({})).toEqual({ includeInactive: false, limit: 50, offset: 0 });
  });

  it('clamps limit to max 200 and min 1', () => {
    expect(normalizeListOptions({ limit: 500 }).limit).toBe(200);
    expect(normalizeListOptions({ limit: 0 }).limit).toBe(1);
    expect(normalizeListOptions({ limit: -5 }).limit).toBe(1);
  });

  it('floors negative offsets to 0 and keeps includeInactive', () => {
    expect(normalizeListOptions({ offset: -3 }).offset).toBe(0);
    expect(normalizeListOptions({ includeInactive: true }).includeInactive).toBe(true);
  });
});

describe('archive/audit shapes', () => {
  it('exposes stable audit action and entity-type constants', () => {
    expect(AUDIT_ACTION_CREATED).toBe('MASTER_DATA_CREATED');
    expect(AUDIT_ACTION_UPDATED).toBe('MASTER_DATA_UPDATED');
    expect(AUDIT_ACTION_ARCHIVED).toBe('MASTER_DATA_ARCHIVED');
    expect(ENTITY_LOCATIONS).toBe('locations');
    expect(ENTITY_FACILITY_CATEGORIES).toBe('facility_categories');
    expect(ENTITY_ISSUE_TYPES).toBe('issue_types');
    expect(ENTITY_FACILITY_ASSETS).toBe('facility_assets');
    expect(ENTITY_TECHNICIANS).toBe('technicians');
  });

  it('selects ARCHIVED only when the patch deactivates', () => {
    expect(auditActionForUpdate(true)).toBe('MASTER_DATA_ARCHIVED');
    expect(auditActionForUpdate(false)).toBe('MASTER_DATA_UPDATED');
  });

  it('builds a create audit with NULL before, redacted after, nullable ids', () => {
    const values = buildAuditValues({
      action: AUDIT_ACTION_CREATED,
      entityType: ENTITY_LOCATIONS,
      entityId: 'entity-id',
      after: { code: 'C', token: 'must-be-masked' },
    });
    expect(values.actorId).toBeNull();
    expect(values.requestId).toBeNull();
    expect(values.beforeData).toBeNull();
    expect(values.afterData).toMatchObject({ code: 'C', token: '[REDACTED]' });
  });

  it('builds an archive audit carrying before and after plus opaque ids', () => {
    const before = { code: 'C', isActive: true };
    const after = { code: 'C', isActive: false };
    const values = buildAuditValues({
      action: AUDIT_ACTION_ARCHIVED,
      entityType: ENTITY_TECHNICIANS,
      entityId: 'tech-id',
      before,
      after,
      actorId: 'actor-uuid',
      requestId: 'request-uuid',
    });
    expect(values.beforeData).toMatchObject(before);
    expect(values.afterData).toMatchObject(after);
    expect(values.actorId).toBe('actor-uuid');
    expect(values.requestId).toBe('request-uuid');
  });

  it('exports no hard-delete function for any entity', () => {
    const names = Object.keys(masterData);
    expect(names.filter((name) => /^delete/i.test(name))).toEqual([]);
    for (const name of [
      'archiveLocation',
      'archiveCategory',
      'archiveIssueType',
      'archiveAsset',
      'archiveTechnician',
    ]) {
      expect(typeof (masterData as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
