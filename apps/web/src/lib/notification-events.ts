// Cross-component signal for read-state changes. The notification page and the
// reporter shell are separate route layers, so marking rows read in-place would
// otherwise leave the shell's "Notifikasi" dot stale until a full reload.
export const NOTIFICATIONS_CHANGED_EVENT = 'silapor:notifications-changed';

/** Announce that the caller mutated read state (mark one / mark all). */
export function announceNotificationsChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}
