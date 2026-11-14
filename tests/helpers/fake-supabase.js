// In-memory stand-in for Supabase Auth + the pos_* RPCs, used by the Lite tests (server-side calls).
// Each email domain is its own shop, so parallel tests stay isolated. Local part "admin*" → admin role,
// "blocked*" → no access, anything else → staff. Password "wrong-password" fails. Rules mirror the SQL checks
// that matter for the Lite flows (CAS revision, staff shift filtering, closing with unpaid orders, admin-only actions).
import http from 'node:http';
import { createHash } from 'node:crypto';

const shops = new Map(), tokens = new Map();
const idOf = email => { const h = createHash('sha1').update(email).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const shopOf = email => {
  const key = email.split('@')[1];
  if (!shops.has(key)) shops.set(key, { key, revision: 0, data: { menu: [], orders: [], closings: [], openings: [] }, members: [], assignments: [], proposals: [], audit: [], passwords: {} });
  return shops.get(key);
};
const roleOf = email => (email.startsWith('admin') ? 'admin' : 'staff');
function ensureMember(shop, email, { role = roleOf(email), name } = {}) {
  let m = shop.members.find(x => x.email === email);
  if (!m) { m = { user_id: idOf(email), email, role, active: true, display_name: name || email.split('@')[0] }; shop.members.push(m); }
  return m;
}
const canShift = (shop, m, day, shift) => m.role === 'admin' || shop.assignments.some(a => a.user_id === m.user_id && a.day === day && Number(a.shift) === Number(shift));
function view(shop, m) {
  const d = structuredClone(shop.data), staff = m.role !== 'admin';
  if (staff) for (const k of ['orders', 'closings', 'openings']) d[k] = (d[k] || []).filter(x => canShift(shop, m, x.day, x.shift));
  return {
    data: d, revision: shop.revision,
    access: { shopId: shop.key, shopName: 'Lam An', userId: m.user_id, email: m.email, role: m.role, members: structuredClone(shop.members), assignments: structuredClone(shop.assignments.filter(a => !staff || a.user_id === m.user_id)), proposals: structuredClone(shop.proposals.filter(p => !staff || p.email === m.email)) },
  };
}
class DbError extends Error { constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; } }
const total = o => o.items.reduce((s, i) => s + i.price * i.qty, 0);

function save(shop, m, { expected_revision, next_data }) {
  if (!next_data || !Array.isArray(next_data.menu) || !Array.isArray(next_data.orders) || !Array.isArray(next_data.closings)) throw new DbError('Invalid workspace shape', '23514');
  if (expected_revision !== shop.revision) throw new DbError('Workspace changed; fetch and merge again', '40001', 409);
  const cur = shop.data, next = structuredClone(next_data);
  if (m.role !== 'admin') {
    if (JSON.stringify(next.menu) !== JSON.stringify(cur.menu)) throw new DbError('Chỉ admin được sửa menu', '42501', 403);
    for (const k of ['orders', 'closings', 'openings']) if ((next[k] || []).some(x => !canShift(shop, m, x.day, x.shift))) throw new DbError('Không có quyền trên ca này', '42501', 403);
    next.orders = [...cur.orders.filter(o => !canShift(shop, m, o.day, o.shift)), ...next.orders];
    next.closings = [...cur.closings.filter(c => !canShift(shop, m, c.day, c.shift)), ...next.closings];
    next.openings = [...(cur.openings || []).filter(c => !canShift(shop, m, c.day, c.shift)), ...(next.openings || [])];
  }
  for (const o of cur.orders) {
    const n = next.orders.find(x => x.id === o.id);
    if (!n) throw new DbError('Existing orders cannot be removed', '23514');
    if (n.status === 'cancelled' && o.status === 'paid' && m.role !== 'admin') throw new DbError('Nhân viên không được hủy đơn đã thanh toán', '42501', 403);
    if (o.status === 'cancelled' && JSON.stringify(n) !== JSON.stringify(o)) throw new DbError('Đơn đã hủy không được sửa', '23514');
  }
  for (const c of next.closings) {
    if (cur.closings.some(x => x.day === c.day && x.shift === c.shift)) continue;
    if (next.orders.some(o => o.day === c.day && o.shift === c.shift && o.status === 'open')) throw new DbError('Cannot close shift with unpaid orders', '23514');
  }
  for (const o of next.orders) {
    if (!o.items?.length) throw new DbError('An order must have items', '23514');
    if (!cur.orders.some(x => x.id === o.id) && cur.closings.some(c => c.day === o.day && c.shift === o.shift)) throw new DbError('Cannot add order to a closed shift', '23514');
  }
  if (JSON.stringify(cur.menu) !== JSON.stringify(next.menu)) shop.audit.unshift({ action: 'menu.update', actor_email: m.email, target_id: 'menu', reason: '', before_data: cur.menu, after_data: next.menu, created_at: new Date().toISOString() });
  shop.data = next;
  shop.revision++;
}

function manage(shop, m, { action, payload }) {
  if (action === 'proposal.submit') {
    if (String(payload.reason || '').trim().length < 3) throw new DbError('Kiểm tra nội dung đề xuất', '23514');
    shop.proposals.push({ id: `p${shop.proposals.length + 1}`, email: m.email, payload: payload.item, reason: payload.reason, status: 'pending' });
  } else {
    if (m.role !== 'admin') throw new DbError('Chỉ admin được thực hiện', '42501', 403);
    if (action === 'member.add') ensureMember(shop, payload.email.toLowerCase(), { role: payload.role, name: payload.name });
    else if (action === 'member.update') {
      const t = shop.members.find(x => x.user_id === payload.userId);
      if (!t) throw new DbError('Không tìm thấy nhân viên', '23514');
      if (t.user_id === shop.members[0].user_id && (payload.role === 'staff' || payload.active === false)) throw new DbError('Không khóa hoặc hạ quyền chủ quán', '42501', 403);
      if (payload.role) t.role = payload.role;
      if (payload.active !== undefined) t.active = payload.active;
    } else if (action === 'assignment.set') {
      shop.assignments = shop.assignments.filter(a => !(a.user_id === payload.userId && a.day === payload.day && a.shift === payload.shift));
      if (payload.enabled) shop.assignments.push({ user_id: payload.userId, day: payload.day, shift: payload.shift, shop_id: shop.key });
    } else if (action === 'proposal.review') {
      const p = shop.proposals.find(x => x.id === payload.id && x.status === 'pending');
      if (!p) throw new DbError('Đề xuất đã được xử lý hoặc không tồn tại', '23514');
      p.status = payload.decision;
      if (p.status === 'approved') { shop.data.menu = [...shop.data.menu.filter(i => i.id !== p.payload.id), p.payload]; shop.revision++; }
    } else if (action === 'shift.adjust') {
      const c = shop.data.closings.find(x => x.day === payload.day && x.shift === payload.shift);
      if (!c) throw new DbError('Ca chưa được kết', '23514');
      c.originalRevenue ??= c.revenue;
      c.revenue += payload.amount;
      (c.adjustments ??= []).push({ id: `a${Date.now()}`, amount: payload.amount, method: payload.method, reason: payload.reason, actorEmail: m.email, at: new Date().toISOString() });
      if (payload.method === 'cash') { c.expectedCash = (c.expectedCash || 0) + payload.amount; c.discrepancy = (c.discrepancy || 0) - payload.amount; }
      shop.revision++;
    } else throw new DbError('Thao tác không hỗ trợ', '23514');
  }
  shop.audit.unshift({ action, actor_email: m.email, target_id: payload.userId || payload.email || payload.id || payload.day || '', reason: payload.reason || '', before_data: null, after_data: payload, created_at: new Date().toISOString() });
}

export function startFakeSupabase(port = 0) {
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || '{}') : {};
    const reply = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(value === undefined ? '' : JSON.stringify(value)); };
    try {
      if (u.pathname === '/__state') return reply(200, shops.get(u.searchParams.get('shop')) || null);
      if (u.pathname === '/__seed') { // {email, data?, assign?: [{email, day, shift}], members?: [email]}
        const shop = shopOf(body.email); ensureMember(shop, body.email);
        for (const e of body.members || []) ensureMember(shop, e);
        if (body.data) { shop.data = { ...shop.data, ...body.data }; shop.revision++; }
        for (const a of body.assign || []) shop.assignments.push({ user_id: ensureMember(shop, a.email).user_id, day: a.day, shift: a.shift, shop_id: shop.key });
        return reply(200, { ok: true });
      }
      if (u.pathname === '/auth/v1/token') {
        let email;
        if (u.searchParams.get('grant_type') === 'password') {
          email = String(body.email || '').toLowerCase();
          const shop = shopOf(email);
          if (body.password === 'wrong-password' || (shop.passwords[email] && shop.passwords[email] !== body.password)) return reply(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        } else {
          email = tokens.get(body.refresh_token);
          if (!email) return reply(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
        }
        const n = tokens.size + 1, access = `at-${n}-${idOf(email)}`, refresh = `rt-${n}-${idOf(email)}`;
        tokens.set(access, email); tokens.set(refresh, email);
        const expired = email.includes('expire') && u.searchParams.get('grant_type') === 'password';
        return reply(200, { access_token: access, refresh_token: refresh, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + (expired ? -5 : 3600), user: { id: idOf(email), email } });
      }
      const email = tokens.get(String(req.headers.authorization || '').replace(/^Bearer /, ''));
      if (!email) return reply(401, { code: 'PGRST301', message: 'JWT expired' });
      const shop = shopOf(email);
      if (u.pathname === '/auth/v1/logout') return reply(204);
      if (u.pathname === '/auth/v1/user') { if (body.password) shop.passwords[email] = body.password; return reply(200, { id: idOf(email), email }); }
      if (email.startsWith('blocked')) return reply(403, { code: '42501', message: 'Tài khoản chưa được phân quyền hoặc đã bị khóa' });
      const m = ensureMember(shop, email);
      if (!m.active) return reply(403, { code: '42501', message: 'Tài khoản đã bị khóa' });
      if (u.pathname === '/rest/v1/rpc/pos_read_workspace') return reply(200, view(shop, m));
      if (u.pathname === '/rest/v1/rpc/pos_save_workspace') { save(shop, m, body); return reply(200, view(shop, m)); }
      if (u.pathname === '/rest/v1/rpc/pos_manage') { manage(shop, m, body); return reply(200, view(shop, m)); }
      if (u.pathname === '/rest/v1/rpc/pos_list_audit') return reply(200, m.role === 'admin' ? shop.audit.slice(0, 500) : []);
      if (u.pathname === '/functions/v1/pos-create-member') {
        if (m.role !== 'admin') return reply(403, { error: 'Chỉ admin được tạo tài khoản' });
        shop.passwords[String(body.email).toLowerCase()] = body.password;
        manage(shop, m, { action: 'member.add', payload: { email: body.email, name: body.name, role: body.role } }); // like the real Edge Function
        const nm = shop.members.find(x => x.email === String(body.email).toLowerCase());
        return reply(200, { userId: nm.user_id });
      }
      return reply(404, { message: 'Unexpected request' });
    } catch (e) {
      if (e instanceof DbError) return reply(e.status, { code: e.code, message: e.message });
      return reply(500, { message: String(e) });
    }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
