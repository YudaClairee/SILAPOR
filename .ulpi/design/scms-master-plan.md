# SCMS UPI Kampus Tasikmalaya: Master Plan

**Status:** Working baseline  
**Version:** 0.1  
**Updated:** 2026-10-10  
**Owner:** Project team  
**Product approver:** UMPER/admin, pending formal approval  
**Related design language:** [DESIGN.md](./DESIGN.md)  
**Product requirements:** [Tugas-Tugas Semester 7.md](../../Tugas-Tugas%20Semester%207.md)  
**Product decisions:** [PHASE-0-PRODUCT-DECISIONS.md](../../docs/decisions/PHASE-0-PRODUCT-DECISIONS.md)  
**Technical execution:** [EXECUTION-PLAN.md](../../EXECUTION-PLAN.md)

> This document is an implementation-ready master plan, not a replacement for
> the PRD or Phase 0 decisions. Final product decisions in Phase 0 override
> provisional recommendations here.

## 1. Executive Summary

Smart Campus Maintenance System (SCMS) is a web application for UPI Kampus
Tasikmalaya. It centralizes campus facility reports, gives reporters clear
progress visibility, and gives UMPER/admin a controlled workflow from
verification through resolution.

The MVP has two roles:

- `REPORTER`: mahasiswa and other civitas akademika who submit and monitor
  reports;
- `ADMIN`: UMPER/admin who verifies reports, classifies them, sets priority,
  assigns technicians, publishes progress, and manages master data.

The system is intentionally not a free-text complaint box. It uses verified
location data, structured facility selection, issue types, attachments, a
controlled lifecycle, an append-only timeline, and server-side authorization.

AI is a decision-support layer. It may recommend validity, duplicate signals,
priority, and risk factors. It may not make the final decision or mutate the
workflow.

## 2. Product Goals

### Primary goals

1. Let a reporter submit a useful facility report in a few clear steps.
2. Give every report a stable ticket number and visible history.
3. Let admin process reports consistently using structured master data.
4. Prevent invalid status transitions and preserve audit history.
5. Publish safe, sanitized progress to reporters and the public ongoing view.
6. Produce reliable maintenance analytics from workflow events.

### Non-goals for MVP

- technician login or technician self-service;
- automatic maintenance scheduling;
- IoT sensor ingestion;
- autonomous AI decisions;
- real-time chat;
- WhatsApp or email notification integration;
- full individual asset inventory where every chair, lamp, or classroom device
  has its own code; MVP uses aggregate facility records per room;
- offline-first submission;
- multi-campus tenancy.

## 3. Users and Permissions

### Reporter

Can:

- authenticate through the SSO abstraction;
- create a report;
- select verified location, facility, and issue type;
- add a description, optional event time, and optional images;
- see their own reports and details;
- see public progress updates for their reports;
- see sanitized ongoing facility issues;
- receive in-app notifications.

Cannot:

- change status;
- set final category or priority;
- see another reporter's identity or private attachments;
- see internal notes;
- assign a technician;
- edit closed, rejected, or duplicate reports.

### Admin

Can:

- see all reports;
- verify, reject, or mark duplicate;
- correct final category and issue type;
- set final priority;
- transition report status according to the state machine;
- assign and reassign an active technician;
- write public updates and internal notes;
- manage buildings, floors, rooms, facility profiles, issue types, and
  technicians;
- inspect audit history and analytics.

### Technician

Technicians are master data in MVP, not an authenticated role. Admin records
information received from technicians. The audit actor remains the admin who
entered the update.

## 4. Product Information Architecture

### Reporter routes

| Route | Purpose |
|---|---|
| `/login` | SSO entry |
| `/reporter` | dashboard, KPI, quick actions, latest reports |
| `/reporter/reports/new` | create report |
| `/reporter/reports` | reporter report history |
| `/reporter/reports/:ticket` | report detail and public timeline |
| `/facilities/status` | sanitized ongoing facility status |
| `/notifications` | in-app notification list |

### Admin routes

| Route | Purpose |
|---|---|
| `/admin` | operational dashboard |
| `/admin/reports` | searchable report table |
| `/admin/reports/:ticket` | verification, priority, assignment, notes |
| `/admin/locations` | buildings, floors, and rooms |
| `/admin/facilities` | facility profiles and asset aggregates |
| `/admin/categories` | categories and issue types |
| `/admin/technicians` | technician master data |
| `/admin/analytics` | volume, status, priority, and resolution metrics |

## 5. Design Direction and Figma Baseline

The Figma reference at the supplied SCMS file establishes the initial visual
structure:

- institutional top ribbon with UPI identity;
- SSO-first login card;
- reporter dashboard with welcome header;
- quick action banner emphasizing report submission;
- three KPI cards;
- status filter pills;
- two-column report list and supporting summary;
- restrained borders, rounded surfaces, and clear labels.

The implementation must bind to [DESIGN.md](./DESIGN.md). Do not redesign the
visual language per screen.

### Screen composition

#### Login

1. institutional header;
2. centered authentication surface;
3. SCMS identity and concise explanation;
4. audience/scope indicator;
5. single primary SSO button;
6. security/privacy note;
7. technical help link;
8. minimal institutional footer.

#### Reporter dashboard

1. navigation shell;
2. greeting and session indicator;
3. quick action banner with `Laporkan fasilitas`;
4. KPI strip;
5. report list with filters;
6. right-side contextual status or notification area on desktop;
7. responsive stacked layout on mobile.

#### New report

1. progress indicator with no more than four conceptual groups;
2. location cascade;
3. facility and issue type selection;
4. description and optional evidence;
5. review and submit;
6. duplicate warning before final submit when applicable.

## 6. Master Data Plan

### 6.1 Source-of-truth hierarchy

1. approved operational data from UMPER/admin;
2. verified `rooms_lengkap.csv`;
3. draft taxonomy files and profiles;
4. database seed/import;
5. runtime admin edits with audit history.

The database is the runtime source after import. CSV files are versioned import
sources and review artifacts.

### 6.2 Current files

| File | Meaning | Status |
|---|---|---|
| `data/master/buildings.csv` | building baseline A-J | draft import |
| `data/master/rooms_lengkap.csv` | verified rooms | current verified source |
| `data/master/facility-categories.csv` | facility taxonomy | provisional |
| `data/master/issue-types.csv` | issue taxonomy | provisional |
| `data/master/asset-profiles.csv` | reusable room/building facility rules | provisional |
| `data/master/assets.csv` | individual inventory template | empty |
| `data/master/README.md` | import and interpretation rules | maintained |

### 6.3 Location hierarchy

```text
Campus
  -> Building
      -> Floor
          -> Room
              -> Facility profile or aggregate
```

Use `room_code` as the stable external code from the verified room source.
Store `building_code`, floor number, and room code as separate fields. Do not
depend on parsing the code at runtime.

### 6.4 Verified facility rules

#### Rooms classified as classrooms

A room is a classroom when its `room_name` contains `KULIAH` (covers both `R. KULIAH` and `RUANG KULIAH`; 27 rooms: 24 in Building C + 3 in Building I).

Classroom baseline:

| Facility | Quantity model | Status |
|---|---|---|
| TV | one aggregate facility per room | confirmed by project input |
| HDMI | one aggregate facility per room | confirmed by project input |
| whiteboard | one aggregate facility per room | confirmed by project input |
| student chairs | one aggregate facility per room | quantity not individually identified |
| lighting | one aggregate facility per room covering two points | confirmed by project input |
| power outlets | quantity four per room | confirmed by project input |

#### HVAC

- Building C classroom: one central AC facility per room;
- Ballroom `22.4C.05.064`: nine central AC units inside the ballroom;
- Shared area `C-05-CORRIDOR`: two central AC units in the corridor outside
  the ballroom on floor 5 of Building C. This is modeled as a shared area,
  not as part of the ballroom or another numbered room;
- other classroom buildings: one conventional/split AC per room, provisional.

#### Classroom and laboratory additions

- Every classroom also exposes one aggregate lecturer desk facility.
- Facilities remain aggregate records; individual chairs, lamps, outlets, and
  classroom devices do not require separate asset codes for MVP.
- The IoT laboratory exposes an aggregate lab-computer facility. Its quantity
  remains unset until the laboratory inventory is available.

#### Toilets

For each toilet room:

- one sink;
- one standing urinal;
- two toilet bowls.

The rules are aggregate facilities. The application does not need one record
for each chair, lamp, outlet, or toilet bowl for MVP reporting.

### 6.5 What remains to identify

Required before declaring master data final:

1. confirm facility profiles for non-classroom, non-toilet rooms (labs need
   PC counts and one aggregate equipment name each);
2. replace manual location tiers with official schedule slots when available
   (`slots_per_week` in `location-usage.csv`);
3. calibrate provisional v1 weights and thresholds after 1–2 months of
   production data;
4. confirm active/inactive status for buildings and rooms;
5. obtain UMPER/admin sign-off on the 6 categories and 7 generic issue types;
6. ~~decide whether criticality is assigned to room, facility category, or
   both~~ decided: numeric weights on category (0–40) + asset (0–30) +
   location (0–30), no separate criticality enum;
7. replace five dummy technician records with official records before
   production;
8. provide individual asset inventory only if the project requires asset-level
   history or institutional inventory codes.

## 7. Reporter Submission Flow

### Goal

As a reporter, submit a clear facility issue so admin can identify location,
affected facility, issue type, and evidence without follow-up.

### Flow

```text
Login
  -> Laporkan fasilitas
  -> Select building
  -> Select floor
  -> Select room
  -> Select available facility
  -> Select issue type
  -> Write description
  -> Optional event time
  -> Optional image upload
  -> Review
  -> Duplicate warning if candidate exists
  -> Submit
  -> Ticket detail
```

### Required reporter fields

| Field | Required | Source |
|---|---:|---|
| building | yes | location master |
| floor | yes where applicable | location master |
| room | yes | verified room master |
| facility | yes | applicable facility profile |
| issue type | yes | issue taxonomy |
| description | yes | reporter |
| event time | no | reporter |
| image | no | reporter |

Reporter identity, name, NIM, and role come from SSO. Do not request NIM as a
free-text form field.

### Validation

- selected room must belong to selected floor and building;
- selected facility must be available for that room;
- selected issue type must be valid for the selected facility or general;
- description minimum 10 characters and maximum 2,000 characters;
- image-only attachments for MVP;
- reject unsupported file types, excessive size, and empty uploads;
- preserve form data after recoverable server errors where safe.

### Duplicate warning

On submit, find active reports by the same reporter, same location or
aggregate facility, same category, and same issue type. Active statuses:

`REPORTED`, `VERIFIED`, `ASSIGNED`, `INSPECTION`, `IN_REPAIR`.

Show a warning and canonical ticket reference. Do not block the reporter. Admin
decides whether the report becomes `DUPLICATE`.

## 8. Admin Workflow

### Verification

Admin sees:

- ticket number;
- reporter identity;
- structured location;
- selected facility and issue type;
- description;
- attachments;
- duplicate candidates;
- AI suggestions if available;
- audit and timeline.

Admin may correct final category and issue type, set final priority, and choose
the next valid status.

### Assignment

`ASSIGNED` requires an active technician. Reassignment is allowed. The prior
assignment remains in history and requires a reason.

### Progress notes

Each note has exactly one visibility:

- `PUBLIC`: reporter and sanitized public ongoing projection;
- `INTERNAL`: admin only.

Examples of public updates: inspection underway, waiting for spare part,
replacement purchase, repair in progress.

Examples of internal notes: vendor estimate, sensitive cost discussion,
internal evaluation, or confidential operational details.

### Resolution and closing

`RESOLVED` requires a resolution note. Reporter can see the public resolution
update. `CLOSED` is terminal for MVP.

## 9. Lifecycle State Machine

| Current | Allowed next | Required condition |
|---|---|---|
| `REPORTED` | `VERIFIED` | category, issue type, location/facility, final priority |
| `REPORTED` | `REJECTED` | rejection reason |
| `REPORTED` | `DUPLICATE` | canonical ticket |
| `VERIFIED` | `ASSIGNED` | active technician |
| `ASSIGNED` | `INSPECTION` | assignment exists |
| `INSPECTION` | `IN_REPAIR` | inspection recorded |
| `INSPECTION` | `RESOLVED` | resolution note |
| `IN_REPAIR` | `RESOLVED` | resolution note |
| `RESOLVED` | `CLOSED` | close action |
| `RESOLVED` | `IN_REPAIR` | reopen reason |

Only admin can make transitions. Every transition appends a timeline and audit
record.

## 10. Data Model Blueprint

The exact ORM is a later implementation decision. The domain model should
contain at least:

### Identity

- `users`: internal identity, role, SSO external ID, active state;
- `sessions`: server-side session metadata.

### Master data

- `buildings`;
- `floors`;
- `rooms`;
- `facility_categories`;
- `issue_types`;
- `facility_profiles`;
- `facility_instances` or aggregate room facilities;
- `technicians`.

### Report domain

- `maintenance_reports`;
- `report_attachments`;
- `report_links` for `DUPLICATE`, `SUPPORTING`, and `RELATED`;
- `report_assignments`;
- `progress_notes`;
- `report_timeline`;
- `audit_logs`;
- `notifications`.

### AI and analytics

- `ai_review_runs`;
- `ai_suggestions`;
- derived analytics queries or materialized reporting views.

Important invariants:

- `ticket_number` unique;
- `room_code` unique in the imported location scope;
- a report has one reporter;
- an assignment has one active technician at a time;
- only one final status at a time;
- audit rows are append-only;
- attachment access is authorized per report;
- public projections never expose reporter PII or internal notes.

## 11. API and Service Boundaries

Use a modular monolith for MVP:

```text
auth
master-data
reports
workflow
attachments
notifications
ai-review
analytics
audit
```

Suggested application operations:

- `getBuildings()`;
- `getFloors(buildingCode)`;
- `getRooms(buildingCode, floorNumber)`;
- `getFacilities(roomCode)`;
- `getIssueTypes(facilityCode)`;
- `createReport(input, actor)`;
- `findDuplicateCandidates(reportInput, actor)`;
- `verifyReport(reportId, decision, expectedVersion)`;
- `transitionReport(reportId, targetStatus, expectedVersion)`;
- `assignTechnician(reportId, technicianId, reason)`;
- `addProgressNote(reportId, visibility, body)`;
- `getReporterReport(reportId, actor)`;
- `getPublicOngoingReports(filters)`.

Every mutation must accept an authorization context and expected version where
concurrency matters.

## 12. Authentication and Security

### Provider abstraction

- MVP/pilot: `MockSsoProvider` di semua environment (keputusan tim 2026-10-10;
  integrasi SSO UPI ditunda; pilot production wajib akses terbatas);
- setelah SSO UPI tersedia: production wajib `UpiSsoProvider` dan guard
  penolakan mock diaktifkan kembali;
- production startup must fail when `AUTH_PROVIDER=mock`;
- no fake local passwords;
- server-side authorization on every protected mutation and read.

### Data protection

- do not send reporter PII, NIM, private attachments, internal notes, or
  secrets to the AI provider;
- strip or minimize image metadata before external processing;
- use signed or authorized attachment access;
- sanitize public projections;
- log security-relevant decisions without logging secrets;
- validate all uploaded file type, size, and content constraints.

## 13. AI Decision-Support Plan

AI runs asynchronously after report creation or when admin requests a review.

Allowed outputs:

- suggested validity;
- duplicate signal;
- suggested priority;
- risk and impact factors;
- short explanation for admin review.

Not allowed:

- final category or issue type;
- final priority;
- status mutation;
- rejection;
- duplicate confirmation;
- technician assignment.

If AI fails, the report remains usable and admin can process it manually.
Store provider, model, request policy, version, output, error state, and
review timestamps.

## 14. Priority Plan

The priority recommendation uses three configurable dimensions:

- asset category weight;
- asset/facility weight;
- location usage weight, increasing with classroom lecture frequency.

The MVP exposes `LOW`, `MEDIUM`, and `HIGH`. Numeric weights and thresholds
remain configuration data pending calibration with UMPER/admin. Baseline
provisional: category 0–40 + asset 0–30 + location 0–30, mapping LOW 0–39 /
MEDIUM 40–69 / HIGH 70–100. Issue type `DANGEROUS` always yields at least
HIGH. Admin sets `finalPriority`; overrides record a reason. Config changes
apply to new reports only; stored scores and decision history are immutable.

## 15. Notification Plan

MVP uses in-app notifications:

- report verified;
- report rejected;
- report marked duplicate;
- technician assigned;
- new public update;
- report resolved;
- report closed.

Notifications have unread/read state and link to the report. Email and
WhatsApp are later scope.

## 16. Analytics Plan

Initial admin analytics:

- report volume over time;
- reports by building, room, facility category, and issue type;
- counts by lifecycle status;
- priority distribution;
- average time from report to verification;
- average time from assignment to resolution;
- reopen rate;
- duplicate and rejection rates;
- top recurring facilities.

Analytics must be derived from persisted report and timeline events, not
manually entered dashboard values.

## 17. Implementation Phases

### Phase 0: decision and data alignment

Deliver:

- approved role and lifecycle decisions;
- verified `rooms_lengkap.csv`;
- reviewed category and issue taxonomy;
- facility profile rules;
- accepted Figma screen inventory;
- priority rubric decision;
- duplicate detection decision;
- upload and privacy policy;
- deployment profile.

Gate:

- no unlabelled provisional rule is used as production policy.

### Phase 1: foundation and shell

Deliver:

- project scaffold;
- environment configuration;
- SSO abstraction;
- server session and authorization;
- design tokens from [DESIGN.md](./DESIGN.md);
- application shell;
- login page;
- accessible component primitives.

Gate:

- reporter and admin can authenticate in mock mode;
- unauthorized access returns a clear forbidden state;
- production guard rejects mock provider.

### Phase 2: master data and reporter vertical slice

Deliver:

- database schema and seed/import;
- building/floor/room cascade;
- facility profile resolution;
- issue type filtering;
- report creation;
- optional image upload;
- ticket number;
- reporter report list and detail.

Gate:

- a reporter can submit a complete report from verified location to ticket;
- invalid room/facility combinations are rejected server-side;
- attachment policy is enforced.

### Phase 3: admin workflow

Deliver:

- report table and filters;
- verification;
- status state machine;
- priority finalization;
- technician master and assignment;
- public/internal notes;
- timeline and audit log;
- reporter notifications.

Gate:

- every transition enforces prerequisites;
- closed, rejected, and duplicate reports cannot be reopened in MVP;
- internal notes are never visible to reporters.

### Phase 4: public status and analytics

Deliver:

- sanitized ongoing report projection;
- facility status view;
- admin analytics;
- export or review-friendly views if required.

Gate:

- no PII, internal note, or private attachment leaks into public projections;
- metrics reconcile with report and timeline data.

### Phase 5: AI decision support

Deliver:

- queued AI review;
- structured output validation;
- suggestion panel;
- override reason;
- provider/model policy;
- AI failure fallback.

Gate:

- AI cannot mutate final workflow fields;
- reports remain processable when AI is unavailable;
- prohibited fields are not sent to provider.

### Phase 6: hardening and release

Deliver:

- accessibility review;
- responsive review;
- security review;
- performance checks;
- backup and migration procedure;
- deployment runbook;
- user acceptance test with UMPER/admin.

Gate:

- all P0 acceptance criteria pass;
- no critical authorization or data exposure issue remains open.

## 18. Testing Strategy

### Unit tests

- state transition matrix;
- duplicate candidate matching;
- location hierarchy filtering;
- facility profile resolution;
- issue type filtering;
- priority calculation;
- public projection sanitization;
- attachment validation.

### Integration tests

- mock SSO login and role resolution;
- report creation transaction;
- upload and authorized retrieval;
- admin verification and assignment;
- notification creation;
- AI failure fallback.

### End-to-end tests

1. reporter logs in and submits a classroom AC report;
2. duplicate warning appears without blocking submit;
3. admin verifies and assigns technician;
4. admin adds public update and internal note;
5. reporter sees public update but not internal note;
6. admin resolves and closes the report;
7. public ongoing view contains only sanitized data.

### Accessibility tests

- keyboard-only navigation;
- focus visibility;
- screen reader labels;
- validation announcements;
- modal focus trap;
- contrast check against locked tokens;
- reduced-motion behavior.

## 19. Operational States

Every data page and important component must specify:

- loading;
- empty;
- partial data;
- validation error;
- forbidden;
- not found;
- retryable server error;
- success feedback;
- session expiry;
- offline or interrupted upload.

### Recovery rules

- session expiry redirects to login and preserves a safe return path;
- refresh on a report form preserves draft fields where safe;
- back navigation warns before losing entered description or attachment;
- failed upload can retry one file without resetting all fields;
- stale admin edit returns a conflict message and reload option;
- failed AI review shows `AI unavailable` without blocking admin.

## 20. Definition of Done for MVP

- [ ] reporter can authenticate through the configured mock provider;
- [ ] admin and reporter permissions are enforced server-side;
- [ ] verified room master is imported;
- [ ] facility and issue selections are structured;
- [ ] reporter can submit a report with optional image;
- [ ] ticket number and timeline are created;
- [ ] duplicate warning is deterministic and non-blocking;
- [ ] admin can verify, classify, prioritize, assign, update, resolve, and
      close;
- [ ] public/internal visibility is enforced;
- [ ] notifications work in-app;
- [ ] analytics reconcile with stored events;
- [ ] AI is advisory and failure-safe;
- [ ] all P0 accessibility and security tests pass;
- [ ] design implementation follows [DESIGN.md](./DESIGN.md) without
      introducing a second visual language.

## 21. Open Decisions Register

| ID | Decision | Status | Owner |
|---|---|---|---|
| D-01 | Ballroom C has nine internal AC units and two corridor AC units on floor 5 | Confirmed working model | UMPER/admin |
| D-02 | All 27 rooms with `KULIAH` in the name (24 in C + 3 in I) share the classroom baseline | Decided for pilot | UMPER/admin |
| D-03 | Non-classroom facility profiles | Open | UMPER/admin |
| D-04 | Facility categories: 6 active (ELECTRICAL, HVAC, FURNITURE, ELECTRONIC, PLUMBING, OTHER); 9 old codes kept as inactive | Team-approved, pending UMPER/admin | UMPER/admin |
| D-05 | Issue types: 7 generic active (BROKEN, NOT_WORKING, MISSING, DIRTY, LEAKING, DANGEROUS, OTHER); 4 specific codes kept as inactive | Team-approved, pending UMPER/admin | UMPER/admin |
| D-06 | Criticality ownership and values | Open | UMPER/admin |
| D-07 | Active/inactive rooms and buildings | Current baseline: all active | UMPER/admin |
| D-08 | Priority: 3 dimensions (category 40 + asset 30 + location 30), provisional v1 weights/thresholds in `facility-weights.csv` / `priority-thresholds.csv` / `location-usage.csv`, safety `DANGEROUS`→min HIGH, manual tiers pending schedule data | Baseline set, pending UMPER/admin calibration | UMPER/admin |
| D-09 | Deployment profile: local-only for pilot (containers on dev machine; VPS/Cloudflare deferred) | Decided for pilot | Project team |
| D-10 | Individual asset inventory requirement | Deferred | Project owner |

## 22. Build Handoff

### Target engineering agent

Use `react-vite-tailwind-engineer` for a client-only SPA. If the selected
application framework uses SSR, use `nextjs-senior-engineer` instead.

### Design system

Use **Radix primitives + shadcn/ui**. Install and configure the system once,
then theme it with the locked tokens in [DESIGN.md](./DESIGN.md).

**Implement exactly this spec. Theme the design system with our locked tokens;
do not redesign or re-implement its components.**

### Handoff acceptance criteria

- visual structure matches the supplied Figma reference for login and reporter
  dashboard;
- every screen reads as the same product if placed side by side;
- location, facility, and issue data are server-validated;
- all workflow and visibility rules in this document are enforced;
- all loading, empty, error, forbidden, and session states are implemented;
- keyboard and screen reader behavior meets the accessibility baseline;
- no AI suggestion can mutate a final admin decision;
- master data remains importable and auditable;
- no unrelated design language or unapproved provisional policy is introduced.
