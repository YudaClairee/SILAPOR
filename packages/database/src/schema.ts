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
  real,
  text,
  timestamp,
  unique,
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

// Phase 3 P3-1: report tables + ticket sequence. Values mirror
// `REPORT_STATUS` / `RELATION_TYPE` in `@silapor/domain` (verbatim).

export const reportStatusEnum = pgEnum('report_status', [
  'REPORTED',
  'VERIFIED',
  'ASSIGNED',
  'INSPECTION',
  'IN_REPAIR',
  'RESOLVED',
  'CLOSED',
  'REJECTED',
  'DUPLICATE',
]);

export const maintenanceReports = pgTable(
  'maintenance_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketNumber: text('ticket_number').notNull().unique(),
    // Client UUID per form instance (safe retries).
    idempotencyKey: text('idempotency_key').notNull().unique(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    assetId: uuid('asset_id').references(() => facilityAssets.id, { onDelete: 'restrict' }),
    submittedCategoryId: uuid('submitted_category_id')
      .notNull()
      .references(() => facilityCategories.id, { onDelete: 'restrict' }),
    submittedIssueTypeId: uuid('submitted_issue_type_id').references(() => issueTypes.id, {
      onDelete: 'restrict',
    }),
    finalCategoryId: uuid('final_category_id').references(() => facilityCategories.id, {
      onDelete: 'restrict',
    }),
    finalIssueTypeId: uuid('final_issue_type_id').references(() => issueTypes.id, {
      onDelete: 'restrict',
    }),
    description: text('description').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    status: reportStatusEnum('status').notNull().default('REPORTED'),
    duplicateOfReportId: uuid('duplicate_of_report_id').references(
      (): AnyPgColumn => maintenanceReports.id,
      { onDelete: 'restrict' },
    ),
    priorityScore: integer('priority_score'),
    priorityFactors: jsonb('priority_factors'),
    // LOW|MEDIUM|HIGH enforced by validator, NOT pgEnum (Phase 5 owns scoring).
    finalPriority: text('final_priority'),
    // P5-2: priority audit — admin override reason + decider + config version.
    priorityOverrideReason: text('priority_override_reason'),
    priorityDecidedBy: uuid('priority_decided_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    priorityDecidedAt: timestamp('priority_decided_at', { withTimezone: true }),
    scoringConfigVersion: integer('scoring_config_version').notNull().default(1),
    // Optimistic locking; P3-2+ increments on every mutation.
    version: integer('version').notNull().default(1),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('maintenance_reports_reporter_reported_idx').on(table.reporterId, table.reportedAt),
    index('maintenance_reports_status_reported_idx').on(table.status, table.reportedAt),
    index('maintenance_reports_final_category_idx').on(table.finalCategoryId),
    index('maintenance_reports_submitted_category_idx').on(table.submittedCategoryId),
    index('maintenance_reports_location_idx').on(table.locationId),
    index('maintenance_reports_asset_idx').on(table.assetId),
    index('maintenance_reports_duplicate_of_idx').on(table.duplicateOfReportId),
    index('maintenance_reports_reporter_asset_status_idx').on(
      table.reporterId,
      table.assetId,
      table.status,
    ),
    index('maintenance_reports_resolved_at_idx').on(table.resolvedAt),
    check(
      'maintenance_reports_priority_score_check',
      sql`${table.priorityScore} IS NULL OR (${table.priorityScore} >= 0 AND ${table.priorityScore} <= 100)`,
    ),
  ],
);

export const reportAttachments = pgTable(
  'report_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => maintenanceReports.id, { onDelete: 'cascade' }),
    // Random storage key, never the original filename.
    storageKey: text('storage_key').notNull(),
    // Metadata only.
    originalFilename: text('original_filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    checksum: text('checksum').notNull(),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('report_attachments_report_id_idx').on(table.reportId)],
);

// Append-only: NO update/delete repo functions (P3-2+ writes inserts only).
export const reportEvents = pgTable(
  'report_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => maintenanceReports.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    fromValue: jsonb('from_value'),
    toValue: jsonb('to_value'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('report_events_report_created_idx').on(table.reportId, table.createdAt)],
);

// P5-2: assignment history — one active technician at a time enforced in
// code (P5-4), not via partial unique index (keeps migration simple).
export const reportAssignments = pgTable(
  'report_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => maintenanceReports.id, { onDelete: 'cascade' }),
    technicianId: uuid('technician_id')
      .notNull()
      .references(() => technicians.id, { onDelete: 'restrict' }),
    assignedBy: uuid('assigned_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    unassignedAt: timestamp('unassigned_at', { withTimezone: true }),
    reason: text('reason'),
  },
  (table) => [
    index('report_assignments_report_assigned_idx').on(table.reportId, table.assignedAt),
    index('report_assignments_report_id_idx').on(table.reportId),
  ],
);

// P5-2: PUBLIC vs INTERNAL append-only timeline entries.
export const reportUpdates = pgTable(
  'report_updates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => maintenanceReports.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    visibility: text('visibility').notNull(),
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('report_updates_report_created_idx').on(table.reportId, table.createdAt),
    check(
      'report_updates_visibility_check',
      sql`${table.visibility} IN ('PUBLIC', 'INTERNAL')`,
    ),
  ],
);

export const reportRelations = pgTable(
  'report_relations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceReportId: uuid('source_report_id')
      .notNull()
      .references(() => maintenanceReports.id, { onDelete: 'cascade' }),
    targetReportId: uuid('target_report_id')
      .notNull()
      .references(() => maintenanceReports.id, { onDelete: 'cascade' }),
    relationType: text('relation_type').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('report_relations_source_target_type_unique').on(
      table.sourceReportId,
      table.targetReportId,
      table.relationType,
    ),
    index('report_relations_target_type_idx').on(table.targetReportId, table.relationType),
    check(
      'report_relations_type_check',
      sql`${table.relationType} IN ('SUPPORTING', 'RELATED')`,
    ),
  ],
);

export const ticketCounters = pgTable('ticket_counters', {
  year: integer('year').primaryKey(),
  lastSeq: integer('last_seq').notNull().default(0),
});

export type Report = typeof maintenanceReports.$inferSelect;
export type NewReport = typeof maintenanceReports.$inferInsert;
export type ReportAttachment = typeof reportAttachments.$inferSelect;
export type NewReportAttachment = typeof reportAttachments.$inferInsert;
export type ReportEvent = typeof reportEvents.$inferSelect;
export type NewReportEvent = typeof reportEvents.$inferInsert;
export type ReportAssignment = typeof reportAssignments.$inferSelect;
export type NewReportAssignment = typeof reportAssignments.$inferInsert;
export type ReportUpdate = typeof reportUpdates.$inferSelect;
export type NewReportUpdate = typeof reportUpdates.$inferInsert;
export type ReportRelation = typeof reportRelations.$inferSelect;
export type NewReportRelation = typeof reportRelations.$inferInsert;
export type TicketCounter = typeof ticketCounters.$inferSelect;
export type NewTicketCounter = typeof ticketCounters.$inferInsert;

// Task 4: ai_analyses persistence (AI verification). Columns per
// EXECUTION-PLAN §7.1 plus the brief's verdict fields (`category`,
// `issue_type`, `priority` — the AI-decided finals exercised by the Task 4
// test and consumed by future Tasks 5/6). Canonical priority column is
// `suggested_priority` (plan §7.1 authority); `priority` is a legacy mirror
// kept identical by `markAiAnalysis` and by the
// `ai_analyses_priority_mirror_check` constraint below. Raw prompt/response
// are NEVER stored — there are no such columns by design.

export const aiAnalysisStatusEnum = pgEnum('ai_analysis_status', [
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
]);

export const aiAnalyses = pgTable(
  'ai_analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => maintenanceReports.id, { onDelete: 'cascade' }),
    status: aiAnalysisStatusEnum('status').notNull().default('PENDING'),
    verificationRecommendation: text('verification_recommendation'),
    category: text('category'),
    issueType: text('issue_type'),
    priority: text('priority'),
    possibleDuplicate: boolean('possible_duplicate'),
    suggestedPriority: text('suggested_priority'),
    riskFactors: jsonb('risk_factors'),
    impactFactors: jsonb('impact_factors'),
    confidence: real('confidence'),
    reasoningSummary: text('reasoning_summary'),
    gateway: text('gateway').notNull().default('openrouter'),
    upstreamProvider: text('upstream_provider'),
    model: text('model').notNull(),
    gatewayRequestId: text('gateway_request_id'),
    promptVersion: text('prompt_version').notNull(),
    schemaVersion: text('schema_version').notNull(),
    privacyMode: text('privacy_mode').notNull().default('ZDR'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    estimatedCost: real('estimated_cost'),
    attemptCount: integer('attempt_count').notNull().default(0),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('ai_analyses_report_id_idx').on(table.reportId),
    check(
      'ai_analyses_priority_mirror_check',
      sql`${table.priority} IS NOT DISTINCT FROM ${table.suggestedPriority}`,
    ),
  ],
);

export type AiAnalysis = typeof aiAnalyses.$inferSelect;
export type NewAiAnalysis = typeof aiAnalyses.$inferInsert;
