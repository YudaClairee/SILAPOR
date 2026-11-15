import type { DashboardOverviewResponse } from '../server/analytics';

export interface ManagerialDashboardViewModel {
  readonly cards: DashboardOverviewResponse['cards'];
  readonly byLocation: DashboardOverviewResponse['byLocation'];
  readonly byBuilding: DashboardOverviewResponse['byBuilding'];
  readonly topAssets: ReadonlyArray<
    DashboardOverviewResponse['topAssets'][number] & { readonly locationLabel: string }
  >;
  readonly priorityQueue: DashboardOverviewResponse['priorityQueue'];
  readonly trend: DashboardOverviewResponse['trend'];
  readonly categoryLabels: readonly string[];
  readonly resolutionTime: {
    readonly sampleSize: number;
    readonly average: string;
    readonly median: string;
  };
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '\u2014';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days} hari ${hours} jam`;
  if (hours > 0) return `${hours} jam`;
  return `${Math.round(seconds / 60)} menit`;
}

export function buildManagerialDashboardViewModel(
  data: DashboardOverviewResponse,
): ManagerialDashboardViewModel {
  return {
    cards: data.cards,
    byLocation: data.byLocation,
    byBuilding: data.byBuilding,
    topAssets: data.topAssets.map((asset) => ({
      ...asset,
      locationLabel:
        asset.buildingName === null && asset.roomName === null
          ? 'Lokasi belum tercatat'
          : [asset.buildingName, asset.roomName].filter((part): part is string => part !== null).join(' \u00b7 '),
    })),
    priorityQueue: data.priorityQueue,
    trend: data.trend,
    categoryLabels: data.byCategory.map((category) => category.categoryName ?? 'Belum terklasifikasi'),
    resolutionTime: {
      sampleSize: data.resolutionTime.sampleSize,
      average: formatDuration(data.resolutionTime.averageSeconds),
      median: formatDuration(data.resolutionTime.medianSeconds),
    },
  };
}
