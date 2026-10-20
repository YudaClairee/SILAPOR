// Admin workflow POST helper (assign / transition / updates).
// expectedVersion selalu dikirim; 409 dipetakan ke copy baku.
export async function postAdminWorkflow(
  ticket: string,
  suffix: 'assign' | 'transition' | 'updates',
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; message: string }> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/reports/${encodeURIComponent(ticket)}/${suffix}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, message: 'Gagal menghubungi server. Periksa koneksi Anda.' };
  }
  if (response.ok) return { ok: true, status: response.status, message: '' };
  if (response.status === 409) {
    return { ok: false, status: 409, message: 'Tiket diperbarui admin lain — muat ulang data.' };
  }
  try {
    const data = (await response.json()) as { error?: { message?: unknown } };
    const message = typeof data.error?.message === 'string' ? data.error.message : '';
    return { ok: false, status: response.status, message: message === '' ? 'Permintaan gagal. Coba lagi.' : message };
  } catch {
    return { ok: false, status: response.status, message: 'Permintaan gagal. Coba lagi.' };
  }
}
