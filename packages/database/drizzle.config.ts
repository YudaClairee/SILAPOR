// Drizzle Kit config (Task 4). No Cloudflare/Hyperdrive.
//
// Reads DATABASE_URL with a local-dev default matching docker-compose.yml.
// `dbCredentials` is only used by push/migrate-through-kit flows; offline
// `drizzle-kit generate` never opens a connection.

import { defineConfig } from 'drizzle-kit';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://silapor:silapor@localhost:5432/silapor';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: { url: databaseUrl },
});
