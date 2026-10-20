// Facility status projection + maintenance history (Phase 6 P6-2).
//
// Facility status is DERIVED from active reports (plan §4.6) — never stored.
// The public projection carries ONLY: asset identity/display name, safe
// location label, category name, derived status, and lastUpdated (plan step
// 5). No reporter identity, description, attachment reference, or internal
// note ever enters these rows by construction — the SELECT lists project
// specific columns only.
//
// The maintenance-history projection is admin-only and carries one extra
// display layer for the Histori Perbaikan Aset page (Figma 150:1264): the
// resolved issue-type name (`final` preferred, `submitted` fallback) and the
// active technician `displayName` per ticket. Only display names pass through
// — never technician PII (phone) or reporter identity. Duration is derived
// client-side from `reportedAt`/`resolvedAt`, so the DB stays a factual
// transport.
//
// The Kelola Aset table (Figma 150:1748) needs two more safe display fields
// on the SAME status projection: `buildingName` (derived from the room's
// denormalised building_code via the BUILDING row, null when the asset has
// no room/building) and `categoryId` (the raw FK for the client-side
// category filter). Both are display/filter keys only — still no report
// content. The install-year column comes from the asset's `createdAt`
// (Jakarta year, derived client-side); facility_assets carries no dedicated
// procurement-year column.
//
// Behavior rulings (ledger): inactive assets are excluded unless
// `includeInactive` is set (admin list); assets without active reports are
// OPERATIONAL; `lastUpdated` is the latest active report's reported_at when
// one exists, else the asset's own updated_at. Ordering is deterministic:
// operational severity desc, then assetCode asc (problematic facilities
// first). This module logs nothing and carries no PII in messages.

import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { badRequest, notFound } from '@silapor/shared';
import {
  ACTIVE_REPORT_STATUSES,
  deriveFacilityStatus,
  facilityStatusSeverity,
  FACILITY_STATUSES,
  type FacilityStatus,
  type PriorityLevel,
  type ReportStatus,
} from '@silapor/domain';
import * as schema from './schema.js';
import { normalizeListOptions } from './master-data.js';

type Database = PostgresJsDatabase<typeof schema>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FACILITY_STATUS_SET: ReadonlySet<string> = new Set(FACILITY_STATUSES);

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw badRequest(`${field} must be a valid UUID`);
  }
  return value;
}

function optionalUuid(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return requireUuid(value, field);
}

function requireFacilityStatus(value: unknown): FacilityStatus {
  if (typeof value !== 'string' || !FACILITY_STATUS_SET.has(value)) {
    throw badRequest('Invalid facility status');
  }
  return value as FacilityStatus;
}

// ---------------------------------------------------------------------------
// Public facility status projection (reporter + admin, sanitized).
// ---------------------------------------------------------------------------

export interface FacilityStatusItem {
  readonly assetId: string;
  readonly assetCode: string;
  readonly assetName: string;
  // Building + room display label only — never free-text report content.
  readonly locationLabel: string;
  /** Building display name (null when the asset has no room/building). */
  readonly buildingName: string | null;
  readonly categoryName: string | null;
  /** Raw category FK for the client-side KATEGORI filter. */
  readonly categoryId: string | null;
  readonly derivedStatus: FacilityStatus;
  readonly isActive: boolean;
  readonly activeReportCount: number;
  readonly lastUpdated: Date;
  /** Asset creation timestamp — the TAHUN column derives its Jakarta year. */
  readonly createdAt: Date;
}

export interface FacilityStatusResult {
  readonly items: readonly FacilityStatusItem[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface FacilityStatusOptions {
  readonly locationId?: unknown;
  readonly categoryId?: unknown;
  readonly status?: unknown;
  readonly includeInactive?: boolean | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

// "Gedung X · Ruang Y" — building name resolved from the room's denormalised
// building_code; falls back to whichever part exists.
export function buildLocationLabel(
  roomName: string | null,
  buildingName: string | null,
): string {
  if (buildingName !== null && roomName !== null && buildingName !== roomName) {
    return `${buildingName} · ${roomName}`;
  }
  return roomName ?? buildingName ?? '';
}

interface AssetStatusBucket {
  statuses: string[];
  latestReportedAt: Date | null;
}

export async function listFacilityStatus(
  db: Database,
  options?: FacilityStatusOptions,
): Promise<FacilityStatusResult> {
  const locationId = optionalUuid(options?.locationId, 'locationId');
  const categoryId = optionalUuid(options?.categoryId, 'categoryId');
  const statusFilter =
    options?.status === undefined || options?.status === null || options?.status === ''
      ? undefined
      : requireFacilityStatus(options.status);
  const includeInactive = options?.includeInactive ?? false;
  const page = normalizeListOptions({ limit: options?.limit, offset: options?.offset });

  // Step 1: asset rows with safe display labels (active only by default).
  const assetConditions = [];
  if (!includeInactive) {
    assetConditions.push(eq(schema.facilityAssets.isActive, true));
  }
  if (locationId !== undefined) {
    assetConditions.push(eq(schema.facilityAssets.locationId, locationId));
  }
  if (categoryId !== undefined) {
    assetConditions.push(eq(schema.facilityAssets.categoryId, categoryId));
  }
  const assets = await db
    .select({
      id: schema.facilityAssets.id,
      assetCode: schema.facilityAssets.assetCode,
      name: schema.facilityAssets.name,
      isActive: schema.facilityAssets.isActive,
      createdAt: schema.facilityAssets.createdAt,
      updatedAt: schema.facilityAssets.updatedAt,
      categoryId: schema.facilityAssets.categoryId,
      categoryName: schema.facilityCategories.name,
      roomName: schema.locations.name,
      roomBuildingCode: schema.locations.buildingCode,
    })
    .from(schema.facilityAssets)
    .leftJoin(
      schema.facilityCategories,
      eq(schema.facilityAssets.categoryId, schema.facilityCategories.id),
    )
    .leftJoin(schema.locations, eq(schema.facilityAssets.locationId, schema.locations.id))
    .where(assetConditions.length > 0 ? and(...assetConditions) : undefined);

  // Step 2: building names for the rooms involved (one small query).
  const buildingCodes = [
    ...new Set(
      assets
        .map((asset) => asset.roomBuildingCode)
        .filter((code): code is string => code !== null),
    ),
  ];
  const buildingNames = new Map<string, string>();
  if (buildingCodes.length > 0) {
    const buildings = await db
      .select({ code: schema.locations.code, name: schema.locations.name })
      .from(schema.locations)
      .where(
        and(
          eq(schema.locations.type, 'BUILDING'),
          inArray(schema.locations.code, buildingCodes),
        ),
      );
    for (const building of buildings) {
      buildingNames.set(building.code, building.name);
    }
  }

  // Step 3: active report statuses per asset — derivation stays in the pure
  // domain function (plan §12.1); this query selects status columns only.
  const assetIds = assets.map((asset) => asset.id);
  const activeRows =
    assetIds.length > 0
      ? await db
          .select({
            assetId: schema.maintenanceReports.assetId,
            status: schema.maintenanceReports.status,
            reportedAt: schema.maintenanceReports.reportedAt,
          })
          .from(schema.maintenanceReports)
          .where(
            and(
              inArray(schema.maintenanceReports.assetId, assetIds),
              inArray(schema.maintenanceReports.status, [...ACTIVE_REPORT_STATUSES]),
            ),
          )
          .orderBy(asc(schema.maintenanceReports.reportedAt))
      : [];
  const activeByAsset = new Map<string, AssetStatusBucket>();
  for (const row of activeRows) {
    if (row.assetId === null) {
      continue;
    }
    const bucket = activeByAsset.get(row.assetId) ?? {
      statuses: [],
      latestReportedAt: null,
    };
    bucket.statuses.push(row.status);
    bucket.latestReportedAt = row.reportedAt;
    activeByAsset.set(row.assetId, bucket);
  }

  // Step 4: derive, optionally filter by derived status, deterministic order.
  const items: FacilityStatusItem[] = assets.map((asset) => {
    const active =
      activeByAsset.get(asset.id) ??
      ({ statuses: [], latestReportedAt: null } as AssetStatusBucket);
    const buildingName =
      asset.roomBuildingCode === null ? null : (buildingNames.get(asset.roomBuildingCode) ?? null);
    return {
      assetId: asset.id,
      assetCode: asset.assetCode,
      assetName: asset.name,
      locationLabel: buildLocationLabel(asset.roomName, buildingName),
      buildingName,
      categoryName: asset.categoryName,
      categoryId: asset.categoryId,
      derivedStatus: deriveFacilityStatus(active.statuses),
      isActive: asset.isActive,
      activeReportCount: active.statuses.length,
      lastUpdated: active.latestReportedAt ?? asset.updatedAt,
      createdAt: asset.createdAt,
    };
  });
  const filtered =
    statusFilter === undefined
      ? items
      : items.filter((item) => item.derivedStatus === statusFilter);
  filtered.sort((a, b) => {
    const severityDiff =
      facilityStatusSeverity(b.derivedStatus) - facilityStatusSeverity(a.derivedStatus);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    return a.assetCode < b.assetCode ? -1 : a.assetCode > b.assetCode ? 1 : 0;
  });
  return {
    items: filtered.slice(page.offset, page.offset + page.limit),
    total: filtered.length,
    limit: page.limit,
    offset: page.offset,
  };
}

// ---------------------------------------------------------------------------
// Maintenance history per asset (admin, plan steps 1–2).
// ---------------------------------------------------------------------------

export interface AssetMaintenanceHistoryItem {
  readonly reportId: string;
  readonly ticketNumber: string;
  readonly status: ReportStatus;
  readonly reportedAt: Date;
  readonly resolvedAt: Date | null;
  readonly closedAt: Date | null;
  readonly finalPriority: PriorityLevel | null;
  /**
   * Display name for the JENIS MASALAH column: `final` issue type preferred,
   * `submitted` fallback, null when the ticket predates classification.
   */
  readonly issueTypeName: string | null;
  /**
   * Display name only (`technicians.displayName`) of the active assignment
   * (`unassigned_at IS NULL`); null before assignment. Never PII.
   */
  readonly technicianName: string | null;
}

export interface AssetMaintenanceHistory {
  readonly asset: {
    readonly assetId: string;
    readonly assetCode: string;
    readonly assetName: string;
    readonly isActive: boolean;
    readonly locationLabel: string;
    readonly categoryName: string | null;
    readonly derivedStatus: FacilityStatus;
  };
  readonly items: readonly AssetMaintenanceHistoryItem[];
}

// All tickets for the asset (active AND historical), newest first. Unknown
// asset → 404; archived assets still return their history (histori lama
// tetap valid). Role enforcement stays with the caller (web layer).
export async function getFacilityMaintenanceHistory(
  db: Database,
  assetId: string,
): Promise<AssetMaintenanceHistory> {
  const id = requireUuid(assetId, 'assetId');
  const assetRows = await db
    .select({
      id: schema.facilityAssets.id,
      assetCode: schema.facilityAssets.assetCode,
      name: schema.facilityAssets.name,
      isActive: schema.facilityAssets.isActive,
      categoryName: schema.facilityCategories.name,
      roomName: schema.locations.name,
      roomBuildingCode: schema.locations.buildingCode,
    })
    .from(schema.facilityAssets)
    .leftJoin(
      schema.facilityCategories,
      eq(schema.facilityAssets.categoryId, schema.facilityCategories.id),
    )
    .leftJoin(schema.locations, eq(schema.facilityAssets.locationId, schema.locations.id))
    .where(eq(schema.facilityAssets.id, id));
  const asset = assetRows[0];
  if (asset === undefined) {
    throw notFound('Asset not found');
  }

  const reports = await db
    .select({
      id: schema.maintenanceReports.id,
      ticketNumber: schema.maintenanceReports.ticketNumber,
      status: schema.maintenanceReports.status,
      reportedAt: schema.maintenanceReports.reportedAt,
      resolvedAt: schema.maintenanceReports.resolvedAt,
      closedAt: schema.maintenanceReports.closedAt,
      finalPriority: schema.maintenanceReports.finalPriority,
      finalIssueTypeId: schema.maintenanceReports.finalIssueTypeId,
      submittedIssueTypeId: schema.maintenanceReports.submittedIssueTypeId,
    })
    .from(schema.maintenanceReports)
    .where(eq(schema.maintenanceReports.assetId, id))
    .orderBy(desc(schema.maintenanceReports.reportedAt));

  const activeStatuses = reports
    .filter((report) => (ACTIVE_REPORT_STATUSES as readonly string[]).includes(report.status))
    .map((report) => report.status);

  // Resolve display names for the history table (Figma 150:1264): issue type
  // (`final` preferred, `submitted` fallback) and the active technician.
  // Only display names cross this boundary — no reporter identity, no
  // technician PII, no report content.
  const issueTypeIds = Array.from(
    new Set(
      reports.flatMap((report) => [report.finalIssueTypeId, report.submittedIssueTypeId]),
    ),
  ).filter((value): value is string => value !== null);
  const reportIds = reports.map((report) => report.id);
  const [issueTypeRows, assignmentRows] = await Promise.all([
    issueTypeIds.length === 0
      ? Promise.resolve([] as Array<{ id: string; name: string }>)
      : db
          .select({ id: schema.issueTypes.id, name: schema.issueTypes.name })
          .from(schema.issueTypes)
          .where(inArray(schema.issueTypes.id, issueTypeIds)),
    reportIds.length === 0
      ? Promise.resolve([] as Array<{ reportId: string; technicianName: string; assignedAt: Date }>)
      : db
          .select({
            reportId: schema.reportAssignments.reportId,
            technicianName: schema.technicians.displayName,
            assignedAt: schema.reportAssignments.assignedAt,
          })
          .from(schema.reportAssignments)
          .innerJoin(
            schema.technicians,
            eq(schema.technicians.id, schema.reportAssignments.technicianId),
          )
          .where(
            and(
              inArray(schema.reportAssignments.reportId, reportIds),
              isNull(schema.reportAssignments.unassignedAt),
            ),
          )
          .orderBy(desc(schema.reportAssignments.assignedAt)),
  ]);
  const issueTypeNames = new Map(issueTypeRows.map((row) => [row.id, row.name] as const));
  // Assignment rows are newest-first, so the first hit per report wins.
  const technicianNames = new Map<string, string>();
  for (const row of assignmentRows) {
    if (!technicianNames.has(row.reportId)) {
      technicianNames.set(row.reportId, row.technicianName);
    }
  }

  let buildingName: string | null = null;
  if (asset.roomBuildingCode !== null) {
    const buildings = await db
      .select({ name: schema.locations.name })
      .from(schema.locations)
      .where(
        and(
          eq(schema.locations.type, 'BUILDING'),
          eq(schema.locations.code, asset.roomBuildingCode),
        ),
      );
    buildingName = buildings[0]?.name ?? null;
  }

  return {
    asset: {
      assetId: asset.id,
      assetCode: asset.assetCode,
      assetName: asset.name,
      isActive: asset.isActive,
      locationLabel: buildLocationLabel(asset.roomName, buildingName),
      categoryName: asset.categoryName,
      derivedStatus: deriveFacilityStatus(activeStatuses),
    },
    items: reports.map((report) => ({
      reportId: report.id,
      ticketNumber: report.ticketNumber,
      // Enum still carries legacy REJECTED/DUPLICATE labels (no new rows of
      // those exist since the AI-verification merge); drop when the pg enum
      // stops emitting them. Same DB-boundary-cast reasoning as finalPriority.
      status: report.status as ReportStatus,
      reportedAt: report.reportedAt,
      resolvedAt: report.resolvedAt,
      closedAt: report.closedAt,
      // Column is text with a DB check constraint on the three priority levels.
      finalPriority: report.finalPriority as PriorityLevel | null,
      // `final` classification wins; `submitted` is the pre-verification
      // fallback so REPORTED tickets still show a jenis masalah.
      issueTypeName:
        (report.finalIssueTypeId !== null
          ? (issueTypeNames.get(report.finalIssueTypeId) ?? null)
          : null) ??
        (report.submittedIssueTypeId !== null
          ? (issueTypeNames.get(report.submittedIssueTypeId) ?? null)
          : null),
      technicianName: technicianNames.get(report.id) ?? null,
    })),
  };
}
