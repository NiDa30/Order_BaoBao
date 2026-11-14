// Plain HTML pages for the Lite version (works without JavaScript, e.g. Opera Mini Extreme mode).
import { isAdmin, canShift, reportTotals, paymentTotals, orderTotal, periodRange } from '../permissions.js';
import { orderVersion } from './actions.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const money = n => new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0)) + ' ₫';
const vnParts = iso => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(p => [p.type, p.value]));
export const timeVN = iso => { if (!iso) return '—'; const p = vnParts(iso); return `${p.hour}:${p.minute} ${p.day}/${p.month}`; };
export const fullVN = iso => { if (!iso) return '—'; const p = vnParts(iso); return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`; };
export const localInput = iso => { const p = vnParts(iso); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
export const dayVN = day => String(day || '').split('-').reverse().join('/');
const statusText = o => (o.status === 'cancelled' ? 'Đã hủy' : o.status === 'paid' ? 'Đã thanh toán' : 'Đang phục vụ');
const payText = m => (m === 'cash' ? 'Tiền mặt' : m === 'transfer' ? 'Chuyển khoản' : 'Chưa ghi nhận phương thức');
const link = (p, params = {}) => '/lite?' + new URLSearchParams({ p, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null)) }).toString();
export const url = link;
const hidden = (name, value) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
const form = (ctx, action, body, { cls = '' } = {}) => `<form method="post" action="/lite" class="${cls}">${hidden('t', ctx.csrf)}${hidden('a', action)}${body}</form>`;
const memberName = (access, id) => { const m = (access?.members || []).find(x => x.user_id === id); return m?.display_name || m?.email || ''; };
const staffOptions = (access, selected, { includeSelf, actor } = {}) =>
  (access?.members || []).filter(m => m.active).map(m => `<option value="${esc(m.user_id)}" ${m.user_id === selected ? 'selected' : ''}>${esc(m.display_name || m.email)}${includeSelf && m.user_id === actor?.id ? ' (tôi)' : ''} · ${m.role === 'admin' ? 'Admin' : 'Nhân viên'}</option>`).join('');

const CSS = `body{margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#21362c;background:#f7f8f4}
a{color:#245344}h1{font-size:20px;margin:10px 0}h2{font-size:17px;margin:16px 0 8px}h3{font-size:15px;margin:10px 0 6px}
.top{background:#245344;color:#fff;padding:8px 10px}.top a{color:#fff}.top b{font-size:16px}.who{font-size:12px;opacity:.85}
.nav{background:#e9eee4;padding:6px 8px;line-height:2}.nav a{margin-right:10px;white-space:nowrap}.nav a.on{font-weight:bold;color:#000}
.wrap{padding:8px 10px;max-width:760px}.box{background:#fff;border:1px solid #dfe5d8;border-radius:6px;padding:10px;margin:8px 0}
.flash{padding:8px 10px;margin:8px 0;border-radius:6px;background:#def0e3;border:1px solid #9fcdae}.flash.err{background:#fcf0dc;border-color:#e3c27d}
.muted{color:#6d7c6e;font-size:13px}.warn{background:#fcf0dc;padding:8px;border-radius:6px}.note{background:#f1f4e9;padding:8px;border-radius:6px}
label{display:block;margin:8px 0 4px;font-size:13px;color:#4c5d4f}input,select,textarea{font-size:15px;padding:6px;max-width:100%;box-sizing:border-box}
input[type=text],input[type=email],input[type=password],input[type=number],input[type=date],input[type=datetime-local],select,textarea{width:100%}
.qty{width:70px!important}.price{width:110px!important}.row{border-bottom:1px dashed #dfe5d8;padding:6px 0}.right{float:right}
.btn,button{display:inline-block;background:#245344;color:#fff;border:0;border-radius:6px;padding:9px 14px;font-size:15px;margin:6px 4px 6px 0;text-decoration:none}
.btn2{display:inline-block;background:#fff;color:#245344;border:1px solid #245344;border-radius:6px;padding:7px 12px;text-decoration:none;margin:4px 4px 4px 0;font-size:14px}
.danger{background:#a43b2a}.tag{font-size:12px;background:#e8ece3;padding:2px 6px;border-radius:4px}.tag.ok{background:#def0e3;color:#2c7446}
.total{font-size:20px;font-weight:bold}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e4e8df;padding:5px 3px;text-align:left;font-size:14px;vertical-align:top}
pre{white-space:pre-wrap;word-break:break-all;font-size:12px;background:#f4f6ef;padding:6px}.receipt{font-family:"Courier New",monospace;white-space:pre;font-size:12px;background:#fff;border:1px solid #ccc;padding:8px;overflow:auto}
.inline{display:inline}`;

export function page(ctx, { title, active = '', body }) {
  const access = ctx.access, admin = isAdmin(access);
  const nav = access
    ? [['home', 'Quầy'], ['history', 'Lịch sử'], ['menu', 'Thực đơn'], ['shifts', 'Ca'], ['revenue', 'Doanh thu'], ...(admin ? [['team', 'Nhân viên'], ['audit', 'Nhật ký'], ['exports', 'Xuất dữ liệu']] : []), ['account', 'Tài khoản']]
        .map(([p, t]) => `<a href="${link(p)}" class="${active === p ? 'on' : ''}">${t}</a>`).join(' ')
    : '';
  const flash = ctx.flash ? `<div class="flash ${ctx.flash.error ? 'err' : ''}">${esc(ctx.flash.text)}</div>` : '';
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · Lam An Lite</title><style>${CSS}</style></head><body>
<div class="top"><b>Lam An</b> · Lite${access ? `<div class="who">${esc(memberName(access, access.userId) || access.email)} · ${admin ? 'Admin' : 'Nhân viên'}</div>` : ''}</div>
${nav ? `<div class="nav">${nav}</div>` : ''}<div class="wrap">${flash}${body}
<p class="muted">Bản Lite cho trình duyệt nhẹ (Opera Mini). <a href="/">Mở bản đầy đủ</a></p></div></body></html>`;
}

export function loginPage(ctx, { email = '', error = '' } = {}) {
  return page(ctx, { title: 'Đăng nhập', body: `<h1>Đăng nhập</h1>${error ? `<div class="flash err">${esc(error)}</div>` : ''}
${form(ctx, 'login', `<label>Email<input type="email" name="email" required value="${esc(email)}" autocomplete="username"></label>
<label>Mật khẩu<input type="password" name="password" required autocomplete="current-password"></label><button type="submit">Đăng nhập</button>`)}
<p class="muted">Dùng tài khoản do quản lý quán cấp. Bản Lite không cần JavaScript, phù hợp Opera Mini; mọi thao tác cần có mạng.</p>` });
}

export function noAccessPage(ctx, message) {
  return page(ctx, { title: 'Chưa được cấp quyền', body: `<h1>Tài khoản chưa được cấp quyền</h1><p>${esc(message || 'Nhờ admin thêm bạn vào quán và phân ca làm việc.')}</p>
<a class="btn2" href="${link('home')}">Thử lại</a>${form(ctx, 'logout', '<button type="submit" class="danger">Đăng xuất</button>')}` });
}

const allowedShifts = (access, day) => [1, 2, 3].filter(s => canShift(access, day, s));

export function homePage(ctx, shift) {
  const { data, access, today } = ctx;
  const shifts = allowedShifts(access, today);
  if (!shifts.length) return page(ctx, { title: 'Quầy', active: 'home', body: `<h1>Chưa có ca hôm nay</h1><p>Liên hệ admin để được phân ca trước khi tạo đơn.</p>${(access.assignments || []).map(a => `<div>${dayVN(a.day)} · Ca ${a.shift}</div>`).join('') || '<p class="muted">Chưa có lịch làm việc.</p>'}` });
  const list = data.orders.filter(o => o.day === today && o.shift === shift);
  const paid = list.filter(o => o.status === 'paid'), open = list.filter(o => o.status === 'open');
  const closed = (data.closings || []).find(c => c.day === today && c.shift === shift), op = (data.openings || []).find(o => o.day === today && o.shift === shift);
  return page(ctx, { title: 'Quầy bán hàng', active: 'home', body: `<h1>Quầy bán hàng · ${dayVN(today)}</h1>
<div>${shifts.map(s => (s === shift ? `<b class="btn2">Ca ${s}</b>` : `<a class="btn2" href="${link('home', { s })}">Ca ${s}</a>`)).join(' ')}</div>
<p>${closed ? '<span class="tag">Ca đã kết thúc</span>' : op ? `<span class="tag ok">Ca đang mở từ ${timeVN(op.openedAt)}</span>` : '<span class="tag">Ca chưa mở</span>'} <a href="${link('shifts')}">Quản lý ca</a></p>
<div class="box">Doanh thu ca: <b>${money(paid.reduce((s, o) => s + orderTotal(o), 0))}</b><br>${list.length} đơn · ${paid.length} đã thanh toán · ${open.length} đang phục vụ (${money(open.reduce((s, o) => s + orderTotal(o), 0))})</div>
${closed ? '' : `<a class="btn" href="${link('new', { s: shift })}">＋ Tạo đơn mới</a>`}
<h2>Đơn trong ca ${shift} (${list.length})</h2>${[...list].reverse().map(orderRow).join('') || '<p class="muted">Chưa có đơn nào trong ca.</p>'}` });
}
const orderRow = o => `<div class="row"><a href="${link('order', { id: o.id })}"><b>${esc(o.label)}</b></a> <span class="tag ${o.status === 'paid' ? 'ok' : ''}">${statusText(o)}</span><span class="right"><b>${money(orderTotal(o))}</b></span><br>
<span class="muted">#${esc(o.code)} · ${dayVN(o.day)} ca ${o.shift} · ${timeVN(o.created)}</span><br><span class="muted">${esc(o.items.map(i => `${i.qty} ${i.name}`).join(', '))}</span></div>`;

/** values: {table, customer, note, qty:{id:n}, price:{id:n}, editReason, settlementMethod, settlementConfirmed} */
export function orderFormPage(ctx, { order = null, shift, values = {}, error = '', delta = 0 }) {
  const { data } = ctx, edit = !!order;
  const v = { table: order?.table ?? '1', customer: order?.customer ?? '', note: order?.note ?? '', ...values };
  const qtyOf = id => (values.qty ? values.qty[id] ?? '' : order?.items.find(i => i.id === id)?.qty ?? '');
  const existing = order ? order.items : [];
  const cats = [...new Set(data.menu.map(m => m.category))];
  const lines = existing.map(i => `<div class="row"><b>${esc(i.name)}</b><br>SL <input class="qty" type="number" min="0" max="999" name="q_${esc(i.id)}" value="${esc(qtyOf(i.id))}"> × Đơn giá <input class="price" type="number" min="1000" max="10000000" step="1000" name="pr_${esc(i.id)}" value="${esc(values.price?.[i.id] ?? i.price)}"> ₫</div>`).join('');
  const menu = cats.map(c => `<h3 id="c${cats.indexOf(c)}">${esc(c)}</h3><table>${data.menu.filter(m => m.category === c && !existing.some(i => i.id === m.id)).map(m => `<tr><td><label for="q_${esc(m.id)}" style="margin:0;font-size:15px;color:#21362c">${esc(m.name)}</label><span class="muted">${money(m.price)}</span></td><td style="width:80px;text-align:right"><input class="qty" id="q_${esc(m.id)}" type="number" min="0" max="999" name="q_${esc(m.id)}" value="${esc(qtyOf(m.id))}" placeholder="0"></td></tr>`).join('')}</table>`).join('');
  const paidEdit = order?.status === 'paid'
    ? `<div class="box"><label>Lý do sửa đơn đã thanh toán (bắt buộc)<input type="text" name="editReason" maxlength="300" value="${esc(v.editReason || '')}"></label>
${delta ? `<p class="warn">${delta > 0 ? 'Cần thu thêm' : 'Cần hoàn lại'}: <b>${money(Math.abs(delta))}</b></p>` : '<p class="muted">Nếu tổng tiền thay đổi, cần xác nhận đã thu thêm/hoàn lại chênh lệch.</p>'}
<label>Phương thức xử lý chênh lệch<select name="settlementMethod"><option value="cash">Tiền mặt</option><option value="transfer" ${v.settlementMethod === 'transfer' ? 'selected' : ''}>Chuyển khoản</option></select></label>
<label><input type="checkbox" name="settlementConfirmed" value="1"> Đã thu thêm / hoàn lại đủ tiền chênh lệch</label></div>`
    : '';
  return page(ctx, { title: edit ? 'Sửa đơn' : 'Tạo đơn', active: 'home', body: `<h1>${edit ? `Sửa đơn #${esc(order.code)}` : `Tạo đơn mới · Ca ${shift}`}</h1>${error ? `<div class="flash err">${esc(error)}</div>` : ''}
${form(ctx, edit ? 'order-edit' : 'order-create', `${edit ? hidden('id', order.id) + hidden('v', orderVersion(order)) : hidden('s', shift)}
<label>Bàn / Số order (1–15 hoặc tên tùy ý)<input type="text" name="table" maxlength="60" value="${esc(v.table)}"></label>
<label>Tên khách hàng (không bắt buộc)<input type="text" name="customer" maxlength="100" value="${esc(v.customer)}"></label>
<label>Ghi chú<input type="text" name="note" maxlength="300" value="${esc(v.note)}" placeholder="Ít đá, ít đường…"></label>
${edit ? `<h2>Món trong đơn</h2>${lines}<p class="muted">Đặt số lượng 0 để bỏ món.</p><h2>Thêm món</h2>` : `<h2>Chọn món (nhập số lượng)</h2><p class="muted">Nhóm: ${cats.map((c, i) => `<a href="#c${i}">${esc(c)}</a>`).join(' · ')}</p>`}
${menu}${paidEdit}<button type="submit">${edit ? 'Lưu thay đổi' : 'Lưu đơn hàng'}</button>`)}
<a class="btn2" href="${edit ? link('order', { id: order.id }) : link('home', { s: shift })}">Hủy bỏ</a>
${edit ? '' : `<p class="muted">Món chưa có trong thực đơn? <a href="${link('menu')}">Thực đơn</a></p>`}` });
}

export function orderPage(ctx, o) {
  const admin = isAdmin(ctx.access);
  const pay = o.status === 'open'
    ? form(ctx, 'order-pay', `${hidden('id', o.id)}<h2>Thanh toán ${money(orderTotal(o))}</h2>
<label><input type="radio" name="method" value="cash" checked> Tiền mặt (nhận đủ tiền trước khi xác nhận)</label>
<label><input type="radio" name="method" value="transfer"> Chuyển khoản (kiểm tra đã nhận tiền thực tế)</label>
<p class="muted">Nội dung chuyển khoản: <b>LAM AN ${esc(o.code)}</b> · <a href="/payment-qr.svg">Xem QR (mẫu minh họa, chưa nhận tiền)</a></p>
<button type="submit">✓ Xác nhận đã thanh toán</button>`, { cls: 'box' })
    : o.status === 'paid'
      ? `<div class="box">Phương thức: <b>${payText(o.paymentMethod)}</b><br><span class="muted">Thanh toán lúc ${fullVN(o.paidAt)}${o.paidByEmail ? ` · ${esc(o.paidByEmail)}` : ''}</span>${(() => { const p = paymentTotals(o); return p.cash && p.transfer ? `<br>Tiền mặt ${money(p.cash)} · Chuyển khoản ${money(p.transfer)}` : ''; })()}</div>`
      : '';
  return page(ctx, { title: o.label, active: 'home', body: `<h1>${esc(o.label)}</h1><p class="muted">#${esc(o.code)} · ${dayVN(o.day)} · Ca ${o.shift} · <span class="tag ${o.status === 'paid' ? 'ok' : ''}">${statusText(o)}</span></p>
<div class="box"><table>${o.items.map(i => `<tr><td>${i.qty} × ${esc(i.name)}<br><span class="muted">${money(i.price)} / món</span></td><td style="text-align:right">${money(i.qty * i.price)}</td></tr>`).join('')}
<tr><td><b>${o.status === 'cancelled' ? 'Giá trị đơn đã hủy' : 'Tổng thanh toán'}</b></td><td style="text-align:right" class="total">${money(orderTotal(o))}</td></tr></table></div>
<p class="muted">Bàn: ${esc(o.table || '—')}${o.customer ? ` · Khách: ${esc(o.customer)}` : ''}<br>Tạo bởi: ${esc(o.createdByEmail || 'Dữ liệu cũ')} · ${fullVN(o.created)}${o.updatedByEmail ? `<br>Sửa gần nhất: ${esc(o.updatedByEmail)} · ${fullVN(o.updatedAt)}` : ''}</p>
${o.note ? `<p class="note">Ghi chú: ${esc(o.note)}</p>` : ''}${o.cancelReason ? `<p class="warn">Lý do hủy: ${esc(o.cancelReason)}${o.refundConfirmed ? '<br>Đã ghi nhận hoàn tiền theo phương thức đã thu.' : ''}</p>` : ''}
${pay}
${o.status !== 'cancelled' ? `<a class="btn2" href="${link('bill', { id: o.id })}">🖨 ${o.status === 'paid' ? 'In bill' : 'In phiếu tạm tính'}</a> <a class="btn2" href="${link('edit', { id: o.id })}">✎ Sửa đơn</a>${o.status === 'open' || admin ? ` <a class="btn2" href="${link('cancel', { id: o.id })}">Hủy đơn</a>` : ''}` : ''}
${o.revisions?.length ? `<h2>Lịch sử chỉnh sửa (${o.revisions.length})</h2>${[...o.revisions].reverse().map(r => `<div class="row"><b>${esc(r.actorEmail || 'Dữ liệu cũ')}</b> · ${fullVN(r.at)}<br>${esc(r.reason || 'Chỉnh sửa thông tin')} · Trước sửa: ${money(orderTotal(r.before))}</div>`).join('')}` : ''}
<p><a href="${link('home', { s: o.shift })}">← Về quầy</a></p>` });
}

export function cancelPage(ctx, o, error = '') {
  return page(ctx, { title: 'Hủy đơn', active: 'home', body: `<h1>Hủy đơn ${esc(o.label)}</h1>${error ? `<div class="flash err">${esc(error)}</div>` : ''}<p class="muted">Đơn và lịch sử vẫn được giữ lại. Đơn hủy được loại khỏi doanh thu.</p>
${form(ctx, 'order-cancel', `${hidden('id', o.id)}<label>Lý do hủy<input type="text" name="reason" required maxlength="300"></label>
${o.status === 'paid' ? `<p class="warn">Cần hoàn ${money(orderTotal(o))} theo các phương thức đã thu.</p><label><input type="checkbox" name="refund" value="1"> Đã hoàn đủ tiền cho khách</label>` : ''}
<button type="submit" class="danger">Xác nhận hủy đơn</button>`)}<a class="btn2" href="${link('order', { id: o.id })}">Quay lại</a>` });
}

export function billPage(ctx, o, { lines, rawbtText, appLink, apk, paper, copies }) {
  const buttons = ctx.inApp
    ? `<a class="btn" href="${esc(appLink)}">🖨 In bằng máy in tích hợp</a><p class="muted">In có dấu tiếng Việt qua ứng dụng Lam An POS. Khổ ${paper}mm · ${copies} liên · <a href="${link('account')}">Đổi cài đặt in</a></p>`
    : `<a class="btn" href="${esc(rawbtText)}">🖨 In qua RawBT</a>
<p class="muted">Gửi lệnh in tới ứng dụng RawBT (máy in tích hợp của máy POS, Bluetooth, USB). Bản Lite in chữ không dấu để chạy được không cần JavaScript; muốn in có dấu, dùng bản đầy đủ trên Chrome. Khổ ${paper}mm · ${copies} liên · <a href="${link('account')}">Đổi cài đặt in</a></p>
${ctx.android ? `<p class="note">Máy POS không cài được RawBT (ví dụ SUNMI T1)? <a href="${esc(apk)}">Tải ứng dụng Lam An POS</a> để in thẳng bằng máy in tích hợp, có dấu.</p>` : ''}`;
  return page(ctx, { title: 'In bill', active: 'home', body: `<h1>${o.status === 'paid' ? 'Bill' : 'Phiếu tạm tính'} #${esc(o.code)}</h1>
${buttons}
<div class="receipt">${esc(lines.map(l => l.text).join('\n'))}</div>
<p><a href="${link('order', { id: o.id })}">← Về đơn</a></p>` });
}

export function historyPage(ctx, f) {
  const { data } = ctx, norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
  const list = data.orders.filter(o => (!f.d || o.day === f.d) && (!f.s || o.shift === Number(f.s)) && norm(`${o.label} ${o.code} ${o.items.map(i => i.name).join(' ')}`).includes(norm(f.q || ''))).sort((a, b) => b.created.localeCompare(a.created));
  return page(ctx, { title: 'Lịch sử đơn', active: 'history', body: `<h1>Lịch sử đơn hàng</h1>
<form method="get" action="/lite" class="box">${hidden('p', 'history')}<label>Tìm khách, số đơn, món<input type="text" name="q" value="${esc(f.q || '')}"></label>
<label>Ngày<input type="date" name="d" value="${esc(f.d || '')}"></label><label>Ca<select name="s"><option value="">Tất cả ca</option>${[1, 2, 3].map(s => `<option value="${s}" ${String(f.s) === String(s) ? 'selected' : ''}>Ca ${s}</option>`).join('')}</select></label><button type="submit">Lọc</button></form>
<p>${list.length} đơn · Đã thanh toán: <b>${money(list.filter(o => o.status === 'paid').reduce((s, o) => s + orderTotal(o), 0))}</b></p>${list.slice(0, 200).map(orderRow).join('') || '<p class="muted">Chưa có đơn hàng phù hợp.</p>'}${list.length > 200 ? '<p class="muted">Hiển thị 200 đơn mới nhất; lọc theo ngày để xem thêm.</p>' : ''}` });
}

export function menuPage(ctx, { editId = '', values = null, error = '' } = {}) {
  const { data, access } = ctx, admin = isAdmin(access), cats = [...new Set(data.menu.map(m => m.category))];
  const editing = data.menu.find(m => m.id === editId) || null, v = values || editing || {};
  const proposals = access.proposals || [];
  return page(ctx, { title: 'Thực đơn', active: 'menu', body: `<h1>Thực đơn</h1>
${form(ctx, 'menu-save', `<h2>${admin ? (editing ? 'Sửa món' : 'Thêm món mới') : editing ? 'Đề xuất sửa món' : 'Đề xuất thêm món'}</h2>${error ? `<div class="flash err">${esc(error)}</div>` : ''}${editing ? hidden('id', editing.id) : ''}
<label>Tên món<input type="text" name="name" required maxlength="100" value="${esc(v.name || '')}"></label><label>Giá bán (VNĐ)<input type="number" name="price" required min="1000" max="10000000" step="1000" value="${esc(v.price || '')}"></label>
<label>Nhóm món<select name="category">${cats.map(c => `<option ${v.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
${admin ? '' : `<label>Lý do đề xuất<input type="text" name="reason" required maxlength="300" value="${esc(values?.reason || '')}"></label>`}
<button type="submit">${admin ? (editing ? 'Lưu thay đổi' : 'Thêm vào thực đơn') : 'Gửi đề xuất'}</button>${editing ? ` <a class="btn2" href="${link('menu')}">Bỏ sửa</a>` : ''}`, { cls: 'box' })}
${admin ? '' : '<p class="muted">Admin duyệt đề xuất trước khi cập nhật thực đơn dùng chung.</p>'}
${cats.map(c => `<h2>${esc(c)}</h2>${data.menu.filter(m => m.category === c).map(m => `<div class="row">${esc(m.name)} <span class="right">${money(m.price)} · <a href="${link('menu', { edit: m.id })}">${admin ? 'Sửa' : 'Đề xuất sửa'}</a></span></div>`).join('')}`).join('')}
<h2>${admin ? 'Đề xuất cần duyệt' : 'Đề xuất của bạn'}</h2>${proposals.map(p => `<div class="row"><b>${esc(p.payload?.name)} · ${money(p.payload?.price)}</b> <span class="tag">${{ pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' }[p.status] || esc(p.status)}</span><br><span class="muted">${esc(p.email)} · ${esc(p.reason)}</span>
${admin && p.status === 'pending' ? `${form(ctx, 'proposal-review', `${hidden('id', p.id)}${hidden('decision', 'approved')}<button type="submit">Duyệt</button>`, { cls: 'inline' })} ${form(ctx, 'proposal-review', `${hidden('id', p.id)}${hidden('decision', 'rejected')}<button type="submit" class="danger">Từ chối</button>`, { cls: 'inline' })}` : ''}</div>`).join('') || '<p class="muted">Chưa có đề xuất.</p>'}` });
}

export function shiftsPage(ctx, f) {
  const { data, access, today } = ctx, admin = isAdmin(access);
  const dayOrders = data.orders.filter(o => o.day === today), dayClosings = (data.closings || []).filter(c => c.day === today), r = reportTotals(dayOrders, dayClosings);
  const cards = allowedShifts(access, today).map(n => {
    const list = dayOrders.filter(o => o.shift === n), c = dayClosings.find(x => x.shift === n), op = (data.openings || []).find(o => o.day === today && o.shift === n);
    const rr = reportTotals(list, c ? [c] : []), assigned = (access.assignments || []).filter(a => a.day === today && Number(a.shift) === n).map(a => memberName(access, a.user_id)).filter(Boolean).join(', ');
    return `<div class="box"><h2>Ca ${n} <span class="tag ${c ? 'ok' : ''}">${c ? 'Đã kết ca' : op ? 'Đang mở' : 'Chưa mở'}</span></h2>Phụ trách: <b>${esc(assigned || op?.staffName || 'Chưa phân công')}</b><br>
<span class="total">${money(rr.revenue)}</span><br>${list.length} đơn · ${list.filter(o => o.status === 'open').length} chưa thanh toán<br>
${c ? `<p class="muted">${c.openedAt ? `Mở ${timeVN(c.openedAt)} · ` : ''}Kết ${timeVN(c.at)} · ${esc(c.closedByEmail || 'Dữ liệu cũ')}${c.closedForEmail && c.closedForEmail !== c.closedByEmail ? ` · thay cho ${esc(c.closedForEmail)}` : ''}<br>Doanh thu đã chốt ${money(c.revenue)}${c.originalRevenue !== undefined ? ` (gốc ${money(c.originalRevenue)})` : ''}<br>Tiền mặt thực đếm ${c.actualCash == null ? 'Chưa đối chiếu' : money(c.actualCash)} · Chênh lệch ${c.discrepancy == null ? '—' : money(c.discrepancy)}</p>${admin ? `<a class="btn2" href="${link('shift-adjust', { d: today, s: n })}">Điều chỉnh ca</a>` : ''}`
      : op ? `<p class="muted">Mở lúc ${timeVN(op.openedAt)} · ${esc(op.openedByEmail || '')}${op.staffEmail && op.staffEmail !== op.openedByEmail ? ` · thay cho ${esc(op.staffEmail)}` : ''}${op.initialCash ? `<br>Tiền mặt đầu ca ${money(op.initialCash)}` : ''}${op.note ? `<br>Ghi chú: ${esc(op.note)}` : ''}</p><a class="btn" href="${link('shift-close', { s: n })}">Kết ca ${n}</a> <a class="btn2" href="${link('shift-open', { s: n })}">Chỉnh giờ mở ca</a>`
      : `<a class="btn" href="${link('shift-open', { s: n })}">Mở ca ${n}</a> <a class="btn2" href="${link('shift-close', { s: n })}">Kết ca ${n}</a>${admin ? ` <a class="btn2" href="${link('assign', { s: n })}">Phân công</a>` : ''}`}</div>`;
  }).join('') || '<p class="note">Chưa có ca được phân công hôm nay.</p>';
  const key = x => `${x.day}:${x.shift}`, rows = new Map();
  for (const op of data.openings || []) rows.set(key(op), { day: op.day, shift: op.shift, op });
  for (const c of data.closings || []) rows.set(key(c), { ...(rows.get(key(c)) || { day: c.day, shift: c.shift }), c });
  const log = [...rows.values()].map(x => ({ ...x, staffId: x.op?.staffId || x.c?.closedForId || '', staffName: x.op?.staffName || x.c?.closedForName || x.c?.closedForEmail || 'Chưa rõ nhân viên', openedAt: x.op?.openedAt || x.c?.openedAt || null }))
    .filter(x => (!f.staff || x.staffId === f.staff) && (!f.d || x.day === f.d)).sort((a, b) => b.day.localeCompare(a.day) || b.shift - a.shift).slice(0, 100);
  return page(ctx, { title: 'Quản lý ca', active: 'shifts', body: `<h1>Quản lý ca · ${dayVN(today)}</h1><div class="box">${admin ? 'Tổng doanh thu hôm nay' : 'Doanh thu các ca được phân công'}: <span class="total">${money(r.revenue)}</span><br>${dayOrders.length} đơn · ${r.cancelled} đơn hủy</div>${cards}
<h2>Lịch sử mở / kết ca</h2><form method="get" action="/lite">${hidden('p', 'shifts')}${admin ? `<label>Nhân viên<select name="staff"><option value="">Tất cả</option>${(access.members || []).map(m => `<option value="${esc(m.user_id)}" ${f.staff === m.user_id ? 'selected' : ''}>${esc(m.display_name || m.email)}</option>`).join('')}</select></label>` : ''}<label>Ngày<input type="date" name="d" value="${esc(f.d || '')}"></label><button type="submit">Lọc</button></form>
${log.map(x => `<div class="row"><b>Ca ${x.shift} · ${dayVN(x.day)}</b> · ${esc(x.staffName)} <span class="right">${x.c ? money(x.c.revenue) : '—'}</span><br><span class="muted">Mở: ${x.openedAt ? timeVN(x.openedAt) : 'Không ghi nhận'} · Kết: ${x.c?.at ? `${timeVN(x.c.at)} · ${esc(x.c.closedByEmail || '')}` : 'Chưa kết ca'}</span>${admin && x.c ? ` <a href="${link('shift-adjust', { d: x.day, s: x.shift })}">Điều chỉnh</a>` : ''}</div>`).join('') || '<p class="muted">Chưa có lịch sử mở / kết ca.</p>'}` });
}

export function shiftOpenPage(ctx, shift, error = '', values = {}) {
  const { data, access, today, actor, now } = ctx, admin = isAdmin(access), existing = (data.openings || []).find(o => o.day === today && o.shift === shift);
  return page(ctx, { title: `Mở ca ${shift}`, active: 'shifts', body: `<h1>${existing ? 'Điều chỉnh giờ mở' : 'Mở'} ca ${shift} · ${dayVN(today)}</h1>${error ? `<div class="flash err">${esc(error)}</div>` : ''}
${form(ctx, 'shift-open', `${hidden('s', shift)}${admin ? `<label>Nhân viên phụ trách ca<select name="staffId">${staffOptions(access, values.staffId || existing?.staffId || actor.id, { includeSelf: true, actor })}</select></label><p class="muted">Admin có thể mở ca thay nhân viên; nếu nhân viên chưa được phân ca, hệ thống tự phân ca.</p>` : ''}
<label>Thời gian mở ca (giờ Việt Nam)<input type="datetime-local" name="at" required value="${esc(values.at || localInput(existing?.openedAt || now))}"></label>
<label>Tiền mặt đầu ca (VNĐ)<input type="number" name="initialCash" min="0" step="1000" value="${esc(values.initialCash ?? existing?.initialCash ?? 0)}"></label>
<label>Ghi chú mở ca<input type="text" name="note" maxlength="300" value="${esc(values.note ?? existing?.note ?? '')}"></label><button type="submit">${existing ? 'Lưu thay đổi thời gian' : 'Xác nhận mở ca'}</button>`)}<a class="btn2" href="${link('shifts')}">Quay lại</a>` });
}

export function shiftClosePage(ctx, shift, error = '', values = {}) {
  const { data, access, today, actor, now } = ctx, admin = isAdmin(access);
  const list = data.orders.filter(o => o.day === today && o.shift === shift), open = list.filter(o => o.status === 'open'), r = reportTotals(list, []);
  const op = (data.openings || []).find(o => o.day === today && o.shift === shift);
  return page(ctx, { title: `Kết ca ${shift}`, active: 'shifts', body: `<h1>Kết ca ${shift} · ${dayVN(today)}</h1>${error ? `<div class="flash err">${esc(error)}</div>` : ''}
<div class="box">Doanh thu ca: <span class="total">${money(r.revenue)}</span><br>${list.length} đơn · ${r.paid} đã thanh toán · ${r.cancelled} hủy</div>
${open.length ? `<p class="warn">Còn ${open.length} đơn chưa thanh toán. Vui lòng thanh toán trước khi kết ca.</p><a class="btn" href="${link('home', { s: shift })}">Xem đơn chưa thanh toán</a>`
    : form(ctx, 'shift-close', `${hidden('s', shift)}${admin ? `<label>Kết ca thay cho<select name="staffId">${staffOptions(access, values.staffId || op?.staffId || actor.id, { includeSelf: true, actor })}</select></label>` : ''}
<label>Thời gian kết ca (giờ Việt Nam)<input type="datetime-local" name="at" required value="${esc(values.at || localInput(now))}"></label>${op?.openedAt ? `<p class="muted">Không được trước giờ mở ca (${timeVN(op.openedAt)}).</p>` : ''}
<p class="note">Tiền mặt hệ thống: ${money(r.cash)}<br>Chuyển khoản: ${money(r.transfer)}${op?.initialCash ? `<br>Tiền mặt đầu ca: ${money(op.initialCash)}` : ''}</p>
<label>Tiền mặt thực đếm (VNĐ)<input type="number" name="actualCash" min="0" step="1000" value="${esc(values.actualCash ?? Math.max(0, r.cash))}"></label>
<label>Ghi chú đối chiếu (bắt buộc nếu tiền mặt chênh lệch)<input type="text" name="note" maxlength="300" value="${esc(values.note || '')}"></label>
<p class="muted">Ca đã kết không nhận đơn mới. Đồng bộ các thiết bị trước khi chốt.</p><button type="submit">Xác nhận kết ca</button>`)}<a class="btn2" href="${link('shifts')}">Quay lại</a>` });
}

export function shiftAdjustPage(ctx, day, shift, error = '') {
  return page(ctx, { title: 'Điều chỉnh ca', active: 'shifts', body: `<h1>Điều chỉnh ca ${shift} · ${dayVN(day)}</h1>${error ? `<div class="flash err">${esc(error)}</div>` : ''}<p class="muted">Giữ báo cáo gốc và lưu người điều chỉnh.</p>
${form(ctx, 'shift-adjust', `${hidden('d', day)}${hidden('s', shift)}<label>Số tiền điều chỉnh (VNĐ, âm để giảm)<input type="number" name="amount" required step="1000"></label>
<label>Phương thức<select name="method"><option value="cash">Tiền mặt</option><option value="transfer">Chuyển khoản</option></select></label><label>Lý do<input type="text" name="reason" required maxlength="300"></label><button type="submit">Lưu điều chỉnh</button>`)}<a class="btn2" href="${link('shifts')}">Quay lại</a>` });
}

export function assignPage(ctx, shift) {
  const { access, today } = ctx;
  return page(ctx, { title: 'Phân công ca', active: 'shifts', body: `<h1>Phân công ca ${shift} · ${dayVN(today)}</h1>${form(ctx, 'assign', `${hidden('d', today)}${hidden('s', shift)}${hidden('back', 'shifts')}<label>Nhân viên<select name="userId">${staffOptions(access, '')}</select></label><button type="submit">Xác nhận phân ca</button>`)}<a class="btn2" href="${link('shifts')}">Quay lại</a>` });
}

export function revenuePage(ctx, f) {
  const { data, access } = ctx, admin = isAdmin(access), period = admin ? f.per || 'day' : 'day', [from, to] = periodRange(f.d, period);
  const ok = o => o.day >= from && o.day <= to && (!f.s || o.shift === Number(f.s));
  const selected = data.orders.filter(ok), closings = (data.closings || []).filter(ok), sums = reportTotals(selected, closings);
  const keys = [...new Set([...selected.map(o => `${o.day}:${o.shift}`), ...closings.map(c => `${c.day}:${c.shift}`)])].sort().reverse();
  return page(ctx, { title: 'Doanh thu', active: 'revenue', body: `<h1>Doanh thu</h1><p class="muted">${admin ? 'Theo dõi ngày, tuần hoặc tháng của cả quán.' : 'Bạn chỉ xem được các ca đã được phân công.'}</p>
<form method="get" action="/lite" class="box">${hidden('p', 'revenue')}<label>Ngày tham chiếu<input type="date" name="d" value="${esc(f.d)}"></label>${admin ? `<label>Xem theo<select name="per">${[['day', 'Ngày'], ['week', 'Tuần'], ['month', 'Tháng']].map(([v, t]) => `<option value="${v}" ${v === period ? 'selected' : ''}>${t}</option>`).join('')}</select></label>` : ''}
<label>Ca<select name="s"><option value="">${admin ? 'Tất cả ca' : 'Các ca được phân công'}</option>${[1, 2, 3].map(s => `<option value="${s}" ${String(f.s) === String(s) ? 'selected' : ''}>Ca ${s}</option>`).join('')}</select></label><button type="submit">Xem</button></form>
<p class="muted">${dayVN(from)} – ${dayVN(to)}</p><div class="box">Doanh thu thuần: <span class="total">${money(sums.revenue)}</span><br>${sums.paid} đơn đã thanh toán · ${sums.cancelled} đơn hủy<br>Tiền mặt: <b>${money(sums.cash)}</b> · Chuyển khoản: <b>${money(sums.transfer)}</b>${sums.unknown ? `<br>${money(sums.unknown)} thuộc đơn cũ chưa ghi nhận phương thức.` : ''}${sums.adjustment ? `<br>Đã bao gồm ${money(sums.adjustment)} điều chỉnh ca.` : ''}</div>
${keys.map(k => { const [day, s] = k.split(':'), r = reportTotals(selected.filter(o => o.day === day && o.shift === Number(s)), closings.filter(c => c.day === day && c.shift === Number(s))); return `<div class="row"><b>${dayVN(day)} · Ca ${s}</b><span class="right"><b>${money(r.revenue)}</b></span><br><span class="muted">${r.paid} đã thu · ${r.cancelled} hủy · Tiền mặt ${money(r.cash)} · Chuyển khoản ${money(r.transfer)}</span></div>`; }).join('') || '<p class="muted">Chưa có dữ liệu trong khoảng đã chọn.</p>'}
${admin ? `<p><a class="btn2" href="${link('download', { type: 'revenue', from, to, shift: f.s })}">↓ Tải CSV doanh thu</a></p>` : ''}` });
}

export function teamPage(ctx, error = '') {
  const { access, today } = ctx;
  return page(ctx, { title: 'Nhân viên', active: 'team', body: `<h1>Nhân viên & phân ca</h1>${error ? `<div class="flash err">${esc(error)}</div>` : ''}
${form(ctx, 'member-add', `<h2>Thêm tài khoản vào quán</h2><label>Hình thức<select name="mode"><option value="existing">Thêm email đã có tài khoản</option><option value="new">Tạo tài khoản mới (cần mật khẩu tạm)</option></select></label>
<label>Họ tên<input type="text" name="name" required maxlength="100"></label><label>Email<input type="email" name="email" required></label><label>Mật khẩu tạm (chỉ khi tạo mới, ít nhất 8 ký tự)<input type="password" name="password" autocomplete="new-password"></label>
<label>Vai trò<select name="role"><option value="staff">Nhân viên</option><option value="admin">Admin</option></select></label><button type="submit">Thêm tài khoản</button>`, { cls: 'box' })}
${form(ctx, 'assign', `<h2>Phân ca theo ngày</h2><label>Nhân viên<select name="userId">${staffOptions(access, '')}</select></label><label>Ngày làm việc<input type="date" name="d" required value="${today}"></label>
<label>Ca<select name="s">${[1, 2, 3].map(s => `<option value="${s}">Ca ${s}</option>`).join('')}</select></label><button type="submit">Phân ca</button>`, { cls: 'box' })}
<h2>Tài khoản trong quán</h2>${(access.members || []).map(m => `<div class="row"><b>${esc(m.display_name || m.email)}</b> <span class="tag ${m.active ? 'ok' : ''}">${m.role === 'admin' ? 'Admin' : 'Nhân viên'} · ${m.active ? 'Hoạt động' : 'Đã khóa'}</span><br><span class="muted">${esc(m.email)}</span><br>
${form(ctx, 'member-update', `${hidden('userId', m.user_id)}${hidden('role', m.role === 'admin' ? 'staff' : 'admin')}<button type="submit" class="btn2">${m.role === 'admin' ? 'Đổi thành nhân viên' : 'Cấp quyền admin'}</button>`, { cls: 'inline' })}
${form(ctx, 'member-update', `${hidden('userId', m.user_id)}${hidden('active', m.active ? 'false' : 'true')}<button type="submit" class="btn2">${m.active ? 'Khóa tài khoản' : 'Mở khóa'}</button>`, { cls: 'inline' })}</div>`).join('')}
<h2>Lịch phân ca</h2>${(access.assignments || []).slice().sort((a, b) => b.day.localeCompare(a.day) || a.shift - b.shift).map(a => `<div class="row">${esc(memberName(access, a.user_id) || a.user_id)} · ${dayVN(a.day)} · Ca ${a.shift} ${form(ctx, 'unassign', `${hidden('userId', a.user_id)}${hidden('d', a.day)}${hidden('s', a.shift)}<button type="submit" class="btn2">Gỡ phân ca</button>`, { cls: 'inline' })}</div>`).join('') || '<p class="muted">Chưa có lịch phân ca.</p>'}` });
}

const AUDIT_NAMES = { 'order.create': 'Tạo đơn', 'order.edit': 'Sửa đơn', 'order.pay': 'Thanh toán', 'order.cancel': 'Hủy đơn', 'shift.close': 'Kết ca', 'shift.adjust': 'Điều chỉnh ca', 'shift.open': 'Mở ca', 'menu.update': 'Cập nhật menu', 'member.add': 'Thêm tài khoản', 'member.update': 'Sửa quyền / khóa tài khoản', 'assignment.set': 'Phân ca', 'proposal.submit': 'Gửi đề xuất', 'proposal.review': 'Duyệt đề xuất', 'shop.bootstrap': 'Khởi tạo quán' };
export function auditPage(ctx, rows, q, show) {
  const list = rows.filter(a => `${a.actor_email} ${AUDIT_NAMES[a.action] || a.action} ${a.reason} ${a.target_id}`.toLowerCase().includes(String(q || '').toLowerCase()));
  const clip = v => { const s = JSON.stringify(v, null, 1) || '—'; return s.length > 3000 ? s.slice(0, 3000) + '…' : s; };
  return page(ctx, { title: 'Nhật ký', active: 'audit', body: `<h1>Nhật ký thao tác</h1><p class="muted">500 thao tác gần nhất, ghi nhận bởi database.</p>
<form method="get" action="/lite">${hidden('p', 'audit')}<label>Tìm tài khoản, thao tác, lý do<input type="text" name="q" value="${esc(q || '')}"></label><button type="submit">Tìm</button></form>
${list.slice(0, 200).map((a, i) => `<div class="row"><b>${esc(AUDIT_NAMES[a.action] || a.action)}</b> · ${esc(a.actor_email || 'Dữ liệu cũ')} · ${fullVN(a.created_at)}<br><span class="muted">${esc(a.reason || '')} · Đối tượng: ${esc(a.target_id || '—')}</span>
${String(show) === String(i) ? `<div>Trước thay đổi<pre>${esc(clip(a.before_data))}</pre>Sau thay đổi<pre>${esc(clip(a.after_data))}</pre></div>` : ` <a href="${link('audit', { q, show: i })}">Xem chi tiết</a>`}</div>`).join('') || '<p class="muted">Chưa có thao tác phù hợp.</p>'}` });
}

export function exportsPage(ctx) {
  const types = [['orders', 'Danh sách đơn CSV'], ['items', 'Chi tiết món CSV'], ['shifts', 'Báo cáo kết ca CSV'], ['revenue', 'Doanh thu CSV'], ['menu', 'Thực đơn CSV'], ['backup', 'Sao lưu POS JSON']];
  return page(ctx, { title: 'Xuất dữ liệu', active: 'exports', body: `<h1>Xuất dữ liệu</h1>
<form method="get" action="/lite" class="box">${hidden('p', 'download')}<label>Loại file<select name="type">${types.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
<label>Từ ngày<input type="date" name="from"></label><label>Đến ngày<input type="date" name="to"></label><label>Ca<select name="shift"><option value="">Tất cả ca</option>${[1, 2, 3].map(s => `<option value="${s}">Ca ${s}</option>`).join('')}</select></label>
<label>Trạng thái đơn<select name="status"><option value="">Tất cả</option><option value="open">Đang phục vụ</option><option value="paid">Đã thanh toán</option><option value="cancelled">Đã hủy</option></select></label><button type="submit">↓ Tải file</button></form>
<p class="muted">Ngày trống lấy tất cả. Dữ liệu lấy trực tiếp từ database. CSV dùng UTF-8 BOM để mở đúng tiếng Việt trong Excel.</p>` });
}

export function accountPage(ctx, print) {
  const { access } = ctx;
  return page(ctx, { title: 'Tài khoản', active: 'account', body: `<h1>Tài khoản</h1><div class="box">${esc(access.email)}<br><span class="muted">${esc(access.shopName || 'Lam An')} · ${isAdmin(access) ? 'Admin' : 'Nhân viên'}</span></div>
${form(ctx, 'print-settings', `<h2>Cài đặt in bill (trên máy này)</h2><label>Khổ giấy<select name="paper"><option value="58" ${print.paper === 58 ? 'selected' : ''}>58mm (32 ký tự)</option><option value="80" ${print.paper === 80 ? 'selected' : ''}>80mm (48 ký tự)</option></select></label>
<label>Số liên<select name="copies">${[1, 2, 3].map(n => `<option ${print.copies === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
<label>Tên quán trên bill<input type="text" name="name" maxlength="60" value="${esc(print.shop.name)}"></label><label>Địa chỉ<input type="text" name="address" maxlength="120" value="${esc(print.shop.address)}"></label>
<label>Số điện thoại<input type="text" name="phone" maxlength="20" value="${esc(print.shop.phone)}"></label><label>Lời chào cuối bill<input type="text" name="footer" maxlength="120" value="${esc(print.shop.footer)}"></label><button type="submit">Lưu cài đặt in</button>`, { cls: 'box' })}
${form(ctx, 'password', `<h2>Đổi mật khẩu</h2><label>Mật khẩu mới (ít nhất 8 ký tự)<input type="password" name="password" required autocomplete="new-password"></label><button type="submit">Lưu mật khẩu</button>`, { cls: 'box' })}
${ctx.inApp ? '<p><a class="btn2" href="lamanpos://settings">Cài đặt ứng ụng (in thử, tải lại)</a></p>' : ''}
${form(ctx, 'logout', '<button type="submit" class="danger">Đăng xuất</button>')}` });
}
