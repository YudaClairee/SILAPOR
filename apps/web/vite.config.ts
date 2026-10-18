// TanStack Start config for Node target (Task 2, pilot).
// Plain Node build with no edge adapter plugins; edge deployment steps
// are deferred until the deployment decision lands (see Task 2 brief).
import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    // Tailwind v4 Vite-native path (Task D-1): CSS-only transform, order
    // relative to tanstackStart() is not significant; React's plugin must
    // stay after Start's plugin.
    tailwindcss(),
    tanstackStart({
      // Ignore colocated Vitest files so the route generator skips them.
      // Without this, every `src/routes/*.test.tsx` triggers a
      // "does not export a Route" warning on dev/build.
      router: {
        routeFileIgnorePattern: '\.(test|spec)\.(ts|tsx)$',
      },
    }),
    // React's Vite plugin must come after Start's plugin.
    viteReact(),
  ],
});
