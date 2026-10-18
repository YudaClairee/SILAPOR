// Admin analytics overview transport (Phase 7): one dashboard read assembled
// from seven `@silapor/analytics` queries over a single connection. Query
// params `from`/`to` are `YYYY-MM-DD` Jakarta days, inclusive; `to` maps to
// the next-day 00:00 WIB exclusive bound, absent params mean unbounded. The
// response `range` echoes the raw validated strings. Logs nothing — the route
// logs opaque fields via `redact()`.
import {
  getOverviewCards,
  getPriorityQueue,
  getReportsByCategory,
  getReportsByLocation,
  getReportsByStatus,
  getResolutionTimeMetrics,
  getTechnicianWorkload,
  jakartaDayRange,
  type CategoryCount,
  type LocationCount,
  type OverviewCards,
  type PriorityQueueItem,
  type ResolutionTimeMetrics,
  type StatusCount,
  type TechnicianWorkloadItem,
} from '@silapor/analytics';
import { getDb } from '@silapor/database';
import { badRequest } from '@silapor/shared';
import { requireAdmin } from './auth';

export interface DashboardOverviewResponse {
  readonly range: { readonly from: string | null; readonly to: string | null };
  readonly cards: OverviewCards;
  readonly byStatus: StatusCount[];
  readonly byCategory: CategoryCount[];
  readonly byLocation: LocationCount[];
  readonly resolutionTime: ResolutionTimeMetrics;
  readonly technicianWorkload: TechnicianWorkloadItem[];
  readonly priorityQueue: PriorityQueueItem[];
}

function searchParamsOf(url: string | URL): URLSearchParams {
  try {
    return (typeof url === 'string' ? new URL(url) : url).searchParams;
  } catch {
    throw badRequest('Invalid query parameters');
  }
}

function queryParam(params: URLSearchParams, names: readonly string[]): string | null {
  for (const name of names) {
    const value = params.get(name);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

export async function getDashboardOverviewRoute(
  request: Request,
  url: string,
): Promise<DashboardOverviewResponse> {
  await requireAdmin(request);
  const params = searchParamsOf(url);
  const from = queryParam(params, ['from']);
  const to = queryParam(params, ['to']);
  const range = jakartaDayRange({ from, to });
  const conn = getDb();
  try {
    const [
      cards,
      byStatus,
      byCategory,
      byLocation,
      resolutionTime,
      technicianWorkload,
      priorityQueue,
    ] = await Promise.all([
      getOverviewCards(conn.db, range),
      getReportsByStatus(conn.db, range),
      getReportsByCategory(conn.db, range),
      getReportsByLocation(conn.db, range),
      getResolutionTimeMetrics(conn.db, range),
      getTechnicianWorkload(conn.db),
      getPriorityQueue(conn.db),
    ]);
    return {
      range: { from, to },
      cards,
      byStatus,
      byCategory,
      byLocation,
      resolutionTime,
      technicianWorkload,
      priorityQueue,
    };
  } finally {
    await conn.close().catch(() => undefined);
  }
}
