// Bill layout shared by every print path (ESC/POS text, ESC/POS image, browser print).
// Everything is laid out on a fixed character grid so a 58mm and an 80mm roll look the same
// whether the printer receives text or a rendered bitmap.
export const PAPERS = {
  58: { chars: 32, dots: 384, printableMm: 48 },
  80: { chars: 48, dots: 576, printableMm: 72 },
};
export const DEFAULT_SHOP = { name: 'Lam An Coffee', address: '', phone: '', footer: 'Cảm ơn quý khách, hẹn gặp lại!' };
const nf = new Intl.NumberFormat('vi-VN');
export const amount = n => nf.format(Math.round(Number(n) || 0));
const dtf = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
export const dt = iso => {
  const p = Object.fromEntries(dtf.formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
};
const clean = s => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().normalize('NFC');
const len = s => [...s].length;
const pad = (s, w, align = 'left') => {
  const gap = Math.max(0, w - len(s));
  if (align === 'right') return ' '.repeat(gap) + s;
  if (align === 'center') return ' '.repeat(Math.floor(gap / 2)) + s + ' '.repeat(Math.ceil(gap / 2));
  return s + ' '.repeat(gap);
};
export function wrap(text, width) {
  const out = [];
  let line = '';
  for (let word of clean(text).split(' ')) {
    if (!word) continue;
    while (len(word) > width) {
      if (line) { out.push(line); line = ''; }
      out.push([...word].slice(0, width).join(''));
      word = [...word].slice(width).join('');
    }
    if (!line) line = word;
    else if (len(line) + 1 + len(word) <= width) line += ' ' + word;
    else { out.push(line); line = word; }
  }
  if (line || !out.length) out.push(line);
  return out;
}
// size: 1 = normal, 'tall' = double height, 'big' = double width + height.
const widthFor = (chars, size) => (size === 'big' ? Math.floor(chars / 2) : chars);

/** Lay out blocks into fixed-width lines: [{text, bold, size}] with alignment already applied. */
export function layout(blocks, chars) {
  const lines = [];
  const push = (text, { bold = false, size = 1, align = 'left' } = {}) =>
    lines.push({ text: pad(text, widthFor(chars, size), align), bold, size });
  for (const b of blocks) {
    const w = widthFor(chars, b.size);
    if (b.t === 'text') for (const l of wrap(b.text, w)) push(l, b);
    else if (b.t === 'line') push((b.ch || '-').repeat(chars));
    else if (b.t === 'feed') for (let i = 0; i < (b.n || 1); i++) push('');
    else if (b.t === 'row') {
      const right = clean(b.right), left = wrap(b.left, Math.max(1, w - len(right) - 1));
      const last = left.pop();
      for (const l of left) push(l, b);
      if (len(last) + 1 + len(right) <= w) push(last + ' '.repeat(w - len(last) - len(right)) + right, b);
      else { push(last, b); push(right, { ...b, align: 'right' }); }
    } else if (b.t === 'item-head') {
      push(chars >= 48 ? pad('Món', chars - 24) + pad('SL', 4, 'right') + pad('Đ.giá', 10, 'right') + pad('T.tiền', 10, 'right') : pad('Món', chars - 10) + pad('T.tiền', 10, 'right'), { bold: true });
    } else if (b.t === 'item') {
      const total = amount(b.qty * b.price);
      if (chars >= 48) {
        const name = wrap(b.name, chars - 25);
        push(pad(name[0], chars - 24) + pad(String(b.qty), 4, 'right') + pad(amount(b.price), 10, 'right') + pad(total, 10, 'right'));
        for (const l of name.slice(1)) push(l);
      } else {
        for (const l of wrap(b.name, chars)) push(l);
        const left = `  ${b.qty} x ${amount(b.price)}`;
        push(left + ' '.repeat(Math.max(1, chars - len(left) - len(total))) + total);
      }
    }
  }
  return lines;
}

export const paymentName = m => (m === 'cash' ? 'Tiền mặt' : m === 'transfer' ? 'Chuyển khoản' : 'Chưa ghi nhận');

/** Bill blocks for an order. Open orders print as a pre-bill (phiếu tạm tính). */
export function receiptBlocks(order, { shop = DEFAULT_SHOP, cashier = '', copy = 1, copies = 1 } = {}) {
  const s = { ...DEFAULT_SHOP, ...shop }, paid = order.status === 'paid';
  const items = order.items || [], total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const blocks = [{ t: 'text', text: s.name || DEFAULT_SHOP.name, align: 'center', bold: true, size: 'big' }];
  if (s.address) blocks.push({ t: 'text', text: s.address, align: 'center' });
  if (s.phone) blocks.push({ t: 'text', text: `ĐT: ${s.phone}`, align: 'center' });
  blocks.push({ t: 'line' }, { t: 'text', text: paid ? 'HÓA ĐƠN THANH TOÁN' : 'PHIẾU TẠM TÍNH', align: 'center', bold: true, size: 'tall' });
  if (copies > 1) blocks.push({ t: 'text', text: `Liên ${copy}/${copies}`, align: 'center' });
  blocks.push(
    { t: 'row', left: 'Số HĐ:', right: String(order.code || '') },
    { t: 'row', left: 'Bàn/Order:', right: clean(order.label || order.table || '—') },
  );
  if (order.customer && clean(order.customer) !== clean(order.label)) blocks.push({ t: 'row', left: 'Khách:', right: clean(order.customer) });
  blocks.push({ t: 'row', left: paid ? 'Thanh toán lúc:' : 'Giờ vào:', right: dt(paid ? order.paidAt || order.created : order.created) });
  blocks.push({ t: 'row', left: 'Ca:', right: `Ca ${order.shift ?? ''}` });
  if (cashier) blocks.push({ t: 'row', left: 'Thu ngân:', right: clean(cashier) });
  blocks.push({ t: 'line' }, { t: 'item-head' });
  for (const i of items) blocks.push({ t: 'item', name: i.name, qty: i.qty, price: i.price });
  blocks.push(
    { t: 'line' },
    { t: 'row', left: `Số món: ${items.reduce((n, i) => n + i.qty, 0)}`, right: '' },
    { t: 'row', left: 'TỔNG CỘNG', right: `${amount(total)}đ`, bold: true, size: 'tall' },
  );
  if (paid) {
    const pt = order.paymentTotals;
    if (pt && pt.cash && pt.transfer) {
      blocks.push({ t: 'row', left: 'Tiền mặt:', right: amount(pt.cash) }, { t: 'row', left: 'Chuyển khoản:', right: amount(pt.transfer) });
    } else blocks.push({ t: 'row', left: 'Hình thức:', right: paymentName(order.paymentMethod) });
  } else blocks.push({ t: 'text', text: '(Chưa thanh toán)', align: 'center' });
  if (order.note) blocks.push({ t: 'text', text: `Ghi chú: ${order.note}` });
  blocks.push({ t: 'line' });
  if (s.footer) blocks.push({ t: 'text', text: s.footer, align: 'center' });
  blocks.push({ t: 'text', text: 'Lam An POS', align: 'center' });
  return blocks;
}

/** Self-test page: checks width (edge markers), Vietnamese glyphs, bold/sizes and alignment. */
export function testBlocks({ paper = 58, driver = '', device = '', mode = 'image', shop = DEFAULT_SHOP, at = new Date().toISOString() } = {}) {
  const { chars } = PAPERS[paper] || PAPERS[58];
  const ruler = Array.from({ length: chars }, (_, i) => String((i + 1) % 10)).join('');
  return [
    { t: 'text', text: 'IN THỬ MÁY IN', align: 'center', bold: true, size: 'big' },
    { t: 'text', text: shop?.name || DEFAULT_SHOP.name, align: 'center' },
    { t: 'line', ch: '=' },
    { t: 'row', left: 'Thiết bị:', right: device || 'Không rõ' },
    { t: 'row', left: 'Cách in:', right: driver },
    { t: 'row', left: 'Khổ giấy:', right: `${paper}mm · ${chars} ký tự` },
    { t: 'row', left: 'Chế độ:', right: mode === 'text' ? 'Chữ không dấu' : 'Ảnh (có dấu)' },
    { t: 'row', left: 'Thời gian:', right: dt(at) },
    { t: 'line' },
    { t: 'text', text: '1) Thước đo khổ giấy:' },
    { t: 'row', left: '|<', right: '>|' },
    { t: 'text', text: ruler },
    { t: 'text', text: '2) Tiếng Việt có dấu:' },
    { t: 'text', text: 'ĂÂĐÊÔƠƯ ăâđêôơư áàảãạ ếềểễệ' },
    { t: 'text', text: 'Cà phê sữa đá, Trà đào cam sả' },
    { t: 'text', text: '3) Kiểu chữ:' },
    { t: 'text', text: 'Chữ đậm', bold: true },
    { t: 'text', text: 'Chữ cao', size: 'tall' },
    { t: 'text', text: 'Chữ lớn', size: 'big' },
    { t: 'text', text: '4) Căn lề:' },
    { t: 'text', text: 'Trái' },
    { t: 'text', text: 'Giữa', align: 'center' },
    { t: 'text', text: 'Phải', align: 'right' },
    { t: 'line' },
    { t: 'item-head' },
    { t: 'item', name: 'Cà phê sữa', qty: 2, price: 22000 },
    { t: 'item', name: 'Trà sữa lá dứa kem cheese size lớn', qty: 1, price: 35000 },
    { t: 'line' },
    { t: 'row', left: 'TỔNG CỘNG', right: `${amount(79000)}đ`, bold: true, size: 'tall' },
    { t: 'line' },
    { t: 'text', text: 'Thấy đủ 2 vạch |< >| ở hai mép và đủ dấu tiếng Việt là đạt.', align: 'center' },
  ];
}
