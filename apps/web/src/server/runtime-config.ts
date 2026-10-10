// Web server re-export of the shared runtime config (Task 2).
// Server code imports config only from here — never `process.env` directly,
// and never `VITE_*` secrets into the client bundle. Workers bindings are
// deferred (pilot is Node-only); they will be read per-request later.
export { getRuntimeConfig } from '@silapor/shared';
export type { RuntimeConfig } from '@silapor/shared';
