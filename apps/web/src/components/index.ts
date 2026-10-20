// Component barrel (Task D-1). BINDING API for D-2/D-3: consume these
// exports verbatim; prop contracts are documented on each interface.
//
// Not built in Phase 3 (per brief — do NOT import; they do not exist yet):
// LocationCascade, FacilityPicker, IssueTypePicker, KpiStrip,
// VisibilityNote, AttachmentDropzone, ConfirmationDialog, DataTable, Toast,
// Combobox.

export { AppShell, navItemsForRole } from './AppShell';
export type { AppShellNavItem, AppShellProps, AppShellRole, AppShellUser } from './AppShell';

export { AdminShell } from './AdminShell';
export type { AdminShellProps, AdminShellUser } from './AdminShell';

export { ReporterShell } from './ReporterShell';
export type { ReporterShellProps, ReporterShellUser } from './ReporterShell';

export {
  ActivityIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BellIcon,
  BriefcaseIcon,
  BuildingIcon,
  CalendarIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardIcon,
  ClockIcon,
  CloseIcon,
  DoubleCheckIcon,
  DownloadIcon,
  FileTextIcon,
  FilterIcon,
  FlagIcon,
  GridIcon,
  HistoryIcon,
  ImageIcon,
  InfoIcon,
  LockIcon,
  LogoMark,
  MapPinIcon,
  MenuIcon,
  MergeIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparkleIcon,
  UserIcon,
  UsersIcon,
  WrenchIcon,
} from './Icon';

export { CategoryDonut } from './CategoryDonut';
export type { CategoryDonutDatum, CategoryDonutProps } from './CategoryDonut';

export { RankedBarList } from './RankedBarList';
export type { RankedBarItem, RankedBarListProps } from './RankedBarList';

export { TrendChart } from './TrendChart';
export type { TrendChartDatum, TrendChartProps } from './TrendChart';

export { AttachmentGallery } from './AttachmentGallery';
export type { AttachmentGalleryProps, GalleryAttachment } from './AttachmentGallery';

export { BarChart } from './BarChart';
export type { BarChartDatum, BarChartProps } from './BarChart';

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

export { PhotoEvidence } from './PhotoEvidence';
export type { PhotoEvidenceAttachment, PhotoEvidenceProps } from './PhotoEvidence';

export { AdminTicketHeader, AdminTicketStepper } from './AdminTicketHeader';
export type { AdminTicketHeaderProps, AdminTicketStepReport } from './AdminTicketHeader';

export { AdminTicketTabs } from './AdminTicketTabs';

export { AdminAssetAssignmentCard } from './AdminAssetAssignmentCard';

export { AdminAiScoreCard } from './AdminAiScoreCard';

export { AdminReporterQuotesCard } from './AdminReporterQuotesCard';

export { AdminPhotoPagerCard } from './AdminPhotoPagerCard';

export { AdminTicketAssignmentTab } from './AdminTicketAssignmentTab';

export { AdminTicketHistoryTab } from './AdminTicketHistoryTab';

export { AdminTicketV2Content, useAdminTicketV2Tab } from './AdminTicketV2Content';

export { AdminAiPanel } from './LegacyAdminAiPanel';
export type { LegacyAdminAiAnalysis, LegacyAdminAiReport } from './LegacyAdminAiPanel';

export { SectionCard } from './SectionCard';
export type { SectionCardProps } from './SectionCard';

export { StatusStepper } from './StatusStepper';
export type { StatusStepperProps } from './StatusStepper';

export { Timeline } from './Timeline';
export type { TimelineItem, TimelineProps } from './Timeline';
