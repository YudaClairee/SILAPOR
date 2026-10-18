export interface BarChartDatum {
  readonly label: string;
  readonly value: number;
  readonly description?: string;
}

export interface BarChartProps {
  readonly title: string;
  readonly data: readonly BarChartDatum[];
  readonly emptyMessage?: string;
}

export function BarChart({ title, data, emptyMessage = 'Tidak ada data' }: BarChartProps) {
  const max = data.reduce((peak, datum) => Math.max(peak, datum.value), 0);

  return (
    <figure aria-label={title} className="rounded-md border border-border bg-surface p-4">
      <figcaption className="text-sm font-semibold text-text">{title}</figcaption>
      {data.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{emptyMessage}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.map((datum, index) => (
            <li key={`${datum.label}-${index}`} className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-words text-text">{datum.label}</span>
                <span className="shrink-0 font-mono text-text">{datum.value}</span>
              </div>
              <div aria-hidden="true" className="mt-1 h-2 rounded bg-border/40">
                <div
                  className="h-2 rounded bg-accent"
                  style={{ width: `${max === 0 ? 0 : (datum.value / max) * 100}%` }}
                />
              </div>
              {datum.description === undefined ? null : (
                <p className="mt-0.5 text-xs text-muted">{datum.description}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
