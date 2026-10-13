// Locked-token sync test (Task D-5, RED-first).
//
// Asserts apps/web/src/styles.css @theme carries the teal/slate DESIGN.md
// values verbatim. Pure string assertions on the CSS source — no DOM, so the
// existing node vitest runner is sufficient.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8').toLowerCase();

function expectToken(name: string, hex: string): void {
  expect(css).toContain(`--color-${name}: ${hex};`);
}

describe('locked @theme tokens (teal/slate DESIGN.md)', () => {
  it('carries the seven changed canvas/text/border values verbatim', () => {
    expectToken('background', '#f4f6f8');
    expectToken('surface', '#ffffff');
    expectToken('text', '#1e293b');
    expectToken('muted', '#64748b');
    expectToken('subtle', '#94a3b8');
    expectToken('border', '#e2e8f0');
    expectToken('accent', '#0a3947');
  });

  it('adds accent-secondary and re-derives accent-contrast as white', () => {
    expectToken('accent-secondary', '#007b8a');
    expectToken('accent-contrast', '#ffffff');
  });

  it('keeps the unchanged semantic + elevated values', () => {
    expectToken('elevated', '#ffffff');
    expectToken('success', '#258a5b');
    expectToken('warning', '#b87512');
    expectToken('danger', '#b8453d');
    expectToken('info', '#426e9b');
  });

  it('keeps radius-full 9999px in @theme', () => {
    expect(css).toContain('--radius-full: 9999px;');
  });

  it('contains no stale old-spec accent value', () => {
    expect(css).not.toContain('#d9772a');
  });
});
