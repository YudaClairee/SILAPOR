// Shared hover tooltip for the dashboard charts. The charts' SVG/bars stay
// decorative (aria-hidden) with a text/table equivalent, so this is a pointer
// affordance only: it follows the cursor inside a `relative` wrapper and never
// takes focus or pointer events.
import { useCallback, useRef, useState, type PointerEvent, type ReactNode } from 'react';

export interface ChartTooltipState {
  readonly x: number;
  readonly y: number;
  readonly content: ReactNode;
}

export interface ChartTooltipBinding {
  readonly onPointerEnter: (event: PointerEvent<Element>) => void;
  readonly onPointerMove: (event: PointerEvent<Element>) => void;
  readonly onPointerLeave: () => void;
}

export function useChartTooltip() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<ChartTooltipState | null>(null);

  const bind = useCallback((content: ReactNode): ChartTooltipBinding => {
    const update = (event: PointerEvent<Element>): void => {
      const box = containerRef.current?.getBoundingClientRect();
      if (box === undefined) {
        return;
      }
      // Keep the tooltip inside the container horizontally.
      const x = Math.min(Math.max(event.clientX - box.left, 70), Math.max(70, box.width - 70));
      setState({ x, y: event.clientY - box.top, content });
    };
    return {
      onPointerEnter: update,
      onPointerMove: update,
      onPointerLeave: () => setState(null),
    };
  }, []);

  return { containerRef, state, bind };
}

export interface ChartTooltipProps {
  readonly state: ChartTooltipState | null;
}

export function ChartTooltip({ state }: ChartTooltipProps) {
  if (state === null) {
    return null;
  }
  return (
    <div
      role="presentation"
      data-testid="chart-tooltip"
      className="pointer-events-none absolute z-20 w-max max-w-[220px] -translate-x-1/2 -translate-y-full rounded-lg bg-[#202a33] px-3 py-2 text-xs leading-snug text-white shadow-lg"
      style={{ left: state.x, top: state.y - 12 }}
    >
      {state.content}
    </div>
  );
}

/** Title line + detail lines, the common tooltip body. */
export function TooltipBody({
  title,
  lines,
}: {
  readonly title: string;
  readonly lines: readonly string[];
}) {
  return (
    <>
      <p className="font-semibold">{title}</p>
      {lines.map((line) => (
        <p key={line} className="text-white/80">
          {line}
        </p>
      ))}
    </>
  );
}
