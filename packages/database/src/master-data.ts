// Master-data repositories + pure validators (Phase 2 P2-5, plan steps 8-10).
//
// Five admin-managed entities (locations, facility_categories, issue_types,
// facility_assets, technicians) with soft-archive semantics: NO hard delete
// anywhere — `archiveX` flips `is_active` to false and default lists exclude
// inactive rows. Every mutation writes an `audit_logs` row in the SAME
// `db.transaction` as the data change.
//
// Secrecy rule: audit before/after payloads go through `redact()` from
// `@silapor/shared`; callers pass only opaque `actorId` (account UUID) and
// `requestId` — never usernames, NIMs, tokens, or secrets. This module logs
// nothing itself.

import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  badRequest,
  conflict,
  internal,
  isAppError,
  notFound,
  redact,
} from '@silapor/shared';
import * as schema from './schema.js';

type Database = PostgresJsDatabase<typeof schema>;

// ---------------------------------------------------------------------------
// List pagination + audit shared helpers (pure, unit-tested without a DB).
// ---------------------------------------------------------------------------

export interface ListOptions {
  readonly includeInactive?: boolean | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface NormalizedListOptions {
  readonly includeInactive: boolean;
  readonly limit: number;
  readonly offset: number;
}

export const DEFAULT_LIST_LIMIT = 50 as const;
export const MAX_LIST_LIMIT = 200 as const;

export function normalizeListOptions(options?: ListOptions): NormalizedListOptions {
  const includeInactive = options?.includeInactive ?? false;
  const rawLimit = options?.limit;
  const limit =
    rawLimit === undefined || !Number.isFinite(rawLimit)
      ? DEFAULT_LIST_LIMIT
      : Math.min(Math.max(Math.floor(rawLimit), 1), MAX_LIST_LIMIT);
  const rawOffset = options?.offset;
  const offset =
    rawOffset === undefined || !Number.isFinite(rawOffset)
      ? 0
      : Math.max(Math.floor(rawOffset), 0);
  return { includeInactive, limit, offset };
}

export const AUDIT_ACTION_CREATED = 'MASTER_DATA_CREATED' as const;
export const AUDIT_ACTION_UPDATED = 'MASTER_DATA_UPDATED' as const;
export const AUDIT_ACTION_ARCHIVED = 'MASTER_DATA_ARCHIVED' as const;

export const ENTITY_LOCATIONS = 'locations' as const;
export const ENTITY_FACILITY_CATEGORIES = 'facility_categories' as const;
export const ENTITY_ISSUE_TYPES = 'issue_types' as const;
export const ENTITY_FACILITY_ASSETS = 'facility_assets' as const;
export const ENTITY_TECHNICIANS = 'technicians' as const;

export interface AuditContext {
  readonly actorId?: string | null;
  readonly requestId?: string | null;
}

export interface AuditValues {
  readonly actorId: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly beforeData: unknown;
  readonly afterData: unknown;
  readonly requestId: string | null;
}

// Pure constructor for `audit_logs` insert values. `before`/`after` are
// sanitised via `redact()`; absent payloads become NULL (create rows carry
// after only). `actorId`/`requestId` are nullable by contract.
export function buildAuditValues(params: {
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly before?: unknown | undefined;
  readonly after?: unknown | undefined;
  readonly actorId?: string | null | undefined;
  readonly requestId?: string | null | undefined;
}): AuditValues {
  return {
    actorId: params.actorId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    beforeData: params.before === undefined ? null : redact(params.before),
    afterData: params.after === undefined ? null : redact(params.after),
    requestId: params.requestId ?? null,
  };
}

// Update mutations record ARCHIVED when the patch deactivates the row,
// UPDATED otherwise (reactivation via `isActive: true` stays UPDATED).
export function auditActionForUpdate(patchSetsInactive: boolean): string {
  return patchSetsInactive ? AUDIT_ACTION_ARCHIVED : AUDIT_ACTION_UPDATED;
}

// ---------------------------------------------------------------------------
// Pure validators (no I/O; FK existence is checked by repos, not here).
// Each takes the full create-shaped input and returns error strings
// (empty = valid). Update paths validate the merged (existing + patch) row,
// so patch-only callers must merge first — see `stripUndefined` below.
// ---------------------------------------------------------------------------

const LOCATION_TYPES: ReadonlySet<string> = new Set(['CAMPUS', 'BUILDING', 'FLOOR', 'ROOM']);
const USAGE_TIERS: ReadonlySet<string> = new Set(['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkRequiredCode(value: unknown, maxLength: number, errors: string[]): void {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push('code must be a non-empty string');
    return;
  }
  if (value.trim().length > maxLength) {
    errors.push(`code must be at most ${maxLength} characters`);
  }
}

function checkRequiredName(value: unknown, maxLength: number, errors: string[]): void {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push('name must be a non-empty string');
    return;
  }
  if (value.trim().length > maxLength) {
    errors.push(`name must be at most ${maxLength} characters`);
  }
}

function checkOptionalBoolean(value: unknown, field: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'boolean') {
    errors.push(`${field} must be a boolean`);
  }
}

function checkOptionalId(value: unknown, field: string, errors: string[]): void {
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${field} must be a non-empty id string or null`);
  }
}

function checkWeight(value: unknown, max: number, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    errors.push(`weight must be an integer between 0 and ${max}`);
  }
}

export function validateCategoryInput(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return ['input must be an object'];
  }
  checkRequiredCode(input['code'], 32, errors);
  checkRequiredName(input['name'], 128, errors);
  const description = input['description'];
  if (description !== undefined && description !== null && typeof description !== 'string') {
    errors.push('description must be a string or null');
  }
  checkWeight(input['weight'], 40, errors);
  checkOptionalBoolean(input['isActive'], 'isActive', errors);
  return errors;
}

export function validateIssueTypeInput(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return ['input must be an object'];
  }
  checkRequiredCode(input['code'], 64, errors);
  checkRequiredName(input['name'], 128, errors);
  checkOptionalId(input['categoryId'], 'categoryId', errors);
  checkOptionalBoolean(input['isActive'], 'isActive', errors);
  return errors;
}

export function validateLocationInput(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return ['input must be an object'];
  }
  const type = input['type'];
  if (typeof type !== 'string' || !LOCATION_TYPES.has(type)) {
    errors.push('type must be one of CAMPUS, BUILDING, FLOOR, ROOM');
  }
  checkRequiredCode(input['code'], 64, errors);
  checkRequiredName(input['name'], 256, errors);
  checkOptionalId(input['parentId'], 'parentId', errors);
  const buildingCode = input['buildingCode'];
  if (
    buildingCode !== undefined &&
    buildingCode !== null &&
    (typeof buildingCode !== 'string' ||
      buildingCode.trim() === '' ||
      buildingCode.trim().length > 64)
  ) {
    errors.push('buildingCode must be a non-empty string of at most 64 characters or null');
  }
  const floorNumber = input['floorNumber'];
  if (
    floorNumber !== undefined &&
    floorNumber !== null &&
    (typeof floorNumber !== 'number' || !Number.isInteger(floorNumber))
  ) {
    errors.push('floorNumber must be an integer or null');
  }
  const usageTier = input['usageTier'];
  if (usageTier !== undefined && usageTier !== null && !USAGE_TIERS.has(String(usageTier))) {
    errors.push('usageTier must be one of TIER_1, TIER_2, TIER_3, TIER_4 or null');
  }
  const tierScore = input['tierScore'];
  if (
    tierScore !== undefined &&
    tierScore !== null &&
    (typeof tierScore !== 'number' || !Number.isInteger(tierScore) || tierScore < 0 || tierScore > 30)
  ) {
    errors.push('tierScore must be an integer between 0 and 30 or null');
  }
  checkOptionalBoolean(input['reporterHidden'], 'reporterHidden', errors);
  checkOptionalBoolean(input['isActive'], 'isActive', errors);
  return errors;
}

export function validateAssetInput(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return ['input must be an object'];
  }
  const assetCode = input['assetCode'];
  if (typeof assetCode !== 'string' || assetCode.trim() === '') {
    errors.push('assetCode must be a non-empty string');
  } else if (assetCode.trim().length > 64) {
    errors.push('assetCode must be at most 64 characters');
  }
  checkRequiredName(input['name'], 256, errors);
  checkOptionalId(input['categoryId'], 'categoryId', errors);
  checkOptionalId(input['locationId'], 'locationId', errors);
  checkWeight(input['weight'], 30, errors);
  const quantity = input['quantity'];
  if (
    quantity !== undefined &&
    quantity !== null &&
    (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 0)
  ) {
    errors.push('quantity must be null or an integer >= 0');
  }
  checkOptionalBoolean(input['isActive'], 'isActive', errors);
  return errors;
}

export function validateTechnicianInput(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return ['input must be an object'];
  }
  const code = input['technicianCode'];
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('technicianCode must be a non-empty string');
  } else if (code.trim().length > 64) {
    errors.push('technicianCode must be at most 64 characters');
  }
  const displayName = input['displayName'];
  if (typeof displayName !== 'string' || displayName.trim() === '') {
    errors.push('displayName must be a non-empty string');
  } else if (displayName.trim().length > 128) {
    errors.push('displayName must be at most 128 characters');
  }
  const specialty = input['specialty'];
  if (specialty !== undefined && specialty !== null && typeof specialty !== 'string') {
    errors.push('specialty must be a string or null');
  }
  checkOptionalBoolean(input['isActive'], 'isActive', errors);
  return errors;
}

// ---------------------------------------------------------------------------
// Internal helpers shared by the repositories below.
// ---------------------------------------------------------------------------

// Drops `undefined` values so patches only carry explicitly-set fields
// (explicit `null` clears nullable FKs — that is intentional and kept).
function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as Partial<T>;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if ((error as Record<string, unknown>)['code'] === '23505') {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('duplicate key') || message.includes('unique');
}

// Maps a storage-level unique violation to 409; rethrows everything else
// (including AppErrors) untouched so routes keep exact status codes.
function throwMappedUniqueViolation(error: unknown, message: string): never {
  if (isAppError(error)) {
    throw error;
  }
  if (isUniqueViolation(error)) {
    throw conflict(message);
  }
  throw error;
}

function invalidInput(prefix: string, errors: string[]): never {
  throw badRequest(`${prefix}: ${errors.join('; ')}`);
}

// ---------------------------------------------------------------------------
// Input shapes (camelCase; the service layer maps snake_case bodies here).
// ---------------------------------------------------------------------------

export interface LocationCreateInput {
  readonly type: string;
  readonly code: string;
  readonly name: string;
  readonly parentId?: string | null;
  readonly buildingCode?: string | null;
  readonly floorNumber?: number | null;
  readonly usageTier?: string | null;
  readonly tierScore?: number | null;
  readonly reporterHidden?: boolean;
  readonly isActive?: boolean;
}

export interface LocationPatch {
  readonly type?: string;
  readonly code?: string;
  readonly name?: string;
  readonly parentId?: string | null;
  readonly buildingCode?: string | null;
  readonly floorNumber?: number | null;
  readonly usageTier?: string | null;
  readonly tierScore?: number | null;
  readonly reporterHidden?: boolean;
  readonly isActive?: boolean;
}

export interface CategoryCreateInput {
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  readonly weight?: number;
  readonly isActive?: boolean;
}

export interface CategoryPatch {
  readonly code?: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly weight?: number;
  readonly isActive?: boolean;
}

export interface IssueTypeCreateInput {
  readonly code: string;
  readonly name: string;
  readonly categoryId?: string | null;
  readonly isActive?: boolean;
}

export interface IssueTypePatch {
  readonly code?: string;
  readonly name?: string;
  readonly categoryId?: string | null;
  readonly isActive?: boolean;
}

export interface AssetCreateInput {
  readonly assetCode: string;
  readonly name: string;
  readonly categoryId?: string | null;
  readonly locationId?: string | null;
  readonly weight?: number;
  readonly quantity?: number | null;
  readonly isActive?: boolean;
}

export interface AssetPatch {
  readonly assetCode?: string;
  readonly name?: string;
  readonly categoryId?: string | null;
  readonly locationId?: string | null;
  readonly weight?: number;
  readonly quantity?: number | null;
  readonly isActive?: boolean;
}

export interface TechnicianCreateInput {
  readonly technicianCode: string;
  readonly displayName: string;
  readonly specialty?: string | null;
  readonly isActive?: boolean;
}

export interface TechnicianPatch {
  readonly technicianCode?: string;
  readonly displayName?: string;
  readonly specialty?: string | null;
  readonly isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Locations.
// ---------------------------------------------------------------------------

export async function listLocations(
  db: Database,
  options?: ListOptions,
): Promise<schema.Location[]> {
  const normalized = normalizeListOptions(options);
  if (normalized.includeInactive) {
    return await db
      .select()
      .from(schema.locations)
      .orderBy(asc(schema.locations.code))
      .limit(normalized.limit)
      .offset(normalized.offset);
  }
  return await db
    .select()
    .from(schema.locations)
    .where(eq(schema.locations.isActive, true))
    .orderBy(asc(schema.locations.code))
    .limit(normalized.limit)
    .offset(normalized.offset);
}

export async function getLocation(
  db: Database,
  id: string,
): Promise<schema.Location | undefined> {
  const rows = await db.select().from(schema.locations).where(eq(schema.locations.id, id));
  return rows[0];
}

async function assertLocationParentExists(db: Database, parentId: string): Promise<void> {
  const parent = await db
    .select({ id: schema.locations.id })
    .from(schema.locations)
    .where(eq(schema.locations.id, parentId));
  if (parent.length === 0) {
    throw badRequest('Parent location not found');
  }
}

export async function createLocation(
  db: Database,
  input: LocationCreateInput,
  ctx: AuditContext,
): Promise<schema.Location> {
  const errors = validateLocationInput(input);
  if (errors.length > 0) {
    invalidInput('Invalid location input', errors);
  }
  const code = input.code.trim();
  const codeClash = await db
    .select({ id: schema.locations.id })
    .from(schema.locations)
    .where(eq(schema.locations.code, code));
  if (codeClash.length > 0) {
    throw conflict(`Location code '${code}' already exists`);
  }
  if (input.parentId !== undefined && input.parentId !== null) {
    await assertLocationParentExists(db, input.parentId);
  }
  try {
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.locations)
        .values({
          type: input.type,
          code,
          name: input.name.trim(),
          parentId: input.parentId ?? null,
          buildingCode: input.buildingCode ?? null,
          floorNumber: input.floorNumber ?? null,
          usageTier: input.usageTier ?? null,
          tierScore: input.tierScore ?? null,
          reporterHidden: input.reporterHidden ?? false,
          isActive: input.isActive ?? true,
        })
        .returning();
      const row = inserted[0];
      if (row === undefined) {
        throw internal('Failed to create location');
      }
      await tx.insert(schema.auditLogs).values(
        buildAuditValues({
          action: AUDIT_ACTION_CREATED,
          entityType: ENTITY_LOCATIONS,
          entityId: row.id,
          after: row,
          actorId: ctx.actorId,
          requestId: ctx.requestId,
        }),
      );
      return row;
    });
  } catch (error) {
    throwMappedUniqueViolation(error, `Location code '${code}' already exists`);
  }
}

export async function updateLocation(
  db: Database,
  id: string,
  patch: LocationPatch,
  ctx: AuditContext,
): Promise<schema.Location> {
  const existing = await getLocation(db, id);
  if (existing === undefined) {
    throw notFound('Location not found');
  }
  const clean = stripUndefined(patch);
  if (Object.keys(clean).length === 0) {
    return existing;
  }
  const merged: Record<string, unknown> = {
    type: existing.type,
    code: existing.code,
    name: existing.name,
    parentId: existing.parentId,
    buildingCode: existing.buildingCode,
    floorNumber: existing.floorNumber,
    usageTier: existing.usageTier,
    tierScore: existing.tierScore,
    reporterHidden: existing.reporterHidden,
    isActive: existing.isActive,
    ...clean,
  };
  const errors = validateLocationInput(merged);
  if (errors.length > 0) {
    invalidInput('Invalid location input', errors);
  }
  if (
    clean['code'] !== undefined &&
    typeof clean['code'] === 'string' &&
    clean['code'].trim() !== existing.code
  ) {
    const clash = await db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(eq(schema.locations.code, (clean['code'] as string).trim()));
    if (clash.some((row) => row.id !== id)) {
      throw conflict(`Location code '${(clean['code'] as string).trim()}' already exists`);
    }
  }
  if (clean['parentId'] !== undefined && clean['parentId'] !== null) {
    const parentId = clean['parentId'] as string;
    if (parentId === id) {
      throw badRequest('A location cannot be its own parent');
    }
    await assertLocationParentExists(db, parentId);
  }
  const set: Partial<typeof schema.locations.$inferInsert> = {};
  if (clean['type'] !== undefined) {
    set.type = clean['type'] as string;
  }
  if (clean['code'] !== undefined) {
    set.code = (clean['code'] as string).trim();
  }
  if (clean['name'] !== undefined) {
    set.name = (clean['name'] as string).trim();
  }
  if (clean['parentId'] !== undefined) {
    set.parentId = clean['parentId'] as string | null;
  }
  if (clean['buildingCode'] !== undefined) {
    set.buildingCode = clean['buildingCode'] as string | null;
  }
  if (clean['floorNumber'] !== undefined) {
    set.floorNumber = clean['floorNumber'] as number | null;
  }
  if (clean['usageTier'] !== undefined) {
    set.usageTier = clean['usageTier'] as string | null;
  }
  if (clean['tierScore'] !== undefined) {
    set.tierScore = clean['tierScore'] as number | null;
  }
  if (clean['reporterHidden'] !== undefined) {
    set.reporterHidden = clean['reporterHidden'] as boolean;
  }
  if (clean['isActive'] !== undefined) {
    set.isActive = clean['isActive'] as boolean;
  }
  const action = auditActionForUpdate(clean['isActive'] === false);
  try {
    return await db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.locations)
        .set(set)
        .where(eq(schema.locations.id, id))
        .returning();
      const row = updated[0];
      if (row === undefined) {
        throw internal('Failed to update location');
      }
      await tx.insert(schema.auditLogs).values(
        buildAuditValues({
          action,
          entityType: ENTITY_LOCATIONS,
          entityId: row.id,
          before: existing,
          after: row,
          actorId: ctx.actorId,
          requestId: ctx.requestId,
        }),
      );
      return row;
    });
  } catch (error) {
    throwMappedUniqueViolation(error, 'Location code already exists');
  }
}

export async function archiveLocation(
  db: Database,
  id: string,
  ctx: AuditContext,
): Promise<schema.Location> {
  const existing = await getLocation(db, id);
  if (existing === undefined) {
    throw notFound('Location not found');
  }
  if (!existing.isActive) {
    return existing;
  }
  return await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.locations)
      .set({ isActive: false })
      .where(eq(schema.locations.id, id))
      .returning();
    const row = updated[0];
    if (row === undefined) {
      throw internal('Failed to archive location');
    }
    await tx.insert(schema.auditLogs).values(
      buildAuditValues({
        action: AUDIT_ACTION_ARCHIVED,
        entityType: ENTITY_LOCATIONS,
        entityId: row.id,
        before: existing,
        after: row,
        actorId: ctx.actorId,
        requestId: ctx.requestId,
      }),
    );
    return row;
  });
}

// ---------------------------------------------------------------------------
// Facility categories.
// ---------------------------------------------------------------------------

export async function listCategories(
  db: Database,
  options?: ListOptions,
): Promise<schema.FacilityCategory[]> {
  const normalized = normalizeListOptions(options);
  if (normalized.includeInactive) {
    return await db
      .select()
      .from(schema.facilityCategories)
      .orderBy(asc(schema.facilityCategories.code))
      .limit(normalized.limit)
      .offset(normalized.offset);
  }
  return await db
    .select()
    .from(schema.facilityCategories)
    .where(eq(schema.facilityCategories.isActive, true))
    .orderBy(asc(schema.facilityCategories.code))
    .limit(normalized.limit)
    .offset(normalized.offset);
}

export async function getCategory(
  db: Database,
  id: string,
): Promise<schema.FacilityCategory | undefined> {
  const rows = await db
    .select()
    .from(schema.facilityCategories)
    .where(eq(schema.facilityCategories.id, id));
  return rows[0];
}

export async function createCategory(
  db: Database,
  input: CategoryCreateInput,
  ctx: AuditContext,
): Promise<schema.FacilityCategory> {
  const errors = validateCategoryInput(input);
  if (errors.length > 0) {
    invalidInput('Invalid category input', errors);
  }
  const code = input.code.trim();
  const clash = await db
    .select({ id: schema.facilityCategories.id })
    .from(schema.facilityCategories)
    .where(eq(schema.facilityCategories.code, code));
  if (clash.length > 0) {
    throw conflict(`Category code '${code}' already exists`);
  }
  try {
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.facilityCategories)
        .values({
          code,
          name: input.name.trim(),
          description: input.description ?? null,
          // Column default is 10; explicit pass-through keeps the row
          // identical whether the caller omits weight or sends 10.
          weight: input.weight ?? 10,
          isActive: input.isActive ?? true,
        })
        .returning();
      const row = inserted[0];
      if (row === undefined) {
        throw internal('Failed to create category');
      }
      await tx.insert(schema.auditLogs).values(
        buildAuditValues({
          action: AUDIT_ACTION_CREATED,
          entityType: ENTITY_FACILITY_CATEGORIES,
          entityId: row.id,
          after: row,
          actorId: ctx.actorId,
          requestId: ctx.requestId,
        }),
      );
      return row;
    });
  } catch (error) {
    throwMappedUniqueViolation(error, `Category code '${code}' already exists`);
  }
}

export async function updateCategory(
  db: Database,
  id: string,
  patch: CategoryPatch,
  ctx: AuditContext,
): Promise<schema.FacilityCategory> {
  const existing = await getCategory(db, id);
  if (existing === undefined) {
    throw notFound('Category not found');
  }
  const clean = stripUndefined(patch);
  if (Object.keys(clean).length === 0) {
    return existing;
  }
  const merged: Record<string, unknown> = {
    code: existing.code,
    name: existing.name,
    description: existing.description,
    weight: existing.weight,
    isActive: existing.isActive,
    ...clean,
  };
  const errors = validateCategoryInput(merged);
  if (errors.length > 0) {
    invalidInput('Invalid category input', errors);
  }
  if (
    clean['code'] !== undefined &&
    typeof clean['code'] === 'string' &&
    clean['code'].trim() !== existing.code
  ) {
    const clash = await db
      .select({ id: schema.facilityCategories.id })
      .from(schema.facilityCategories)
      .where(eq(schema.facilityCategories.code, (clean['code'] as string).trim()));
    if (clash.some((row) => row.id !== id)) {
      throw conflict(`Category code '${(clean['code'] as string).trim()}' already exists`);
    }
  }
  const set: Partial<typeof schema.facilityCategories.$inferInsert> = {};
  if (clean['code'] !== undefined) {
    set.code = (clean['code'] as string).trim();
  }
  if (clean['name'] !== undefined) {
    set.name = (clean['name'] as string).trim();
  }
  if (clean['description'] !== undefined) {
    set.description = clean['description'] as string | null;
  }
  if (clean['weight'] !== undefined) {
    set.weight = clean['weight'] as number;
  }
  if (clean['isActive'] !== undefined) {
    set.isActive = clean['isActive'] as boolean;
  }
  const action = auditActionForUpdate(clean['isActive'] === false);
  try {
    return await db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.facilityCategories)
        .set(set)
        .where(eq(schema.facilityCategories.id, id))
        .returning();
      const row = updated[0];
      if (row === undefined) {
        throw internal('Failed to update category');
      }
      await tx.insert(schema.auditLogs).values(
        buildAuditValues({
          action,
          entityType: ENTITY_FACILITY_CATEGORIES,
          entityId: row.id,
          before: existing,
          after: row,
          actorId: ctx.actorId,
          requestId: ctx.requestId,
        }),
      );
      return row;
    });
  } catch (error) {
    throwMappedUniqueViolation(error, 'Category code already exists');
  }
}

export async function archiveCategory(
  db: Database,
  id: string,
  ctx: AuditContext,
): Promise<schema.FacilityCategory> {
  const existing = await getCategory(db, id);
  if (existing === undefined) {
    throw notFound('Category not found');
  }
  if (!existing.isActive) {
    return existing;
  }
  return await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.facilityCategories)
      .set({ isActive: false })
      .where(eq(schema.facilityCategories.id, id))
      .returning();
    const row = updated[0];
    if (row === undefined) {
      throw internal('Failed to archive category');
    }
    await tx.insert(schema.auditLogs).values(
      buildAuditValues({
        action: AUDIT_ACTION_ARCHIVED,
        entityType: ENTITY_FACILITY_CATEGORIES,
        entityId: row.id,
        before: existing,
        after: row,
        actorId: ctx.actorId,
        requestId: ctx.requestId,
      }),
    );
    return row;
  });
}

// ---------------------------------------------------------------------------
// Issue types.
// ---------------------------------------------------------------------------

export async function listIssueTypes(
  db: Database,
  options?: ListOptions,
): Promise<schema.IssueType[]> {
  const normalized = normalizeListOptions(options);
  if (normalized.includeInactive) {
    return await db
      .select()
      .from(schema.issueTypes)
      .orderBy(asc(schema.issueTypes.code))
      .limit(normalized.limit)
      .offset(normalized.offset);
  }
  return await db
    .select()
    .from(schema.issueTypes)
    .where(eq(schema.issueTypes.isActive, true))
    .orderBy(asc(schema.issueTypes.code))
    .limit(normalized.limit)
    .offset(normalized.offset);
}

export async function getIssueType(
  db: Database,
  id: string,
): Promise<schema.IssueType | undefined> {
  const rows = await db
    .select()
    .from(schema.issueTypes)
    .where(eq(schema.issueTypes.id, id));
  return rows[0];
}

// A set category must exist AND be active (inactive categories cannot gain
// new issue types; the 7 generic rows keep NULL).
async function assertIssueCategoryUsable(db: Database, categoryId: string): Promise<void> {
  const rows = await db
    .select()
    .from(schema.facilityCategories)
    .where(eq(schema.facilityCategories.id, categoryId));
  const category = rows[0];
  if (category === undefined) {
    throw badRequest('Category not found');
  }
  if (!category.isActive) {
    throw badRequest('Category is inactive');
  }
}

export async function createIssueType(
  db: Database,
  input: IssueTypeCreateInput,
  ctx: AuditContext,
): Promise<schema.IssueType> {
  const errors = validateIssueTypeInput(input);
  if (errors.length > 0) {
    invalidInput('Invalid issue type input', errors);
  }
  const code = input.code.trim();
  const clash = await db
    .select({ id: schema.issueTypes.id })
    .from(schema.issueTypes)
    .where(eq(schema.issueTypes.code, code));
  if (clash.length > 0) {
    throw conflict(`Issue type code '${code}' already exists`);
  }
  if (input.categoryId !== undefined && input.categoryId !== null) {
    await assertIssueCategoryUsable(db, input.categoryId);
  }
  try {
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.issueTypes)
        .values({
          code,
          name: input.name.trim(),
          categoryId: input.categoryId ?? null,
          isActive: input.isActive ?? true,
        })
        .returning();
      const row = inserted[0];
      if (row === undefined) {
        throw internal('Failed to create issue type');
      }
      await tx.insert(schema.auditLogs).values(
        buildAuditValues({
          action: AUDIT_ACTION_CREATED,
          entityType: ENTITY_ISSUE_TYPES,
          entityId: row.id,
          after: row,
          actorId: ctx.actorId,
          requestId: ctx.requestId,
        }),
      );
      return row;
    });
  } catch (error) {
    throwMappedUniqueViolation(error, `Issue type code '${code}' already exists`);
  }
}

export async function updateIssueType(
  db: Database,
  id: string,
  patch: IssueTypePatch,
  ctx: AuditContext,
): Promise<schema.IssueType> {
  const existing = await getIssueType(db, id);
  if (existing === undefined) {
    throw notFound('Issue type not found');
  }
  const clean = stripUndefined(patch);
  if (Object.keys(clean).length === 0) {
    return existing;
  }
  const merged: Record<string, unknown> = {
    code: existing.code,
    name: existing.name,
    categoryId: existing.categoryId,
    isActive: existing.isActive,
    ...clean,
  };
  const errors = validateIssueTypeInput(merged);
  if (errors.length > 0) {
    invalidInput('Invalid issue type input', errors);
  }
  if (
    clean['code'] !== undefined &&
    typeof clean['code'] === 'string' &&
    clean['code'].trim() !== existing.code
  ) {
    const clash = await db
      .select({ id: schema.issueTypes.id })
      .from(schema.issueTypes)
      .where(eq(schema.issueTypes.code, (clean['code'] as string).trim()));
    if (clash.some((row) => row.id !== id)) {
      throw conflict(`Issue type code '${(clean['code'] as string).trim()}' already exists`);
    }
  }
  if (clean['categoryId'] !== undefined && clean['categoryId'] !== null) {
    await assertIssueCategoryUsable(db, clean['categoryId'] as string);
  }
  const set: Partial<typeof schema.issueTypes.$inferInsert> = {};
  if (clean['code'] !== undefined) {
    set.code = (clean['code'] as string).trim();
  }
  if (clean['name'] !== undefined) {
    set.name = (clean['name'] as string).trim();
  }
  if (clean['categoryId'] !== undefined) {
    set.categoryId = clean['categoryId'] as string | null;
  }
  if (clean['isActive'] !== undefined) {
    set.isActive = clean['isActive'] as boolean;
  }
  const action = auditActionForUpdate(clean['isActive'] === false);
  try {
    return await db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.issueTypes)
        .set(set)
        .where(eq(schema.issueTypes.id, id))
        .returning();
      const row = updated[0];
      if (row === undefined) {
        throw internal('Failed to update issue type');
      }
      await tx.insert(schema.auditLogs).values(
        buildAuditValues({
          action,
          entityType: ENTITY_ISSUE_TYPES,
          entityId: row.id,
          before: existing,
          after: row,
          actorId: ctx.actorId,
          requestId: ctx.requestId,
        }),
      );
      return row;
    });
  } catch (error) {
    throwMappedUniqueViolation(error, 'Issue type code already exists');
  }
}

export async function archiveIssueType(
  db: Database,
  id: string,
  ctx: AuditContext,
): Promise<schema.IssueType> {
  const existing = await getIssueType(db, id);
  if (existing === undefined) {
    throw notFound('Issue type not found');
  }
  if (!existing.isActive) {
    return existing;
  }
  return await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.issueTypes)
      .set({ isActive: false })
      .where(eq(schema.issueTypes.id, id))
      .returning();
    const row = updated[0];
    if (row === undefined) {
      throw internal('Failed to archive issue type');
    }
    await tx.insert(schema.auditLogs).values(
      buildAuditValues({
        action: AUDIT_ACTION_ARCHIVED,
        entityType: ENTITY_ISSUE_TYPES,
        entityId: row.id,
        before: existing,
        after: row,
        actorId: ctx.actorId,
        requestId: ctx.requestId,
      }),
    );
    return row;
  });
}

// ---------------------------------------------------------------------------
// Facility assets.
// ---------------------------------------------------------------------------

export async function listAssets(
  db: Database,
  options?: ListOptions,
): Promise<schema.FacilityAsset[]> {
  const normalized = normalizeListOptions(options);
  if (normalized.includeInactive) {
    return await db
      .select()
      .from(schema.facilityAssets)
      .orderBy(asc(schema.facilityAssets.assetCode))
      .limit(normalized.limit)
      .offset(normalized.offset);
  }
  return await db
    .select()
    .from(schema.facilityAssets)
    .where(eq(schema.facilityAssets.isActive, true))
    .orderBy(asc(schema.facilityAssets.assetCode))
    .limit(normalized.limit)
    .offset(normalized.offset);
}

export async function getAsset(
  db: Database,
  id: string,
): Promise<schema.FacilityAsset | undefined> {
  const rows = await db
    .select()
    .from(schema.facilityAssets)
    .where(eq(schema.facilityAssets.id, id));
  return rows[0];
}

async function assertAssetCategoryExists(db: Database, categoryId: string): Promise<void> {
  const rows = await db
    .select({ id: schema.facilityCategories.id })
    .from(schema.facilityCategories)
    .where(eq(schema.facilityCategories.id, categoryId));
  if (rows.length === 0) {
    throw badRequest('Category not found');
  }
}

async function assertAssetLocationExists(db: Database, locationId: string): Promise<void> {
  const rows = await db
    .select({ id: schema.locations.id })
    .from(schema.locations)
    .where(eq(schema.locations.id, locationId));
  if (rows.length === 0) {
    throw badRequest('Location not found');
  }
}

export async function createAsset(
  db: Database,
  input: AssetCreateInput,
  ctx: AuditContext,
): Promise<schema.FacilityAsset> {
  const errors = validateAssetInput(input);
  if (errors.length > 0) {
    invalidInput('Invalid asset input', errors);
  }
  const assetCode = input.assetCode.trim();
  const clash = await db
    .select({ id: schema.facilityAssets.id })
    .from(schema.facilityAssets)
    .where(eq(schema.facilityAssets.assetCode, assetCode));
  if (clash.length > 0) {
    throw conflict(`Asset code '${assetCode}' already exists`);
  }
  if (input.categoryId !== undefined && input.categoryId !== null) {
    await assertAssetCategoryExists(db, input.categoryId);
  }
  if (input.locationId !== undefined && input.locationId !== null) {
    await assertAssetLocationExists(db, input.locationId);
  }
  try {
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.facilityAssets)
        .values({
          assetCode,
          name: input.name.trim(),
          categoryId: input.categoryId ?? null,
          locationId: input.locationId ?? null,
          // Column default is 15; explicit pass-through keeps the row
          // identical whether the caller omits weight or sends 15.
          weight: input.weight ?? 15,
          quantity: input.quantity ?? null,
          isActive: input.isActive ?? true,
        })
        .returning();
      const row = inserted[0];
      if (row === undefined) {
        throw internal('Failed to create asset');
      }
      await tx.insert(schema.auditLogs).values(
        buildAuditValues({
          action: AUDIT_ACTION_CREATED,
          entityType: ENTITY_FACILITY_ASSETS,
          entityId: row.id,
          after: row,
          actorId: ctx.actorId,
          requestId: ctx.requestId,
        }),
      );
      return row;
    });
  } catch (error) {
    throwMappedUniqueViolation(error, `Asset code '${assetCode}' already exists`);
  }
}

export async function updateAsset(
  db: Database,
  id: string,
  patch: AssetPatch,
  ctx: AuditContext,
): Promise<schema.FacilityAsset> {
  const existing = await getAsset(db, id);
  if (existing === undefined) {
    throw notFound('Asset not found');
  }
  const clean = stripUndefined(patch);
  if (Object.keys(clean).length === 0) {
    return existing;
  }
  const merged: Record<string, unknown> = {
    assetCode: existing.assetCode,
    name: existing.name,
    categoryId: existing.categoryId,
    locationId: existing.locationId,
    weight: existing.weight,
    quantity: existing.quantity,
    isActive: existing.isActive,
    ...clean,
  };
  const errors = validateAssetInput(merged);
  if (errors.length > 0) {
    invalidInput('Invalid asset input', errors);
  }
  if (
    clean['assetCode'] !== undefined &&
    typeof clean['assetCode'] === 'string' &&
    clean['assetCode'].trim() !== existing.assetCode
  ) {
    const clash = await db
      .select({ id: schema.facilityAssets.id })
      .from(schema.facilityAssets)
      .where(eq(schema.facilityAssets.assetCode, (clean['assetCode'] as string).trim()));
    if (clash.some((row) => row.id !== id)) {
      throw conflict(`Asset code '${(clean['assetCode'] as string).trim()}' already exists`);
    }
  }
  if (clean['categoryId'] !== undefined && clean['categoryId'] !== null) {
    await assertAssetCategoryExists(db, clean['categoryId'] as string);
  }
  if (clean['locationId'] !== undefined && clean['locationId'] !== null) {
    await assertAssetLocationExists(db, clean['locationId'] as string);
  }
  const set: Partial<typeof schema.facilityAssets.$inferInsert> = {};
  if (clean['assetCode'] !== undefined) {
    set.assetCode = (clean['assetCode'] as string).trim();
  }
  if (clean['name'] !== undefined) {
    set.name = (clean['name'] as string).trim();
  }
  if (clean['categoryId'] !== undefined) {
    set.categoryId = clean['categoryId'] as string | null;
  }
  if (clean['locationId'] !== undefined) {
    set.locationId = clean['locationId'] as string | null;
  }
  if (clean['weight'] !== undefined) {
    set.weight = clean['weight'] as number;
  }
  if (clean['quantity'] !== undefined) {
    set.quantity = clean['quantity'] as number | null;
  }
  if (clean['isActive'] !== undefined) {
    set.isActive = clean['isActive'] as boolean;
  }
  const action = auditActionForUpdate(clean['isActive'] === false);
  try {
    return await db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.facilityAssets)
        .set(set)
        .where(eq(schema.facilityAssets.id, id))
        .returning();
      const row = updated[0];
      if (row === undefined) {
        throw internal('Failed to update asset');
      }
      await tx.insert(schema.auditLogs).values(
        buildAuditValues({
          action,
          entityType: ENTITY_FACILITY_ASSETS,
          entityId: row.id,
          before: existing,
          after: row,
          actorId: ctx.actorId,
          requestId: ctx.requestId,
        }),
      );
      return row;
    });
  } catch (error) {
    throwMappedUniqueViolation(error, 'Asset code already exists');
  }
}

export async function archiveAsset(
  db: Database,
  id: string,
  ctx: AuditContext,
): Promise<schema.FacilityAsset> {
  const existing = await getAsset(db, id);
  if (existing === undefined) {
    throw notFound('Asset not found');
  }
  if (!existing.isActive) {
    return existing;
  }
  return await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.facilityAssets)
      .set({ isActive: false })
      .where(eq(schema.facilityAssets.id, id))
      .returning();
    const row = updated[0];
    if (row === undefined) {
      throw internal('Failed to archive asset');
    }
    await tx.insert(schema.auditLogs).values(
      buildAuditValues({
        action: AUDIT_ACTION_ARCHIVED,
        entityType: ENTITY_FACILITY_ASSETS,
        entityId: row.id,
        before: existing,
        after: row,
        actorId: ctx.actorId,
        requestId: ctx.requestId,
      }),
    );
    return row;
  });
}

// ---------------------------------------------------------------------------
// Technicians (displayName is NOT unique — only technicianCode is).
// ---------------------------------------------------------------------------

export async function listTechnicians(
  db: Database,
  options?: ListOptions,
): Promise<schema.Technician[]> {
  const normalized = normalizeListOptions(options);
  if (normalized.includeInactive) {
    return await db
      .select()
      .from(schema.technicians)
      .orderBy(asc(schema.technicians.technicianCode))
      .limit(normalized.limit)
      .offset(normalized.offset);
  }
  return await db
    .select()
    .from(schema.technicians)
    .where(eq(schema.technicians.isActive, true))
    .orderBy(asc(schema.technicians.technicianCode))
    .limit(normalized.limit)
    .offset(normalized.offset);
}

export async function getTechnician(
  db: Database,
  id: string,
): Promise<schema.Technician | undefined> {
  const rows = await db
    .select()
    .from(schema.technicians)
    .where(eq(schema.technicians.id, id));
  return rows[0];
}

export async function createTechnician(
  db: Database,
  input: TechnicianCreateInput,
  ctx: AuditContext,
): Promise<schema.Technician> {
  const errors = validateTechnicianInput(input);
  if (errors.length > 0) {
    invalidInput('Invalid technician input', errors);
  }
  const technicianCode = input.technicianCode.trim();
  const clash = await db
    .select({ id: schema.technicians.id })
    .from(schema.technicians)
    .where(eq(schema.technicians.technicianCode, technicianCode));
  if (clash.length > 0) {
    throw conflict(`Technician code '${technicianCode}' already exists`);
  }
  try {
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.technicians)
        .values({
          technicianCode,
          displayName: input.displayName.trim(),
          specialty: input.specialty ?? null,
          isActive: input.isActive ?? true,
        })
        .returning();
      const row = inserted[0];
      if (row === undefined) {
        throw internal('Failed to create technician');
      }
      await tx.insert(schema.auditLogs).values(
        buildAuditValues({
          action: AUDIT_ACTION_CREATED,
          entityType: ENTITY_TECHNICIANS,
          entityId: row.id,
          after: row,
          actorId: ctx.actorId,
          requestId: ctx.requestId,
        }),
      );
      return row;
    });
  } catch (error) {
    throwMappedUniqueViolation(error, `Technician code '${technicianCode}' already exists`);
  }
}

export async function updateTechnician(
  db: Database,
  id: string,
  patch: TechnicianPatch,
  ctx: AuditContext,
): Promise<schema.Technician> {
  const existing = await getTechnician(db, id);
  if (existing === undefined) {
    throw notFound('Technician not found');
  }
  const clean = stripUndefined(patch);
  if (Object.keys(clean).length === 0) {
    return existing;
  }
  const merged: Record<string, unknown> = {
    technicianCode: existing.technicianCode,
    displayName: existing.displayName,
    specialty: existing.specialty,
    isActive: existing.isActive,
    ...clean,
  };
  const errors = validateTechnicianInput(merged);
  if (errors.length > 0) {
    invalidInput('Invalid technician input', errors);
  }
  if (
    clean['technicianCode'] !== undefined &&
    typeof clean['technicianCode'] === 'string' &&
    clean['technicianCode'].trim() !== existing.technicianCode
  ) {
    const clash = await db
      .select({ id: schema.technicians.id })
      .from(schema.technicians)
      .where(eq(schema.technicians.technicianCode, (clean['technicianCode'] as string).trim()));
    if (clash.some((row) => row.id !== id)) {
      throw conflict(
        `Technician code '${(clean['technicianCode'] as string).trim()}' already exists`,
      );
    }
  }
  const set: Partial<typeof schema.technicians.$inferInsert> = {};
  if (clean['technicianCode'] !== undefined) {
    set.technicianCode = (clean['technicianCode'] as string).trim();
  }
  if (clean['displayName'] !== undefined) {
    set.displayName = (clean['displayName'] as string).trim();
  }
  if (clean['specialty'] !== undefined) {
    set.specialty = clean['specialty'] as string | null;
  }
  if (clean['isActive'] !== undefined) {
    set.isActive = clean['isActive'] as boolean;
  }
  const action = auditActionForUpdate(clean['isActive'] === false);
  try {
    return await db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.technicians)
        .set(set)
        .where(eq(schema.technicians.id, id))
        .returning();
      const row = updated[0];
      if (row === undefined) {
        throw internal('Failed to update technician');
      }
      await tx.insert(schema.auditLogs).values(
        buildAuditValues({
          action,
          entityType: ENTITY_TECHNICIANS,
          entityId: row.id,
          before: existing,
          after: row,
          actorId: ctx.actorId,
          requestId: ctx.requestId,
        }),
      );
      return row;
    });
  } catch (error) {
    throwMappedUniqueViolation(error, 'Technician code already exists');
  }
}

export async function archiveTechnician(
  db: Database,
  id: string,
  ctx: AuditContext,
): Promise<schema.Technician> {
  const existing = await getTechnician(db, id);
  if (existing === undefined) {
    throw notFound('Technician not found');
  }
  if (!existing.isActive) {
    return existing;
  }
  return await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.technicians)
      .set({ isActive: false })
      .where(eq(schema.technicians.id, id))
      .returning();
    const row = updated[0];
    if (row === undefined) {
      throw internal('Failed to archive technician');
    }
    await tx.insert(schema.auditLogs).values(
      buildAuditValues({
        action: AUDIT_ACTION_ARCHIVED,
        entityType: ENTITY_TECHNICIANS,
        entityId: row.id,
        before: existing,
        after: row,
        actorId: ctx.actorId,
        requestId: ctx.requestId,
      }),
    );
    return row;
  });
}
