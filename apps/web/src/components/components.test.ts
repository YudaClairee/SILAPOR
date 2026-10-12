// Design foundation variant-map tests (Task D-1, RED-first).
//
// Covers every Button variant, the shared form-control classes (valid +
// invalid), and the StatusBadge tone maps (9 statuses + 3 priorities +
// null/undefined/blank). Pure class-string assertions only — no DOM, so the
// existing node vitest runner is sufficient.
import { describe, expect, it } from 'vitest';
import { buttonBaseClasses, buttonVariantClasses } from './Button';
import { formControlClasses } from './formControls';
import { priorityBadgeClassesFor, statusBadgeClassesFor } from './StatusBadge';

describe('buttonVariantClasses', () => {
  it('exposes exactly the four documented variants', () => {
    expect(Object.keys(buttonVariantClasses).sort()).toEqual([
      'destructive',
      'ghost',
      'primary',
      'secondary',
    ]);
  });

  it('primary uses accent with dark contrast text (never accent body text)', () => {
    expect(buttonVariantClasses.primary).toBe(
      'bg-accent text-accent-contrast hover:brightness-95',
    );
  });

  it('secondary uses surface + border tokens', () => {
    expect(buttonVariantClasses.secondary).toBe(
      'border border-border bg-surface text-text hover:bg-background',
    );
  });

  it('ghost is transparent with text token', () => {
    expect(buttonVariantClasses.ghost).toBe('text-text hover:bg-background');
  });

  it('destructive uses danger with white text', () => {
    expect(buttonVariantClasses.destructive).toBe(
      'bg-danger text-white hover:brightness-95',
    );
  });

  it('base enforces the 44px touch target and disabled state', () => {
    expect(buttonBaseClasses).toContain('min-h-[44px]');
    expect(buttonBaseClasses).toContain('disabled:opacity-50');
    expect(buttonBaseClasses).toContain('rounded-md');
  });
});

describe('formControlClasses', () => {
  it('valid control uses the border token on elevated surface', () => {
    expect(formControlClasses(false)).toBe(
      'min-h-[44px] w-full rounded-md border border-border bg-elevated px-3 py-2 text-sm text-text placeholder:text-subtle',
    );
  });

  it('invalid control swaps to the danger border', () => {
    expect(formControlClasses(true)).toBe(
      'min-h-[44px] w-full rounded-md border border-danger bg-elevated px-3 py-2 text-sm text-text placeholder:text-subtle',
    );
  });
});

describe('statusBadgeClassesFor', () => {
  it('maps open-work statuses to the info tone', () => {
    for (const status of ['REPORTED', 'VERIFIED', 'ASSIGNED', 'INSPECTION', 'IN_REPAIR']) {
      expect(statusBadgeClassesFor(status)).toBe(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-tint-info text-badge-info',
      );
    }
  });

  it('maps resolved/closed to the success tone', () => {
    for (const status of ['RESOLVED', 'CLOSED']) {
      expect(statusBadgeClassesFor(status)).toBe(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-tint-success text-badge-success',
      );
    }
  });

  it('maps rejected to danger and duplicate to muted', () => {
    expect(statusBadgeClassesFor('REJECTED')).toBe(
      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-tint-danger text-badge-danger',
    );
    expect(statusBadgeClassesFor('DUPLICATE')).toBe(
      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-tint-muted text-badge-muted',
    );
  });

  it('falls back to muted for unknown statuses', () => {
    expect(statusBadgeClassesFor('BOGUS')).toBe(
      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-tint-muted text-badge-muted',
    );
  });
});

describe('priorityBadgeClassesFor', () => {
  it('maps HIGH/MEDIUM/LOW to danger/warning/info tones', () => {
    expect(priorityBadgeClassesFor('HIGH')).toBe(
      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-tint-danger text-badge-danger',
    );
    expect(priorityBadgeClassesFor('MEDIUM')).toBe(
      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-tint-warning text-badge-warning',
    );
    expect(priorityBadgeClassesFor('LOW')).toBe(
      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-tint-info text-badge-info',
    );
  });

  it('maps null/undefined/blank to muted (never blank)', () => {
    const expected =
      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-tint-muted text-badge-muted';
    expect(priorityBadgeClassesFor(null)).toBe(expected);
    expect(priorityBadgeClassesFor(undefined)).toBe(expected);
    expect(priorityBadgeClassesFor('')).toBe(expected);
  });
});
