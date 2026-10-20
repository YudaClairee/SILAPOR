// StatusStepper (Reporter Detail V2). Seven-step rail for the reporter-facing
// normal path: completed steps are teal with a check, the current step is
// amber with a wrench and an "Aktif Sekarang" pill, upcoming steps are an
// empty outlined dot with the step number. State is never colour-alone: every
// dot carries an icon/number and the label + timestamp are always text.
//
// Off-path statuses (REJECTED/DUPLICATE) render the rail neutral plus an
// explanatory line — a rejected ticket must not look "in progress".
import { CheckIcon, WrenchIcon } from './Icon';
import {
  FLOW_PHASE_LABELS,
  flowIndexOf,
  formatJakartaShort,
  isFlowStatus,
  STATUS_FLOW,
} from '../lib/ticket-detail';
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

      <div className="overflow-x-auto pb-1">
        <ol
          aria-label="Alur status penanganan"
          className="grid min-w-[720px] grid-cols-7 gap-0"
        >
          {STATUS_FLOW.map((step, index) => {
            const state: StepState =
              currentIndex < 0 || index > currentIndex
                ? 'upcoming'
                : index === currentIndex
                  ? 'current'
                  : 'done';
            const reachedAt = timestamps[step];
            const isCurrent = state === 'current';
            return (
              <li
                key={step}
                aria-current={isCurrent ? 'step' : undefined}
                className="relative flex flex-col items-center px-1 text-center"
              >
                {index === 0 ? null : (
                  <span
                    aria-hidden="true"
                    className={`absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2 ${
                      index <= currentIndex ? 'bg-accent-secondary' : 'bg-border'
                    }`}
                  />
                )}
                <span
                  aria-hidden="true"
                  className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold ${stepClasses(
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
                <span className="mt-2 block font-mono text-[11px] font-semibold uppercase tracking-wide text-text">
                  {step}
                </span>
                <span className="mt-0.5 block font-mono text-[11px] text-muted">
                  {reachedAt === null ? 'Menunggu' : formatJakartaShort(reachedAt)}
                </span>
                {isCurrent ? (
                  <span className="mt-1.5 inline-flex rounded-full bg-tint-warning px-2 py-0.5 text-[10px] font-semibold text-badge-warning">
                    Aktif Sekarang
                  </span>
                ) : null}
                <span className="sr-only">{FLOW_PHASE_LABELS[step]}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
