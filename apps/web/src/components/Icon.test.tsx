// @vitest-environment jsdom
// LogoMark is the single brand mark rendered by every shell (reporter V2 today,
// admin/privacy/login headers use the same file directly). The test pins it to
// `public/logo-upi.png` so swapping artwork happens in one place only.
import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LogoMark } from './Icon';

afterEach(cleanup);

describe('LogoMark', () => {
  it('renders the shared UPI logo file with the caller size classes', () => {
    const { container } = render(<LogoMark className="h-9 w-9 shrink-0" />);
    const logo = container.querySelector('img');
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute('src', '/logo-upi.png');
    expect(logo).toHaveAttribute('alt', '');
    expect(logo).toHaveAttribute('aria-hidden', 'true');
    expect(logo).toHaveClass('object-contain', 'h-9', 'w-9', 'shrink-0');
  });

  it('keeps object-contain when no size class is given', () => {
    const { container } = render(<LogoMark />);
    const logo = container.querySelector('img');
    expect(logo).toHaveClass('object-contain');
  });
});
