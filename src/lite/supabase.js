// Minimal server-side Supabase client over fetch (Auth password/refresh grants, RPC, Edge Function).
// Uses only the public URL + publishable/anon key and the user's own JWT, exactly like the browser app.
export class SupabaseError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createSupabase({ url, key, fetchImpl = globalThis.fetch }) {
  const base = String(url || '').replace(/\/+$/, '');
  async function call(path, { method = 'POST', token, body } = {}) {
    let res;
    try {
      res = await fetchImpl(base + path, {
        method,
        headers: { apikey: key, 'Content-Type': 'application/json', Authorization: `Bearer ${token || key}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new SupabaseError('Không kết nối được Supabase. Kiểm tra mạng và thử lại.', { status: 0, code: 'network' });
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const message = data?.msg || data?.message || data?.error_description || data?.error || res.statusText || 'Lỗi Supabase';
      throw new SupabaseError(message, { status: res.status, code: data?.code || data?.error_code || '' });
    }
    return data;
  }
  const session = d => ({
    access: d.access_token,
    refresh: d.refresh_token,
    expiresAt: d.expires_at || Math.floor(Date.now() / 1000) + (Number(d.expires_in) || 3600),
    userId: d.user?.id || '',
    email: d.user?.email || '',
  });
  return {
    configured: !!base && !!key,
    signIn: async (email, password) => session(await call('/auth/v1/token?grant_type=password', { body: { email, password } })),
    refresh: async refreshToken => session(await call('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } })),
    signOut: token => call('/auth/v1/logout?scope=local', { token, body: {} }).catch(() => null),
    updatePassword: (token, password) => call('/auth/v1/user', { method: 'PUT', token, body: { password } }),
    rpc: (token, name, args = {}) => call(`/rest/v1/rpc/${name}`, { token, body: args }),
    createMember: (token, payload) => call('/functions/v1/pos-create-member', { token, body: payload }),
  };
}

/** Same wording as the browser app (cloud-store.js friendly()). */
export function friendlyError(error) {
  const msg = String(error?.message || '');
  if (['PGRST202', '42P01', '42883'].includes(error?.code)) return 'Database chưa được khởi tạo. Cần chạy migration Supabase của dự án.';
  if (/Invalid login credentials|invalid_credentials/i.test(msg) || error?.code === 'invalid_credentials') return 'Email hoặc mật khẩu chưa đúng.';
  if (/Email not confirmed/i.test(msg)) return 'Email chưa được xác nhận trong Supabase.';
  if (error?.code === 'network') return msg;
  // Database exceptions raised by the RPCs carry readable Vietnamese messages; keep them.
  if (['42501', '23514'].includes(error?.code) && msg) return msg;
  if (error?.code === '40001') return 'Dữ liệu vừa được thay đổi trên thiết bị khác. Hãy thử lại.';
  return msg || 'Chưa kết nối được Supabase. Hãy thử lại.';
}
