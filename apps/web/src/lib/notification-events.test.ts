// @vitest-environment jsdom
// The reporter shell and the notification page live in separate route layers;
// this event is what keeps the nav dot in sync after an in-page mark-read.
import { describe, expect, it, vi } from 'vitest';
import {
  NOTIFICATIONS_CHANGED_EVENT,
  announceNotificationsChanged,
} from './notification-events.js';

describe('notification change announcements', () => {
  it('dispatches the shared window event so the reporter shell can refetch', () => {
    const listener = vi.fn();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, listener);
    try {
      announceNotificationsChanged();
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, listener);
    }
  });
});
