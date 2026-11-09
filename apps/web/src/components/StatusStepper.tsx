// StatusStepper (Reporter Detail V2). Seven-step rail matching the admin/domain
// flow, including admin/UMPER's English status names (REPORTED, VERIFIED, …):
// horizontal on desktop, a vertical rail on mobile so labels never crowd.
//
// State is never colour-alone: every dot carries an icon/number, the current
// step exposes aria-current="step", and every step has a text label and date.
// Off-path statuses (REJECTED/DUPLICATE) render the rail neutral plus an
// explanatory line — a rejected ticket must not look "in progress".
import { CheckIcon, WrenchIcon } from './Icon';
import { formatJakartaShort, flowIndexOf, isFlowStatus, STATUS_FLOW } from '../lib/ticket-detail';
import type { FlowTimestamps } from '../lib/ticket-detail';
import { statusLabel } from '../lib/admin-reports';

export interface StatusStepperProps {
  readonly status: string;
  /** Milestones from `deriveStatusTimestamps`; null = not reached yet. */
  readonly timestamps: FlowTimestamps;
  readonly className?: string;
}

type StepState = 'done' | 'current' | 'upcoming';

function stepClasses(state: StepState): string {
  if (state === 'done') return 'border-accent-secondary bg-accent-secondary text-white';
  if (state === 'current') return 'border-warning bg-warning text-white ring-4 ring-tint-warning';
  return 'border-border bg-surface text-muted';
}

export function StatusStepper({ status, timestamps, className }: StatusStepperProps) {
  const currentIndex = flowIndexOf(status);
  const offPath = !isFlowStatus(status);

  return (
    <div className={className}>
      {offPath ? (
        <p className="mb-4 rounded-md bg-tint-muted px-3 py-2 text-sm text-badge-muted">
          Tiket berada di luar alur perbaikan normal (status: {statusLabel(status)}).
        </p>
      ) : null}

      <ol aria-label="Alur status penanganan" className="grid gap-0 lg:grid-cols-7">
        {STATUS_FLOW.map((step, index) => {
          const state: StepState =
            offPath || index > currentIndex
              ? 'upcoming'
              : index === currentIndex
                ? 'current'
                : 'done';
          const reachedAt = offPath || index > currentIndex ? null : timestamps[step];
          const isCurrent = state === 'current';
          return (
            <li
              key={step}
              aria-current={isCurrent ? 'step' : undefined}
              className="relative flex gap-3 pb-6 last:pb-0 lg:flex-col lg:items-center lg:gap-0 lg:px-1 lg:pb-0 lg:text-center"
            >
              {index < STATUS_FLOW.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={`absolute top-8 left-4 h-[calc(100%-2rem)] w-0.5 -translate-x-1/2 lg:hidden ${
                    index < currentIndex ? 'bg-accent-secondary' : 'bg-border'
                  }`}
                />
              ) : null}
              {index === 0 ? null : (
                <span
                  aria-hidden="true"
                  className={`absolute top-4 right-1/2 hidden h-0.5 w-full -translate-y-1/2 lg:block ${
                    index <= currentIndex ? 'bg-accent-secondary' : 'bg-border'
                  }`}
                />
              )}
              <span
                aria-hidden="true"
                className={`relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold lg:mt-0 ${stepClasses(
                  state,
                )}`}
              >
                {state === 'done' ? (
                  <CheckIcon className="h-3.5 w-3.5" />
                ) : isCurrent ? (
                  <WrenchIcon className="h-3.5 w-3.5" />
                ) : (
                  <span>{index + 1}</span>
                )}
              </span>
              <div className="min-w-0 pt-0.5 lg:pt-0">
                <span className="block font-mono text-[11px] font-semibold tracking-wide text-text uppercase">
                  {step}
                </span>
                <span className="mt-0.5 block font-mono text-[11px] text-muted">
                  {reachedAt === null ? 'Menunggu' : formatJakartaShort(reachedAt)}
                </span>
                {isCurrent ? (
                  <span className="mt-1 inline-block text-[10px] font-semibold text-badge-warning">
                    Tahap saat ini
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
