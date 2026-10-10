---
project: Smart Campus Maintenance System UPI Kampus Tasikmalaya
register: product
aesthetic_direction: Swiss / grid
color_strategy: restrained
design_system: Radix primitives + shadcn/ui
design_variance: 5
motion_intensity: 2
visual_density: 6
---

# Locked Design Language

## Design Read

Formal, calm, and operational. The interface should make reporting a campus
problem feel as clear as filing a well-routed service ticket, not as navigating
an abstract dashboard.

## Aesthetic Direction

**Swiss / grid**, adapted for an institutional maintenance workflow.

The Figma reference uses a disciplined institutional shell, strong alignment,
clear card boundaries, restrained icons, and a direct action hierarchy. The
product needs trust, scanability, and traceability more than visual spectacle.
The distinctive bet is a visible maintenance rail: every report surface uses
the same left alignment, status language, and location-to-facility hierarchy.

Counterfactual test: this is not a generic blue SaaS dashboard. The identity is
anchored by a campus service rail, a single signal-orange action accent, and
document-like ruled sections used for status and evidence.

## Signature

**The Maintenance Rail:** a thin, persistent vertical rule with a short signal
segment that appears beside report status, timeline milestones, and the active
navigation item. It visually connects a report from location to resolution.

Use it sparingly. Do not add decorative rails to unrelated content.

## Inspiration

### Figma reference: SCMS UPI Tasikmalaya

- took: institutional header, UPI identity, SSO-first login, centered
  authentication card, report dashboard, KPI strip, quick action banner,
  status filters, two-column content, and clear reporter/admin separation;
- rejected: generic dashboard decoration, unnecessary gradients, decorative
  glass effects, and any component that does not improve reporting or
  traceability;
- synthesis: preserve the reference's calm institutional structure while
  making the maintenance rail and location hierarchy the product signature.

## Color (locked)

Color values are normative. Do not introduce a second brand accent.

| role | OKLCH | hex | use |
|------|-------|-----|-----|
| background | `oklch(0.975 0.012 245)` | `#F3F6F8` | application canvas |
| surface | `oklch(0.995 0.006 245)` | `#FBFCFD` | cards and forms |
| elevated | `oklch(1 0 0)` | `#FFFFFF` | modal, popover, focused surface |
| text | `oklch(0.245 0.035 245)` | `#27323D` | primary text |
| muted | `oklch(0.48 0.025 245)` | `#687580` | supporting text |
| subtle | `oklch(0.62 0.018 245)` | `#919DA6` | placeholders and metadata |
| border | `oklch(0.88 0.018 245)` | `#D7DEE3` | dividers and input borders |
| accent | `oklch(0.68 0.15 55)` | `#D9772A` | primary action, active rail, links |
| success | `oklch(0.62 0.13 150)` | `#258A5B` | resolved and closed |
| warning | `oklch(0.72 0.14 82)` | `#B87512` | inspection, pending review |
| danger | `oklch(0.58 0.16 25)` | `#B8453D` | rejected, destructive action |
| info | `oklch(0.56 0.11 245)` | `#426E9B` | verified and informational |

Contrast requirements:

- text `#27323D` on background `#F3F6F8`: target at least 10:1;
- muted `#687580` on surface `#FBFCFD`: target at least 4.5:1;
- accent `#D9772A` is not used as body text on white; use dark text on accent
  buttons where required and verify at least 4.5:1;
- semantic colors never communicate state alone. Pair with label and icon.

Dark mode is out of MVP scope. If introduced later, derive a separate ramp and
re-run contrast checks. Do not invert tokens mechanically.

## Type (locked)

Use **IBM Plex Sans** for display and body, with **IBM Plex Mono** for ticket
numbers, room codes, timestamps, and audit metadata. This pairing fits a
technical institutional service while remaining readable. It avoids the
generic system-font dashboard appearance.

| role | family | weight | use |
|------|--------|--------|-----|
| display | IBM Plex Sans | 600 | page titles and major actions |
| heading | IBM Plex Sans | 600 | section headings and card titles |
| body | IBM Plex Sans | 400 | descriptions and guidance |
| label | IBM Plex Sans | 500 | form labels and navigation |
| utility | IBM Plex Mono | 400/500 | ticket, room code, date, audit data |

Type scale:

`12, 14, 16, 18, 20, 24, 30, 36` px.

Body measure is 65 to 75 characters where paragraphs are long. Use
`text-wrap: balance` for headings and `text-wrap: pretty` for descriptions.

## Scales (locked)

Spacing uses a 4px base rhythm:

`0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96`.

Radius scale:

`sm: 4px, md: 8px, lg: 12px, full: 9999px`.

Use `md` for inputs, buttons, and ordinary cards. Use `lg` only for primary
authentication and hero action surfaces. Do not nest cards.

Elevation:

- `none`: ordinary content;
- `sm`: card and dropdown;
- `md`: popover and sticky action bar;
- `lg`: modal only.

Breakpoints:

- `sm`: 640px;
- `md`: 768px;
- `lg`: 1024px;
- `xl`: 1280px.

Motion:

- `fast`: 120ms;
- `base`: 300ms;
- `emphasis`: 500ms;
- easing: `cubic-bezier(0.16, 1, 0.3, 1)`;
- no bounce or elastic easing;
- honor `prefers-reduced-motion`.

Only use motion for page-load hierarchy, dropdown/open transitions, status
feedback, and upload progress. If the reason cannot be stated in one sentence,
remove the animation.

## Layout Rules

### Application shell

- desktop: persistent 240px navigation rail and a 996px content region where
  practical, matching the Figma dashboard proportions;
- mobile: navigation becomes a top bar with a menu trigger;
- content padding: 24px desktop, 16px mobile;
- maximum readable content width: 1200px;
- one primary action per view;
- navigation has no more than five top-level items.

### Data presentation

- use ruled lists or tables for reports and audit histories;
- use cards only for true hierarchy such as KPI or an urgent action;
- do not use three identical feature cards as a generic section;
- status badges always include text;
- ticket numbers and room codes use IBM Plex Mono;
- empty states explain the next action.

### Copy voice

Plain, confident, and operational. Use Indonesian for user-facing UI.

Preferred action vocabulary:

`Laporkan` -> `Tinjau` -> `Verifikasi` -> `Tugaskan` -> `Perbarui` ->
`Selesaikan` -> `Tutup`.

Avoid buzzwords, fake names, vague success claims, and decorative copy.

## Component Vocabulary

- `Button`: primary, secondary, ghost, destructive;
- `Input`, `Textarea`, `Select`, `Combobox`;
- `LocationCascade`: building -> floor -> room;
- `FacilityPicker`: available facilities for selected room;
- `IssueTypePicker`: issue types filtered by facility;
- `StatusBadge`: semantic color plus text;
- `TicketRow`: ruled report list item;
- `KpiStrip`: compact summary metrics;
- `Timeline`: status and progress history using the maintenance rail;
- `VisibilityNote`: public or internal note indicator;
- `AttachmentDropzone`: image-only upload;
- `ConfirmationDialog`: irreversible admin action;
- `Toast` and inline validation;
- `DataTable`: admin report and master data views.

## Accessibility Baseline

- visible focus ring uses a 2px accent outline with 2px offset;
- all icon-only buttons require an accessible name;
- touch targets are at least 44px;
- form errors are connected with `aria-describedby`;
- async updates use an appropriate `aria-live` region;
- comboboxes support arrow navigation, Enter, Escape, and typed search;
- status color is always paired with text;
- keyboard order follows visual order;
- modal focus is trapped and restored;
- reduced-motion users receive instant state changes.

## Identity Lock

Every screen must read as the same product if placed side by side.
