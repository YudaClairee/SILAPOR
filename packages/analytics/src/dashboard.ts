import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { REPORT_STATUS } from '@silapor/domain';
import {
  facilityCategories,
  locations,
  maintenanceReports,
  normalizeListOptions,
  reportAssignments,
  technicians,
} from '@silapor/database';
import type { DatabaseConnection } from '@silapor/database';
import { jakartaMonthBoundsUtc } from './time.js';

export type AnalyticsDb = DatabaseConnection['db'];

export interface DashboardRange {
  readonly from?: Date;
  readonly toExclusive?: Date;
}

export interface OverviewCards {
  readonly totalReports: number;
  readonly activeReports: number;
  readonly inRepair: number;
  readonly highPriorityActive: number;
  readonly resolvedThisMonth: number;
}

export interface StatusCount {
  readonly status: string;
  readonly count: number;
}

export interface CategoryCount {
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly count: number;
}

export interface LocationCount {
  readonly locationId: string;
  readonly locationName: string;
  readonly count: number;
}

export interface ResolutionTimeMetrics {
  readonly sampleSize: number;
  readonly averageSeconds: number | null;
  readonly medianSeconds: number | null;
}

export interface TechnicianWorkloadItem {
  readonly technicianId: string;
  readonly technicianName: string;
  readonly activeCount: number;
}

export interface PriorityQueueItem {
  readonly reportId: string;
  readonly ticketNumber: string;
  readonly status: string;
  readonly finalPriority: string | null;
  readonly reportedAt: Date;
}

const DEFAULT_CATEGORY_LIMIT = 8;
const DEFAULT_LOCATION_LIMIT = 8;
const DEFAULT_QUEUE_LIMIT = 10;

const WORKLOAD_STATUSES = ['ASSIGNED', 'INSPECTION', 'IN_REPAIR'] as const;
const QUEUE_STATUSES = ['REPORTED', 'VERIFIED', 'ASSIGNED', 'INSPECTION', 'IN_REPAIR'] as const;

function canonicalStatuses(): SQL {
  return inArray(maintenanceReports.status, [...REPORT_STATUS]);
}

function reportedConditions(range: DashboardRange): SQL[] {
  const conditions: SQL[] = [canonicalStatuses()];
  if (range.from !== undefined) {
    conditions.push(gte(maintenanceReports.reportedAt, range.from));
  }
  if (range.toExclusive !== undefined) {
    conditions.push(lt(maintenanceReports.reportedAt, range.toExclusive));
  }
  return conditions;
}

async function countWhere(db: AnalyticsDb, conditions: SQL[]): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(maintenanceReports)
    .where(and(...conditions));
  return rows[0]?.value ?? 0;
}

export async function getOverviewCards(
  db: AnalyticsDb,
  range: DashboardRange,
  now: Date = new Date(),
): Promise<OverviewCards> {
  const reported = reportedConditions(range);
  const month = jakartaMonthBoundsUtc(now);
  const [totalReports, activeReports, inRepair, highPriorityActive, resolvedThisMonth] =
    await Promise.all([
      countWhere(db, reported),
      countWhere(db, [...reported, ne(maintenanceReports.status, 'CLOSED')]),
      countWhere(db, [...reported, eq(maintenanceReports.status, 'IN_REPAIR')]),
      countWhere(db, [
        ...reported,
        ne(maintenanceReports.status, 'CLOSED'),
        eq(maintenanceReports.finalPriority, 'HIGH'),
      ]),
      countWhere(db, [
        canonicalStatuses(),
        isNotNull(maintenanceReports.resolvedAt),
        gte(maintenanceReports.resolvedAt, month.start),
        lt(maintenanceReports.resolvedAt, month.endExclusive),
      ]),
    ]);
  return { totalReports, activeReports, inRepair, highPriorityActive, resolvedThisMonth };
}

export async function getReportsByStatus(
  db: AnalyticsDb,
  range: DashboardRange,
): Promise<StatusCount[]> {
  const rows = await db
    .select({ status: maintenanceReports.status, value: count() })
    .from(maintenanceReports)
    .where(
      and(
        ...reportedConditions(range),
        // Mirrors the report list's REPORTED held-queue exclusion, so the
        // chart drill-down and the list agree on the same filter. Other
        // facets (cards, total) still count these rows.
        or(
          ne(maintenanceReports.status, 'REPORTED'),
          isNotNull(maintenanceReports.finalCategoryId),
          sql`NOT EXISTS (SELECT 1 FROM report_relations rr WHERE rr.source_report_id = ${maintenanceReports.id} AND rr.relation_type = 'SUPPORTING')`,
        ),
      ),
    )
    .groupBy(maintenanceReports.status);
  const counts = new Map(rows.map((row) => [row.status, row.value]));
  return REPORT_STATUS.map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

export async function getReportsByCategory(
  db: AnalyticsDb,
  range: DashboardRange,
  limit: number = DEFAULT_CATEGORY_LIMIT,
): Promise<CategoryCount[]> {
  const rows = await db
    .select({
      categoryId: maintenanceReports.finalCategoryId,
      categoryName: facilityCategories.name,
      value: count(),
    })
    .from(maintenanceReports)
    .leftJoin(
      facilityCategories,
      eq(facilityCategories.id, maintenanceReports.finalCategoryId),
    )
    .where(and(...reportedConditions(range)))
    .groupBy(maintenanceReports.finalCategoryId, facilityCategories.name)
    .orderBy(
      desc(count()),
      asc(facilityCategories.name),
      asc(maintenanceReports.finalCategoryId),
    )
    .limit(limit);
  return rows.map((row) => ({
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    count: row.value,
  }));
}

export async function getReportsByLocation(
  db: AnalyticsDb,
  range: DashboardRange,
  limit: number = DEFAULT_LOCATION_LIMIT,
): Promise<LocationCount[]> {
  const rows = await db
    .select({
      locationId: maintenanceReports.locationId,
      locationName: locations.name,
      value: count(),
    })
    .from(maintenanceReports)
    .innerJoin(locations, eq(locations.id, maintenanceReports.locationId))
    .where(and(...reportedConditions(range)))
    .groupBy(maintenanceReports.locationId, locations.name)
    .orderBy(desc(count()), asc(locations.name), asc(maintenanceReports.locationId))
    .limit(limit);
  return rows.map((row) => ({
    locationId: row.locationId,
    locationName: row.locationName,
    count: row.value,
  }));
}

export async function getResolutionTimeMetrics(
  db: AnalyticsDb,
  range: DashboardRange,
): Promise<ResolutionTimeMetrics> {
  const conditions: SQL[] = [canonicalStatuses(), isNotNull(maintenanceReports.resolvedAt)];
  if (range.from !== undefined) {
    conditions.push(gte(maintenanceReports.resolvedAt, range.from));
  }
  if (range.toExclusive !== undefined) {
    conditions.push(lt(maintenanceReports.resolvedAt, range.toExclusive));
  }
  const rows = await db
    .select({
      sampleSize: count(),
      averageSeconds: sql<
        number | null
      >`avg(extract(epoch from (${maintenanceReports.resolvedAt} - ${maintenanceReports.reportedAt})))::double precision`,
      medianSeconds: sql<
        number | null
      >`percentile_cont(0.5) within group (order by extract(epoch from (${maintenanceReports.resolvedAt} - ${maintenanceReports.reportedAt})))`,
    })
    .from(maintenanceReports)
    .where(and(...conditions));
  const row = rows[0];
  const sampleSize = row?.sampleSize ?? 0;
  if (sampleSize === 0) {
    return { sampleSize: 0, averageSeconds: null, medianSeconds: null };
  }
  return {
    sampleSize,
    averageSeconds: Math.round(Number(row?.averageSeconds)),
    medianSeconds: Math.round(Number(row?.medianSeconds)),
  };
}

export async function getTechnicianWorkload(
  db: AnalyticsDb,
): Promise<TechnicianWorkloadItem[]> {
  return db
    .select({
      technicianId: technicians.id,
      technicianName: technicians.displayName,
      activeCount: count(maintenanceReports.id),
    })
    .from(technicians)
    .leftJoin(
      reportAssignments,
      and(
        eq(reportAssignments.technicianId, technicians.id),
        isNull(reportAssignments.unassignedAt),
      ),
    )
    .leftJoin(
      maintenanceReports,
      and(
        eq(maintenanceReports.id, reportAssignments.reportId),
        inArray(maintenanceReports.status, [...WORKLOAD_STATUSES]),
      ),
    )
    .where(eq(technicians.isActive, true))
    .groupBy(technicians.id, technicians.displayName)
    .orderBy(
      desc(count(maintenanceReports.id)),
      asc(technicians.displayName),
      asc(technicians.id),
    );
}

export async function getPriorityQueue(
  db: AnalyticsDb,
  limit: number = DEFAULT_QUEUE_LIMIT,
): Promise<PriorityQueueItem[]> {
  const take = normalizeListOptions({ limit }).limit;
  return db
    .select({
      reportId: maintenanceReports.id,
      ticketNumber: maintenanceReports.ticketNumber,
      status: maintenanceReports.status,
      finalPriority: maintenanceReports.finalPriority,
      reportedAt: maintenanceReports.reportedAt,
    })
    .from(maintenanceReports)
    .where(inArray(maintenanceReports.status, [...QUEUE_STATUSES]))
    .orderBy(
      sql`case ${maintenanceReports.finalPriority} when 'HIGH' then 0 when 'MEDIUM' then 1 when 'LOW' then 2 else 3 end asc`,
      asc(maintenanceReports.reportedAt),
      asc(maintenanceReports.id),
    )
    .limit(take);
}
