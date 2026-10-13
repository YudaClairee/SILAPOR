// Component barrel (Task D-1). BINDING API for D-2/D-3: consume these
// exports verbatim; prop contracts are documented on each interface.
//
// Not built in Phase 3 (per brief — do NOT import; they do not exist yet):
// LocationCascade, FacilityPicker, IssueTypePicker, KpiStrip,
// VisibilityNote, AttachmentDropzone, ConfirmationDialog, DataTable, Toast,
// Combobox.

export { AppShell, navItemsForRole } from './AppShell';
export type { AppShellNavItem, AppShellProps, AppShellRole, AppShellUser } from './AppShell';

export { Button, buttonBaseClasses, buttonVariantClasses } from './Button';
export type { ButtonProps, ButtonVariant } from './Button';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { ErrorPanel } from './ErrorPanel';
export type { ErrorPanelProps } from './ErrorPanel';

export { FieldError } from './FieldError';
export type { FieldErrorProps } from './FieldError';

export { formControlClasses } from './formControls';

export { Input } from './Input';
export type { InputProps } from './Input';

export { LoadingState } from './LoadingState';
export type { LoadingStateProps } from './LoadingState';

export { Select } from './Select';
export type { SelectProps } from './Select';

export { StatusBadge, priorityBadgeClassesFor, statusBadgeClassesFor } from './StatusBadge';
export type { StatusBadgeProps } from './StatusBadge';

export { Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';

export { TicketMono } from './TicketMono';
export type { TicketMonoProps } from './TicketMono';

export { Timeline } from './Timeline';
export type { TimelineItem, TimelineProps } from './Timeline';
