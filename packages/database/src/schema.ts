// Drizzle schema (Phase 2 P2-1: §7 entity set — master data + sessions + audit).
//
// Phase 1 foundation (users username-based minimal + outbox_events) extended
// in place. Ledger rulings reused: username-only users (no name/email),
// numeric weights only, no scoring service, reporter_hidden lifted onto
// locations, generic issue_types with NULL category_id.

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['REPORTER', 'ADMIN']);

export const outboxStatusEnum = pgEnum('outbox_status', ['PENDING', 'DISPATCHED', 'FAILED']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Login identity: NIM (students), NIP (staff), or other official campus ID.
  // No name/email stored (Phase 0 §1, simplified 2026-10-10).
  username: text('username').notNull().unique(),
  // SSO subject; mock: same as username. Nullable for pre-SSO rows.
  externalUserId: text('external_user_id').unique(),
  // Verified NIM/NIP/identity; null for admin.
  nim: text('nim'),
  role: userRoleEnum('role').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // sha256 hex of raw token; never store raw.
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Null for campus/building roots.
    parentId: uuid('parent_id').references((): AnyPgColumn => locations.id, {
      onDelete: 'restrict',
    }),
    // CAMPUS|BUILDING|FLOOR|ROOM|SHARED_AREA (check constraint below).
    type: text('type').notNull(),
    // building_code e.g. 'C'; room_code e.g. '22.4C.02.015'.
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    // Denormalised for queries.
    buildingCode: text('building_code'),
    floorNumber: integer('floor_number'),
    // TIER_1|TIER_2|TIER_3|TIER_4.
    usageTier: text('usage_tier'),
    tierScore: integer('tier_score'),
    // True for LIFT rooms (reporter_hidden lift ruling).
    reporterHidden: boolean('reporter_hidden').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => [
    index('locations_parent_id_idx').on(table.parentId),
    index('locations_building_code_idx').on(table.buildingCode),
    index('locations_is_active_idx').on(table.isActive),
    check(
      'locations_type_check',
      sql`${table.type} IN ('CAMPUS', 'BUILDING', 'FLOOR', 'ROOM', 'SHARED_AREA')`,
    ),
    check(
      'locations_tier_score_check',
      sql`${table.tierScore} IS NULL OR (${table.tierScore} >= 0 AND ${table.tierScore} <= 30)`,
    ),
  ],
);

export const facilityCategories = pgTable(
  'facility_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // ELECTRICAL, HVAC, FURNITURE, ELECTRONIC, PLUMBING, OTHER + legacy inactive.
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    // v1: ELECTRICAL 40, HVAC 35, PLUMBING 35, ELECTRONIC 25, FURNITURE 15, OTHER 10.
    weight: integer('weight').notNull().default(10),
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => [
    check(
      'facility_categories_weight_check',
      sql`${table.weight} >= 0 AND ${table.weight} <= 40`,
    ),
  ],
);

export const issueTypes = pgTable(
  'issue_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // NULL = valid for all categories; 7 generic rows use NULL.
    categoryId: uuid('category_id').references(() => facilityCategories.id, {
      onDelete: 'restrict',
    }),
    // BROKEN, NOT_WORKING, MISSING, DIRTY, LEAKING, DANGEROUS, OTHER active;
    // legacy NOT_COOLING/LIGHT_OFF/POWER_FAILURE/NO_CONNECTION inactive.
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => [
    index('issue_types_category_id_idx').on(table.categoryId),
    index('issue_types_is_active_idx').on(table.isActive),
  ],
);

export const facilityAssets = pgTable(
  'facility_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetCode: text('asset_code').notNull().unique(),
    categoryId: uuid('category_id').references(() => facilityCategories.id, {
      onDelete: 'restrict',
    }),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    // v1 per data/master/facility-weights.csv ASSET rows.
    weight: integer('weight').notNull().default(15),
    quantity: integer('quantity'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('facility_assets_location_category_idx').on(table.locationId, table.categoryId),
    index('facility_assets_category_id_idx').on(table.categoryId),
    index('facility_assets_is_active_idx').on(table.isActive),
    check(
      'facility_assets_weight_check',
      sql`${table.weight} >= 0 AND ${table.weight} <= 30`,
    ),
  ],
);

export const technicians = pgTable('technicians', {
  id: uuid('id').primaryKey().defaultRandom(),
  // TECH-001..005.
  technicianCode: text('technician_code').notNull().unique(),
  // NOT unique — names may collide.
  displayName: text('display_name').notNull(),
  specialty: text('specialty'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    // e.g. MASTER_DATA_CREATED|UPDATED|ARCHIVED.
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    beforeData: jsonb('before_data'),
    afterData: jsonb('after_data'),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_entity_idx').on(table.entityType, table.entityId),
    index('audit_logs_actor_id_idx').on(table.actorId),
  ],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    status: outboxStatusEnum('status').notNull().default('PENDING'),
    attemptCount: integer('attempt_count').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [index('outbox_events_status_available_at_idx').on(table.status, table.availableAt)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;
export type FacilityCategory = typeof facilityCategories.$inferSelect;
export type NewFacilityCategory = typeof facilityCategories.$inferInsert;
export type IssueType = typeof issueTypes.$inferSelect;
export type NewIssueType = typeof issueTypes.$inferInsert;
export type FacilityAsset = typeof facilityAssets.$inferSelect;
export type NewFacilityAsset = typeof facilityAssets.$inferInsert;
export type Technician = typeof technicians.$inferSelect;
export type NewTechnician = typeof technicians.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;
