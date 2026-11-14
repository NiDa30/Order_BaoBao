// Lite version: server-rendered POS for browsers without JavaScript (Opera Mini Extreme mode).
// Every action is a plain form POST → Supabase RPC (same checks as the main app) → redirect.
import { randomUUID } from 'node:crypto';
import { isAdmin, canShift, visibleData } from '../permissions.js';
import { buildExport } from '../data-export.js';
import { seed } from '../seed-menu.js';
import { layout, receiptBlocks, PAPERS, DEFAULT_SHOP } from '../receipt.js';
import { textJob } from '../escpos.js';
import { rawbtUrl } from '../printer.js';
import { createSupabase, friendlyError } from './supabase.js';
import { LiteError, createOrder, editOrder, payOrder, cancelOrder, openShift, closeShift, menuItem } from './actions.js';
import * as V from './views.js';

const COOKIE = { session: 'lite_s', csrf: 'lite_c', flash: 'lite_f', print: 'lite_p' };
const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
const unb64 = v => { try { return JSON.parse(Buffer.from(String(v), 'base64url').toString('utf8')); } catch { return null; } };
const parseCookies = h => Object.fromEntries(String(h || '').split(';').map(p => p.trim()).filter(Boolean).map(p => { const i = p.indexOf('='); return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))]; }));
const dateKey = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const fromLocal = (v, fallback) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(v || '')) ? new Date(`${v}:00+07:00`).toISOString() : fallback);
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const emptyData = () => ({ menu: [], orders: [], closings: [], openings: [] });
const defaultPrint = () => ({ paper: 58, copies: 1, shop: { ...DEFAULT_SHOP } });

export function createLiteApp({ supabaseUrl, supabaseKey, fetchImpl, clock = () => new Date(), uuid = randomUUID } = {}) {
  const sb = createSupabase({ url: supabaseUrl, key: supabaseKey, fetchImpl });

  return async function handle(req) {
    const url = new URL(req.url || '/lite', 'http://lite.local'), q = url.searchParams;
    const cookies = parseCookies(req.headers?.cookie);
    const secure = req.headers?.['x-forwarded-proto'] === 'https' || req.secure;
    const setCookies = [];
    const cookie = (name, value, maxAge) => setCookies.push(`${name}=${value === null ? '' : encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${value === null ? 0 : maxAge}`);
    const headers = (extra = {}) => ({
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'",
      ...(setCookies.length ? { 'Set-Cookie': setCookies } : {}), ...extra,
    });
    const html = (body, status = 200) => ({ status, headers: headers(), body });
    const redirect = (location, text, error = false) => { if (text) cookie(COOKIE.flash, b64({ text, error }), 60); return { status: 303, headers: headers({ Location: location }), body: '' }; };

    let csrf = cookies[COOKIE.csrf];
    if (!/^[\w-]{20,}$/.test(csrf || '')) { csrf = uuid(); cookie(COOKIE.csrf, csrf, 60 * 60 * 24 * 30); }
    const flash = cookies[COOKIE.flash] ? unb64(cookies[COOKIE.flash]) : null;
    if (flash) cookie(COOKIE.flash, null);
    const now = clock(), ctx = { csrf, flash, now: now.toISOString(), today: dateKey(now), uuid, access: null };
    const print = { ...defaultPrint(), ...(unb64(cookies[COOKIE.print]) || {}) };
    print.shop = { ...DEFAULT_SHOP, ...(print.shop || {}) };

    if (!sb.configured) return html(V.page(ctx, { title: 'Chưa cấu hình', body: '<h1>Chưa cấu hình Supabase</h1><p>Đặt VITE_SUPABASE_URL và VITE_SUPABASE_PUBLISHABLE_KEY trong Environment Variables của Vercel rồi triển khai lại.</p>' }), 500);
    const post = req.method === 'POST', body = post ? new URLSearchParams(req.body || '') : new URLSearchParams();
    const action = body.get('a') || '';
    if (post && body.get('t') !== csrf) return redirect(V.url('home'), 'Phiên làm việc đã hết hạn. Hãy thao tác lại.', true);

    if (post && action === 'login') {
      const email = String(body.get('email') || '').trim();
      try {
        const s = await sb.signIn(email, String(body.get('password') || ''));
        cookie(COOKIE.session, b64(s), 60 * 60 * 24 * 30);
        return redirect(V.url('home'), 'Đã đăng nhập.');
      } catch (e) { return html(V.loginPage(ctx, { email, error: friendlyError(e) })); }
    }

    let session = unb64(cookies[COOKIE.session]);
    if (!session?.access || !session?.refresh) return post ? redirect(V.url('login')) : html(V.loginPage(ctx));
    if (Number(session.expiresAt) - 60 < now.getTime() / 1000) {
      try { session = await sb.refresh(session.refresh); cookie(COOKIE.session, b64(session), 60 * 60 * 24 * 30); }
      catch { cookie(COOKIE.session, null); return post ? redirect(V.url('login'), 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.', true) : html(V.loginPage(ctx, { error: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.' })); }
    }
    const token = session.access;
    if (post && action === 'logout') { await sb.signOut(token); cookie(COOKIE.session, null); return redirect(V.url('login'), 'Đã đăng xuất.'); }

    async function load() {
      const row = await sb.rpc(token, 'pos_read_workspace');
      if (!row?.access) throw Object.assign(new Error('Tài khoản chưa được phân quyền.'), { code: '42501' });
      ctx.access = row.access;
      ctx.revision = row.revision || 0;
      let data = { ...emptyData(), ...(row.data || {}) };
      if (isAdmin(row.access) && !data.menu.length && !data.orders.length && !data.closings.length) data = { ...data, menu: structuredClone(seed) };
      ctx.data = visibleData(data, row.access);
      ctx.actor = { id: row.access.userId, email: row.access.email };
    }
    try { await load(); }
    catch (e) {
      if (e.status === 401) { cookie(COOKIE.session, null); return html(V.loginPage(ctx, { error: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.' })); }
      if (e.code === '42501') return html(V.noAccessPage(ctx, friendlyError(e)), 403);
      return html(V.page(ctx, { title: 'Lỗi kết nối', body: `<h1>Chưa tải được dữ liệu</h1><p>${V.esc(friendlyError(e))}</p><a class="btn" href="${V.url('home')}">Thử lại</a>` }), 502);
    }
    const admin = isAdmin(ctx.access), actor = ctx.actor;

    /** Apply a mutation and save with optimistic concurrency, re-reading and retrying on conflicts. */
    async function save(fn) {
      for (let attempt = 0; ; attempt++) {
        const result = fn(ctx.data, ctx);
        if (!result.next) return result;
        try {
          await sb.rpc(token, 'pos_save_workspace', { expected_revision: ctx.revision, next_data: visibleData(result.next, ctx.access) });
          return result;
        } catch (e) {
          if (e.code === '40001' && attempt < 2) { await load(); continue; }
          throw e;
        }
      }
    }
    const manage = (act, payload) => sb.rpc(token, 'pos_manage', { action: act, payload });
    const back = (p, params, text, error) => redirect(V.url(p, params), text, error);
    const findOrder = id => ctx.data.orders.find(o => o.id === id);
    const notFound = () => html(V.page(ctx, { title: 'Không tìm thấy', body: `<h1>Không tìm thấy</h1><p>Đơn không tồn tại hoặc bạn không có quyền xem.</p><a href="${V.url('home')}">← Về quầy</a>` }), 404);
    const adminOnly = () => back('home', {}, 'Chỉ admin được dùng chức năng này.', true);
    const defaultShift = () => {
      const allowed = [1, 2, 3].filter(s => canShift(ctx.access, ctx.today, s));
      const openNow = allowed.find(s => (ctx.data.openings || []).some(o => o.day === ctx.today && o.shift === s) && !(ctx.data.closings || []).some(c => c.day === ctx.today && c.shift === s));
      return openNow || allowed[0] || 1;
    };
    const shiftParam = v => { const s = Number(v); return [1, 2, 3].includes(s) ? s : null; };
    const cashierOf = o => { const id = o.status === 'paid' ? o.paidBy : actor.id; const m = (ctx.access.members || []).find(x => x.user_id === id); return m?.display_name || (o.status === 'paid' ? o.paidByEmail : actor.email) || ''; };

    if (post) {
      try {
        switch (action) {
          case 'order-create': {
            const items = [...body.keys()].filter(k => k.startsWith('q_')).map(k => ({ id: k.slice(2), qty: parseInt(body.get(k), 10) || 0 }));
            const values = { table: body.get('table') || '', customer: body.get('customer') || '', note: body.get('note') || '', qty: Object.fromEntries(items.map(i => [i.id, i.qty || ''])) };
            try {
              const r = await save((d, c) => createOrder(d, c, { shift: body.get('s'), table: values.table, customer: values.customer, note: values.note, items }));
              return back('order', { id: r.order.id }, 'Đã lưu đơn hàng. Thanh toán ở bên dưới khi khách trả tiền.');
            } catch (e) { if (e instanceof LiteError) return html(V.orderFormPage(ctx, { shift: shiftParam(body.get('s')) || defaultShift(), values, error: e.message })); throw e; }
          }
          case 'order-edit': {
            const order = findOrder(body.get('id'));
            if (!order) return notFound();
            const items = [...body.keys()].filter(k => k.startsWith('q_')).map(k => { const id = k.slice(2), pr = body.get('pr_' + id); return { id, qty: parseInt(body.get(k), 10) || 0, price: pr == null || pr === '' ? undefined : Number(pr) }; });
            const input = { id: order.id, version: body.get('v'), table: body.get('table') || '', customer: body.get('customer') || '', note: body.get('note') || '', items, editReason: body.get('editReason') || '', settlementMethod: body.get('settlementMethod'), settlementConfirmed: body.get('settlementConfirmed') === '1' };
            try {
              await save((d, c) => editOrder(d, c, input));
              return back('order', { id: order.id }, 'Đã cập nhật đơn hàng và báo cáo liên quan.');
            } catch (e) {
              if (!(e instanceof LiteError)) throw e;
              const values = { table: input.table, customer: input.customer, note: input.note, editReason: input.editReason, settlementMethod: input.settlementMethod, qty: Object.fromEntries(items.map(i => [i.id, i.qty || ''])), price: Object.fromEntries(items.filter(i => i.price !== undefined).map(i => [i.id, i.price])) };
              const newTotal = items.reduce((s, i) => { const base = order.items.find(x => x.id === i.id) || ctx.data.menu.find(m => m.id === i.id); return s + (base ? (i.price ?? base.price) * i.qty : 0); }, 0);
              return html(V.orderFormPage(ctx, { order, values, error: e.message, delta: order.status === 'paid' ? newTotal - order.items.reduce((s, i) => s + i.price * i.qty, 0) : 0 }));
            }
          }
          case 'order-pay': {
            const r = await save((d, c) => payOrder(d, c, { id: body.get('id'), method: body.get('method') }));
            return back('order', { id: r.order.id }, `Đã lưu thanh toán bằng ${r.order.paymentMethod === 'cash' ? 'tiền mặt' : 'chuyển khoản'}.`);
          }
          case 'order-cancel': {
            const order = findOrder(body.get('id'));
            if (!order) return notFound();
            try {
              await save((d, c) => cancelOrder(d, c, { id: order.id, reason: body.get('reason'), refund: body.get('refund') === '1' }));
              return back('order', { id: order.id }, 'Đã hủy đơn và lưu lý do.');
            } catch (e) { if (e instanceof LiteError) return html(V.cancelPage(ctx, order, e.message)); throw e; }
          }
          case 'shift-open': {
            const shift = shiftParam(body.get('s')), staffId = admin ? body.get('staffId') || actor.id : actor.id;
            try {
              if (admin && staffId !== actor.id && !(ctx.access.assignments || []).some(a => a.day === ctx.today && Number(a.shift) === shift && a.user_id === staffId)) {
                await manage('assignment.set', { userId: staffId, day: ctx.today, shift, enabled: true });
                await load();
              }
              const r = await save((d, c) => openShift(d, c, { day: c.today, shift, staffId, openedAt: fromLocal(body.get('at'), c.now), initialCash: body.get('initialCash'), note: body.get('note') }));
              return back('shifts', {}, r.opening.staffEmail !== actor.email ? `Đã mở ca ${shift} thay cho ${r.opening.staffName}.` : `Đã mở ca ${shift}. Chúc bạn ca làm việc thuận lợi!`);
            } catch (e) { if (e instanceof LiteError) return html(V.shiftOpenPage(ctx, shift || 1, e.message, Object.fromEntries(['at', 'initialCash', 'note', 'staffId'].map(k => [k, body.get(k) ?? undefined])))); throw e; }
          }
          case 'shift-close': {
            const shift = shiftParam(body.get('s'));
            try {
              const r = await save((d, c) => closeShift(d, c, { shift, at: fromLocal(body.get('at'), c.now), actualCash: body.get('actualCash'), note: body.get('note'), staffId: admin ? body.get('staffId') : null }));
              return back('shifts', {}, r.closing.closedForEmail && r.closing.closedForEmail !== actor.email ? `Đã kết ca ${shift} thay cho ${r.closing.closedForName || r.closing.closedForEmail}.` : `Đã kết ca ${shift}. Báo cáo đã được lưu.`);
            } catch (e) { if (e instanceof LiteError) return html(V.shiftClosePage(ctx, shift || 1, e.message, Object.fromEntries(['at', 'actualCash', 'note', 'staffId'].map(k => [k, body.get(k) ?? undefined])))); throw e; }
          }
          case 'shift-adjust': {
            if (!admin) return adminOnly();
            const amount = Number(body.get('amount')), day = body.get('d'), shift = shiftParam(body.get('s'));
            const reason = String(body.get('reason') || '').trim();
            if (!isDay(day) || !shift || !Number.isFinite(amount) || !amount || reason.length < 3) return html(V.shiftAdjustPage(ctx, day, shift || 1, 'Nhập số tiền khác 0 và lý do (ít nhất 3 ký tự).'));
            await manage('shift.adjust', { day, shift, amount, method: body.get('method') === 'transfer' ? 'transfer' : 'cash', reason });
            return back('shifts', {}, 'Đã lưu điều chỉnh ca.');
          }
          case 'assign': case 'unassign': {
            if (!admin) return adminOnly();
            const day = body.get('d'), shift = shiftParam(body.get('s'));
            if (!isDay(day) || !shift || !body.get('userId')) return back('team', {}, 'Chọn nhân viên, ngày và ca.', true);
            await manage('assignment.set', { userId: body.get('userId'), day, shift, enabled: action === 'assign' });
            return back(body.get('back') === 'shifts' ? 'shifts' : 'team', {}, action === 'assign' ? `Đã phân công ca ${shift}.` : 'Đã gỡ phân ca.');
          }
          case 'menu-save': {
            const input = { id: body.get('id') || '', name: body.get('name'), price: body.get('price'), category: body.get('category') };
            try {
              if (admin) { await save((d, c) => menuItem(d, c, input)); return back('menu', {}, input.id ? 'Đã cập nhật món.' : 'Đã thêm món vào thực đơn.'); }
              const { item } = menuItem(ctx.data, ctx, input), reason = String(body.get('reason') || '').trim();
              if (reason.length < 3) throw new LiteError('Nhập lý do đề xuất (ít nhất 3 ký tự).');
              await manage('proposal.submit', { item, reason });
              return back('menu', {}, 'Đã gửi đề xuất cho admin.');
            } catch (e) { if (e instanceof LiteError) return html(V.menuPage(ctx, { editId: input.id, values: { ...input, reason: body.get('reason') }, error: e.message })); throw e; }
          }
          case 'proposal-review': {
            if (!admin) return adminOnly();
            await manage('proposal.review', { id: body.get('id'), decision: body.get('decision') === 'approved' ? 'approved' : 'rejected' });
            return back('menu', {}, body.get('decision') === 'approved' ? 'Đã duyệt đề xuất và cập nhật thực đơn.' : 'Đã từ chối đề xuất.');
          }
          case 'member-add': {
            if (!admin) return adminOnly();
            const payload = { email: String(body.get('email') || '').trim(), name: String(body.get('name') || '').trim(), role: body.get('role') === 'admin' ? 'admin' : 'staff' };
            if (!payload.email.includes('@') || !payload.name) return html(V.teamPage(ctx, 'Nhập họ tên và email hợp lệ.'));
            if (body.get('mode') === 'new') {
              const password = String(body.get('password') || '');
              if (password.length < 8) return html(V.teamPage(ctx, 'Mật khẩu tạm cần ít nhất 8 ký tự.'));
              await sb.createMember(token, { ...payload, password });
            } else await manage('member.add', payload);
            return back('team', {}, 'Đã thêm tài khoản vào quán.');
          }
          case 'member-update': {
            if (!admin) return adminOnly();
            const payload = { userId: body.get('userId') };
            if (body.has('role')) payload.role = body.get('role') === 'admin' ? 'admin' : 'staff';
            if (body.has('active')) payload.active = body.get('active') === 'true';
            await manage('member.update', payload);
            return back('team', {}, 'Đã lưu thay đổi.');
          }
          case 'password': {
            const password = String(body.get('password') || '');
            if (password.length < 8) return back('account', {}, 'Mật khẩu cần ít nhất 8 ký tự.', true);
            await sb.updatePassword(token, password);
            return back('account', {}, 'Đã đổi mật khẩu.');
          }
          case 'print-settings': {
            const next = { paper: Number(body.get('paper')) === 80 ? 80 : 58, copies: Math.min(3, Math.max(1, Number(body.get('copies')) || 1)), shop: Object.fromEntries(['name', 'address', 'phone', 'footer'].map(k => [k, String(body.get(k) || '').slice(0, 120)])) };
            if (!next.shop.name) next.shop.name = DEFAULT_SHOP.name;
            cookie(COOKIE.print, b64(next), 60 * 60 * 24 * 365);
            return back('account', {}, 'Đã lưu cài đặt in trên máy này.');
          }
          default: return back('home', {}, 'Thao tác không hợp lệ.', true);
        }
      } catch (e) {
        const where = { 'order-pay': ['order', { id: body.get('id') }], 'order-edit': ['order', { id: body.get('id') }], 'order-cancel': ['order', { id: body.get('id') }], 'menu-save': ['menu', {}], 'proposal-review': ['menu', {}], 'member-add': ['team', {}], 'member-update': ['team', {}], 'assign': ['team', {}], 'unassign': ['team', {}], 'password': ['account', {}] }[action] || ['shifts', {}];
        if (e instanceof LiteError) return back(where[0], where[1], e.message, true);
        if (e.status === 401) { cookie(COOKIE.session, null); return redirect(V.url('login'), 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.', true); }
        return back(where[0], where[1], friendlyError(e), true);
      }
    }

    // GET pages
    const p = q.get('p') || 'home';
    switch (p) {
      case 'login': return redirect(V.url('home'));
      case 'home': { const s = shiftParam(q.get('s')); return html(V.homePage(ctx, s && canShift(ctx.access, ctx.today, s) ? s : defaultShift())); }
      case 'new': {
        const s = shiftParam(q.get('s')) || defaultShift();
        if (!canShift(ctx.access, ctx.today, s)) return back('home', {}, 'Bạn chưa được phân công ca này.', true);
        if ((ctx.data.closings || []).some(c => c.day === ctx.today && c.shift === s)) return back('home', { s }, 'Ca này đã kết thúc. Hãy chọn một ca đang mở.', true);
        return html(V.orderFormPage(ctx, { shift: s }));
      }
      case 'order': { const o = findOrder(q.get('id')); return o ? html(V.orderPage(ctx, o)) : notFound(); }
      case 'edit': {
        const o = findOrder(q.get('id'));
        if (!o) return notFound();
        if (o.status === 'cancelled' || !canShift(ctx.access, o.day, o.shift)) return back('order', { id: o.id }, 'Không có quyền sửa đơn này.', true);
        return html(V.orderFormPage(ctx, { order: o }));
      }
      case 'cancel': {
        const o = findOrder(q.get('id'));
        if (!o) return notFound();
        if (o.status === 'cancelled' || (o.status === 'paid' && !admin)) return back('order', { id: o.id }, 'Không có quyền hủy đơn này.', true);
        return html(V.cancelPage(ctx, o));
      }
      case 'bill': {
        const o = findOrder(q.get('id'));
        if (!o || o.status === 'cancelled') return notFound();
        const { chars } = PAPERS[print.paper] || PAPERS[58];
        const copies = Array.from({ length: print.copies }, (_, i) => layout(receiptBlocks(o, { shop: print.shop, cashier: cashierOf(o), copy: i + 1, copies: print.copies }), chars));
        const bytes = Buffer.concat(copies.map(lines => Buffer.from(textJob(lines))));
        return html(V.billPage(ctx, o, { lines: copies[0], rawbtText: rawbtUrl(new Uint8Array(bytes)), paper: print.paper, copies: print.copies }));
      }
      case 'history': return html(V.historyPage(ctx, { q: q.get('q') || '', d: isDay(q.get('d')) ? q.get('d') : '', s: shiftParam(q.get('s')) || '' }));
      case 'menu': return html(V.menuPage(ctx, { editId: q.get('edit') || '' }));
      case 'shifts': return html(V.shiftsPage(ctx, { staff: admin ? q.get('staff') || '' : '', d: isDay(q.get('d')) ? q.get('d') : '' }));
      case 'shift-open': case 'shift-close': {
        const s = shiftParam(q.get('s'));
        if (!s || !canShift(ctx.access, ctx.today, s)) return back('shifts', {}, 'Không có quyền thao tác trên ca này.', true);
        if (p === 'shift-open' && (ctx.data.closings || []).some(c => c.day === ctx.today && c.shift === s)) return back('shifts', {}, 'Ca đã kết, không thể thay đổi giờ mở ca.', true);
        return html(p === 'shift-open' ? V.shiftOpenPage(ctx, s) : V.shiftClosePage(ctx, s));
      }
      case 'shift-adjust': { if (!admin) return adminOnly(); const s = shiftParam(q.get('s')); return isDay(q.get('d')) && s ? html(V.shiftAdjustPage(ctx, q.get('d'), s)) : back('shifts'); }
      case 'assign': { if (!admin) return adminOnly(); const s = shiftParam(q.get('s')); return s ? html(V.assignPage(ctx, s)) : back('shifts'); }
      case 'revenue': return html(V.revenuePage(ctx, { d: isDay(q.get('d')) ? q.get('d') : ctx.today, per: ['day', 'week', 'month'].includes(q.get('per')) ? q.get('per') : 'day', s: shiftParam(q.get('s')) || '' }));
      case 'team': return admin ? html(V.teamPage(ctx)) : adminOnly();
      case 'audit': {
        if (!admin) return adminOnly();
        let rows = [];
        try { rows = (await sb.rpc(token, 'pos_list_audit')) || []; } catch (e) { return back('home', {}, friendlyError(e), true); }
        return html(V.auditPage(ctx, rows, q.get('q') || '', q.get('show')));
      }
      case 'exports': return admin ? html(V.exportsPage(ctx)) : adminOnly();
      case 'download': {
        if (!admin) return adminOnly();
        const filters = { type: q.get('type') || 'orders', from: isDay(q.get('from')) ? q.get('from') : '', to: isDay(q.get('to')) ? q.get('to') : '', shift: shiftParam(q.get('shift')) ? q.get('shift') : '', status: ['open', 'paid', 'cancelled'].includes(q.get('status')) ? q.get('status') : '' };
        try {
          const file = buildExport(ctx.data, filters, { shopName: ctx.access.shopName, syncStatus: 'synced', day: ctx.today });
          return { status: 200, headers: headers({ 'Content-Type': `${file.mime.split(';')[0]}; charset=utf-8`, 'Content-Disposition': `attachment; filename="${file.name.replace(/[^\w.-]/g, '_')}"` }), body: file.text };
        } catch (e) { return back('exports', {}, e.message, true); }
      }
      case 'account': return html(V.accountPage(ctx, print));
      default: return back('home');
    }
  };
}
