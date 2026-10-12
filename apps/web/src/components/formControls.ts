// Shared form-control classes (Task D-1). Consumed by Input, Textarea and
// Select so the three controls share one border/error contract.

/**
 * Full class string for a native form control.
 * @param invalid true swaps the border token to danger. Callers MUST also
 * pass `aria-describedby={fieldErrorId}` and render
 * `<FieldError id={fieldErrorId} message={error} />` (see FieldError).
 */
export function formControlClasses(invalid: boolean): string {
  const border = invalid ? 'border-danger' : 'border-border';
  return `min-h-[44px] w-full rounded-md border ${border} bg-elevated px-3 py-2 text-sm text-text placeholder:text-subtle`;
}
