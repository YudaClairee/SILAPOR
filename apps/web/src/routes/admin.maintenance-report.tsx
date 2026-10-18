// Laporan Maintenance (Phase 7 T8, UI No. 11): endpoint menyusul, so the
// charts and per-period table render static mock data held in this module.
import { createFileRoute } from '@tanstack/react-router';
import { BarChart, Button } from '../components/index.js';

export const Route = createFileRoute('/admin/maintenance-report')({
  component: AdminMaintenanceReportPage,
});

interface PeriodRow {
  readonly period: string;
  readonly reported: number;
  readonly resolved: number;
  readonly averageDuration: string;
}

const PERIOD_ROWS: readonly PeriodRow[] = [
  { period: '14–20 Sep', reported: 12, resolved: 10, averageDuration: '1 hari 6 jam' },
  { period: '21–27 Sep', reported: 15, resolved: 12, averageDuration: '2 hari 4 jam' },
  { period: '28 Sep–4 Okt', reported: 9, resolved: 8, averageDuration: '1 hari 18 jam' },
  { period: '5–11 Okt', reported: 18, resolved: 15, averageDuration: '2 hari 10 jam' },
  { period: '12–18 Okt', reported: 14, resolved: 11, averageDuration: '1 hari 12 jam' },
];

const TECHNICIAN_WORKLOAD: ReadonlyArray<{
  readonly name: string;
  readonly activeCount: number;
}> = [
  { name: 'Andi Pratama', activeCount: 4 },
  { name: 'Siti Rahayu', activeCount: 3 },
  { name: 'Budi Santoso', activeCount: 2 },
];

const CATEGORY_BUILDING_ROWS: ReadonlyArray<{
  readonly category: string;
  readonly building: string;
  readonly count: number;
}> = [
  { category: 'Listrik dan lampu', building: 'Gedung A', count: 7 },
  { category: 'AC dan pendingin', building: 'Gedung B', count: 5 },
  { category: 'Toilet dan sanitasi', building: 'Gedung C', count: 3 },
  { category: 'Elektronik komputer dan jaringan', building: 'Gedung A', count: 2 },
];

const SECTION_TITLE_CLASSES = 'text-lg font-semibold text-text';
const TABLE_HEAD_CLASSES = 'px-3 py-2 text-xs font-medium text-muted';

function AdminMaintenanceReportPage() {
  return (
    <section aria-labelledby="admin-maintenance-report-title" className="w-full">
      <h1 id="admin-maintenance-report-title" className="text-2xl font-semibold text-text">
        Laporan Maintenance
      </h1>
      <p className="mt-1 text-xs text-muted">
        Data contoh — bukan data live. Endpoint laporan menyusul.
      </p>

      <div className="mt-4">
        <BarChart
          title="Tren laporan"
          data={PERIOD_ROWS.map((row) => ({
            label: row.period,
            value: row.reported,
            description: `Rata-rata durasi: ${row.averageDuration}`,
          }))}
          emptyMessage="Tidak ada laporan pada rentang ini."
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <BarChart
          title="Beban tugas per teknisi"
          data={TECHNICIAN_WORKLOAD.map((technician) => ({
            label: technician.name,
            value: technician.activeCount,
            description: `${technician.activeCount} tiket aktif`,
          }))}
          emptyMessage="Belum ada data teknisi."
        />
        <BarChart
          title="Tiket per kategori & gedung"
          data={CATEGORY_BUILDING_ROWS.map((row) => ({
            label: `${row.category} — ${row.building}`,
            value: row.count,
          }))}
          emptyMessage="Tidak ada tiket pada rentang ini."
        />
      </div>

      <section aria-labelledby="admin-maintenance-report-period-title" className="mt-4">
        <h2 id="admin-maintenance-report-period-title" className={SECTION_TITLE_CLASSES}>
          Tiket per periode
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table
            aria-label="Tiket per periode"
            className="w-full min-w-100 border-collapse text-left text-sm"
          >
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={TABLE_HEAD_CLASSES}>
                  Periode
                </th>
                <th scope="col" className={TABLE_HEAD_CLASSES}>
                  Jumlah
                </th>
                <th scope="col" className={TABLE_HEAD_CLASSES}>
                  Selesai
                </th>
                <th scope="col" className={TABLE_HEAD_CLASSES}>
                  Rata-rata durasi
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {PERIOD_ROWS.map((row) => (
                <tr key={row.period}>
                  <td className="px-3 py-2 text-text">{row.period}</td>
                  <td className="px-3 py-2 text-text">{row.reported}</td>
                  <td className="px-3 py-2 text-text">{row.resolved}</td>
                  <td className="px-3 py-2 text-text">{row.averageDuration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled>Ekspor PDF</Button>
        <p className="text-sm text-muted">Endpoint menyusul — ekspor PDF belum tersedia.</p>
      </div>
    </section>
  );
}
