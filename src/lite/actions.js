// Pure workspace mutations for the Lite version. They mirror the handlers in src/main.js so both
// versions write identical data; the database RPCs re-check permissions and business rules.
import { isAdmin, canShift, reportTotals, paymentTotals, orderTotal, closesBeforeOpen } from '../permissions.js';

export class LiteError extends Error {}
const fail = message => { throw new LiteError(message); };
const normalize = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
export const orderVersion = o => {
  // Short fingerprint of an order, used to detect edits made elsewhere while a form was open.
  const s = JSON.stringify(o);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + s.length.toString(36);
};
const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const validItems = items => items.every(i => Number.isFinite(i.price) && i.price >= 1000 && i.price <= 10000000 && Number.isInteger(i.qty) && i.qty >= 1);

function recloseAfterEdit(closings, orders, day, shift, updatedAt) {
  return closings.map(c => {
    if (c.day !== day || c.shift !== shift) return c;
    const paid = orders.filter(o => o.day === c.day && o.shift === c.shift && o.status === 'paid');
    const r = reportTotals(paid, [c]);
    return { ...c, originalRevenue: c.originalRevenue ?? c.revenue, revenue: r.revenue, count: paid.length, expectedCash: r.cash, discrepancy: c.actualCash == null ? null : c.actualCash - r.cash, updatedAt };
  });
}

/** items: [{id, qty}] chosen from the menu. */
export function createOrder(data, ctx, input) {
  const { access, actor, today, now, uuid } = ctx, shift = Number(input.shift);
  if (![1, 2, 3].includes(shift) || !canShift(access, today, shift)) fail('Bạn chưa được phân công ca này.');
  if ((data.closings || []).some(c => c.day === today && c.shift === shift)) fail('Ca này đã kết thúc. Hãy chọn một ca đang mở.');
  const items = input.items
    .filter(i => i.qty > 0)
    .map(i => { const m = data.menu.find(x => x.id === i.id); return m && { ...m, qty: i.qty }; })
    .filter(Boolean);
  if (!items.length) fail('Hãy chọn ít nhất một món.');
  const table = clean(input.table, 60), customer = clean(input.customer, 100), note = clean(input.note, 300);
  if (!table && !customer) fail('Nhập số order hoặc tên khách hàng.');
  if (!validItems(items)) fail('Số lượng hoặc đơn giá không hợp lệ.');
  const id = uuid();
  const order = {
    table, customer, note, items, id, created: now, day: today, shift,
    code: `${today.replaceAll('-', '')}-${String(data.orders.filter(x => x.day === today).length + 1).padStart(3, '0')}-${id.slice(0, 6).toUpperCase()}`,
    label: customer || `Bàn ${table}`,
    status: 'open', createdBy: actor.id, createdByEmail: actor.email,
  };
  return { next: { ...data, orders: [...data.orders, order] }, order };
}

/**
 * items: [{id, qty, price?}] — existing lines may change qty/price; new lines come from the menu.
 * Paid orders need editReason and, if the total changes, settlement {method, confirmed}.
 */
export function editOrder(data, ctx, input) {
  const { access, actor, now } = ctx;
  const original = data.orders.find(o => o.id === input.id);
  if (!original) fail('Không tìm thấy đơn hàng.');
  if (original.status === 'cancelled' || !canShift(access, original.day, original.shift)) fail('Không có quyền sửa đơn này.');
  if (input.version && input.version !== orderVersion(original)) fail('Đơn đã thay đổi trên thiết bị khác. Mở lại đơn để kiểm tra.');
  const items = [];
  for (const line of input.items) {
    if (!(line.qty > 0)) continue;
    const existing = original.items.find(i => i.id === line.id), menu = data.menu.find(m => m.id === line.id);
    const base = existing || menu;
    if (!base) continue;
    items.push({ ...base, qty: line.qty, price: existing && line.price !== undefined ? line.price : base.price });
  }
  if (!items.length) fail('Hãy chọn ít nhất một món.');
  const table = clean(input.table, 60), customer = clean(input.customer, 100), note = clean(input.note, 300);
  if (!table && !customer) fail('Nhập số order hoặc tên khách hàng.');
  if (!validItems(items)) fail('Đơn giá phải từ 1.000 đến 10.000.000 ₫.');
  const editReason = clean(input.editReason, 300);
  const delta = orderTotal({ items }) - orderTotal(original);
  let settlement = null;
  if (original.status === 'paid') {
    if (editReason.length < 3) fail('Hãy nhập lý do sửa đơn đã thanh toán.');
    if (delta) {
      const method = input.settlementMethod === 'transfer' ? 'transfer' : 'cash';
      if (!input.settlementConfirmed) throw Object.assign(new LiteError('Hãy xác nhận đã xử lý tiền chênh lệch.'), { delta });
      settlement = { method, confirmed: true, amount: Math.abs(delta), kind: delta > 0 ? 'collect' : 'refund' };
    }
  }
  const { revisions, ...snapshot } = original;
  const updated = {
    ...original, table, customer, note, items, label: customer || `Bàn ${table}`, updatedAt: now, editReason, settlement,
    updatedBy: actor.id, updatedByEmail: actor.email,
    revisions: [...(revisions || []), { at: now, actorId: actor.id, actorEmail: actor.email, reason: editReason, before: snapshot }],
  };
  if (original.status === 'paid') {
    updated.paymentTotals = { ...paymentTotals(original) };
    if (delta) updated.paymentTotals[settlement.method] += delta;
  }
  const orders = data.orders.map(o => (o.id === original.id ? updated : o));
  return { next: { ...data, orders, closings: recloseAfterEdit(data.closings, orders, original.day, original.shift, now) }, order: updated };
}

export function payOrder(data, ctx, { id, method }) {
  const { access, actor, now } = ctx, order = data.orders.find(o => o.id === id);
  if (!order || !canShift(access, order.day, order.shift)) fail('Không có quyền thao tác đơn này.');
  if (order.status !== 'open') fail('Đơn này không còn chờ thanh toán.');
  if (!['cash', 'transfer'].includes(method)) fail('Chọn phương thức thanh toán.');
  const t = orderTotal(order);
  const paid = { ...order, status: 'paid', paidAt: now, paymentMethod: method, paidBy: actor.id, paidByEmail: actor.email, paymentTotals: { cash: method === 'cash' ? t : 0, transfer: method === 'transfer' ? t : 0, unknown: 0 } };
  return { next: { ...data, orders: data.orders.map(o => (o.id === id ? paid : o)) }, order: paid };
}

export function cancelOrder(data, ctx, { id, reason, refund }) {
  const { access, actor, now } = ctx, original = data.orders.find(o => o.id === id);
  if (!original || original.status === 'cancelled' || !canShift(access, original.day, original.shift) || (original.status === 'paid' && !isAdmin(access))) fail('Không có quyền hủy đơn này.');
  const why = clean(reason, 300);
  if (why.length < 3) fail('Cần lý do hủy đơn.');
  if (original.status === 'paid' && !refund) fail('Xác nhận đã hoàn tiền trước khi hủy.');
  const next = { ...original, status: 'cancelled', cancelReason: why, cancelledAt: now, cancelledBy: actor.id, cancelledByEmail: actor.email, refundConfirmed: original.status === 'paid', refundAmount: original.status === 'paid' ? orderTotal(original) : 0 };
  const orders = data.orders.map(o => (o.id === id ? next : o));
  const closings = data.closings.map(c => {
    if (c.day !== original.day || c.shift !== original.shift) return c;
    const r = reportTotals(orders.filter(o => o.day === c.day && o.shift === c.shift), [c]);
    return { ...c, originalRevenue: c.originalRevenue ?? c.revenue, revenue: r.revenue, count: r.paid };
  });
  return { next: { ...data, orders, closings }, order: next };
}

export function openShift(data, ctx, input) {
  const { access, actor } = ctx, day = input.day, shift = Number(input.shift);
  if (![1, 2, 3].includes(shift) || !canShift(access, day, shift)) fail('Không có quyền thao tác trên ca này.');
  if ((data.closings || []).some(c => c.day === day && c.shift === shift)) fail('Ca đã kết, không thể thay đổi giờ mở ca.');
  const staffId = isAdmin(access) && input.staffId ? input.staffId : actor.id;
  const staff = (access.members || []).find(m => m.user_id === staffId);
  const initialCash = Math.max(0, Number(input.initialCash) || 0);
  const op = {
    day, shift, openedAt: input.openedAt, openedBy: actor.id, openedByEmail: actor.email, staffId,
    staffEmail: staff?.email || actor.email, staffName: staff?.display_name || staff?.email || actor.email, initialCash, note: clean(input.note, 300),
  };
  const openings = (data.openings || []).filter(o => !(o.day === day && o.shift === shift));
  return { next: { ...data, openings: [...openings, op] }, opening: op };
}

export function closeShift(data, ctx, input) {
  const { access, actor, today } = ctx, shift = Number(input.shift);
  if (![1, 2, 3].includes(shift) || !canShift(access, today, shift)) fail('Không có quyền kết ca này.');
  const list = data.orders.filter(o => o.day === today && o.shift === shift);
  if (list.some(o => o.status === 'open')) fail('Còn đơn chưa thanh toán. Vui lòng thanh toán hoặc hủy trước khi kết ca.');
  if (data.closings.some(c => c.day === today && c.shift === shift)) fail('Ca này đã được kết.');
  const r = reportTotals(list, []);
  const actualCash = input.actualCash === '' || input.actualCash == null ? NaN : Number(input.actualCash);
  const note = clean(input.note, 300);
  if (!Number.isFinite(actualCash) || actualCash < 0) fail('Nhập tiền mặt thực đếm hợp lệ.');
  if (actualCash !== r.cash && note.length < 3) fail('Nhập ghi chú cho chênh lệch tiền mặt.');
  const op = (data.openings || []).find(o => o.day === today && o.shift === shift);
  if (closesBeforeOpen(op?.openedAt, input.at)) fail('Thời gian kết ca không được trước thời gian mở ca.');
  const closeStaff = isAdmin(access) && input.staffId ? (access.members || []).find(m => m.user_id === input.staffId) : null;
  const c = {
    day: today, shift, at: input.at, openedAt: op?.openedAt || null, openedBy: op?.openedBy || null, openedByEmail: op?.openedByEmail || null,
    initialCash: op?.initialCash || 0, closedForId: closeStaff?.user_id || op?.staffId || null, closedForEmail: closeStaff?.email || op?.staffEmail || null,
    closedForName: closeStaff?.display_name || op?.staffName || null, revenue: r.revenue, count: r.paid, actualCash, expectedCash: r.cash,
    discrepancy: actualCash - r.cash, note, closedBy: actor.id, closedByEmail: actor.email, adjustments: [],
  };
  return { next: { ...data, closings: [...data.closings, c] }, closing: c };
}

/** Admin only: add or edit a menu item. Staff send a proposal through pos_manage instead. */
export function menuItem(data, ctx, input) {
  const name = clean(input.name, 100), price = Number(input.price), category = clean(input.category, 60);
  if (!name || !Number.isFinite(price) || price < 1000 || price > 10000000 || !category) fail('Kiểm tra tên, giá (1.000–10.000.000) và nhóm món.');
  if (data.menu.some(m => m.id !== input.id && normalize(m.name) === normalize(name))) fail('Tên món này đã có trong thực đơn.');
  const item = { id: input.id || ctx.uuid(), name, price, category };
  return { item, next: isAdmin(ctx.access) ? { ...data, menu: input.id ? data.menu.map(m => (m.id === item.id ? item : m)) : [...data.menu, item] } : null };
}
