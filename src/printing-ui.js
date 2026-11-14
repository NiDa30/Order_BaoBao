// Printer dialog, bill printing and printer self-test. State lives in this module; main.js only
// opens the dialog, renders it inside the overlay and calls printOrder/afterPay.
import { layout, PAPERS } from './receipt.js';
import {
  DRIVERS, RAWBT_PLAY, APP_APK, detect, receiptImage, loadSettings, saveSettings, send, receiptJobs, testJob, resolveDriver, resolvePaper, pairUsb, pairSerial,
} from './printer.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const VERDICTS = {
  ok: 'In đẹp, đủ dấu',
  garbled: 'Chữ lỗi / ký tự lạ',
  cut: 'Mất chữ ở mép / tràn dòng',
  none: 'Không ra giấy',
};

export function createPrinting({ toast, context, open }) {
  let settings = loadSettings(), detection = null, scanning = null, test = null; // test: {result, verdict}
  const save = () => { if (!saveSettings(settings)) toast('Không lưu được cài đặt máy in trên trình duyệt này.'); };
  const driver = () => resolveDriver(settings, detection), paper = () => resolvePaper(settings, detection);
  const rerender = () => {
    const el = document.querySelector('#printer-dialog');
    if (el) el.outerHTML = dialog();
  };
  function scan() {
    scanning = detect().then(d => { detection = d; scanning = null; rerender(); return d; });
    return scanning;
  }
  const ready = async () => detection || scanning || scan();
  const cashierOf = order => {
    const { access } = context(), id = order.status === 'paid' ? order.paidBy : access?.userId;
    const m = (access?.members || []).find(x => x.user_id === id);
    return m?.display_name || (order.status === 'paid' ? order.paidByEmail : access?.email) || '';
  };

  async function printOrder(order) {
    if (!order || order.status === 'cancelled') { toast('Không in bill cho đơn đã hủy.'); return { ok: false }; }
    const d = await ready();
    const result = await send(receiptJobs(order, settings, { cashier: cashierOf(order) }), settings, d);
    toast(result.ok ? (order.status === 'paid' ? 'Đã gửi bill tới máy in.' : 'Đã gửi phiếu tạm tính tới máy in.') : result.message);
    return result;
  }
  async function afterPay(order) {
    if (settings.autoPrint && order?.status === 'paid') return printOrder(order);
    return null;
  }
  const printButton = order =>
    order.status === 'cancelled' ? '' : `<button class="secondary full print-bill-button" data-print-order="${esc(order.id)}">🖨︎ ${order.status === 'paid' ? 'In bill cho khách' : 'In phiếu tạm tính'}</button>`;

  function deviceSection() {
    if (!detection) return '<div class="printer-scan" role="status"><span></span>Đang nhận diện thiết bị và máy in…</div>';
    const { device, caps, usb, serial, notes, recommended } = detection;
    const yes = v => `<b class="${v ? 'ok' : 'no'}">${v ? 'Có' : 'Không'}</b>`;
    return `<div class="printer-facts">
<div><span>Thiết bị</span><b>${esc([device.vendor, device.model].filter(Boolean).join(' ') || (device.android ? 'Android (không rõ model)' : 'Máy tính / trình duyệt khác'))}</b></div>
<div><span>Loại</span><b>${device.isPos ? `Máy POS ${device.kind === 'desktop' ? 'để bàn' : 'cầm tay'}` : device.android ? 'Android thường' : 'Không phải Android'}</b></div>
<div><span>Ứng dụng Lam An POS</span>${yes(caps.app)}${detection.app ? ` <small>${esc(detection.app.version || '')}</small>` : ''}</div><div><span>Máy in tích hợp (app)</span>${yes(caps.appPrinter)}</div>
<div><span>WebUSB</span>${yes(caps.usb)}</div><div><span>Web Serial</span>${yes(caps.serial)}</div>
<div><span>Máy in đã cấp quyền</span><b>${esc([...usb, ...serial].map(x => x.name).join(', ') || 'Chưa có')}</b></div>
<div><span>Đề xuất</span><b>${esc(DRIVERS[recommended])}</b></div></div>
${notes.map(n => `<p class="note">${esc(n)}</p>`).join('')}`;
  }
  function testSection() {
    if (!test) return '';
    const r = test.result;
    let advice = '';
    if (test.verdict === 'ok') advice = 'Máy in hoạt động tốt. Cài đặt đã được lưu trên thiết bị này.';
    if (test.verdict === 'garbled') advice = settings.mode === 'image'
      ? 'Máy in có thể không hỗ trợ in ảnh (GS v 0). Thử chế độ “Chữ không dấu”. Nếu dùng RawBT, chọn đúng máy in (InnerPrinter/USB) và driver ESC/POS trong RawBT.'
      : 'Máy in không nhận lệnh ESC/POS. Kiểm tra máy in đúng loại nhiệt ESC/POS hoặc đổi sang Hộp thoại in của hệ thống.';
    if (test.verdict === 'cut') advice = paper() === 80 ? 'Máy in có thể là khổ 58mm. Thử đổi khổ giấy sang 58mm rồi in thử lại.' : 'Nếu giấy rộng 80mm, đổi khổ giấy sang 80mm. Nếu là 58mm, kiểm tra cài đặt khổ giấy trong RawBT (384 điểm).';
    if (test.verdict === 'none') advice = {
      android: 'Kiểm tra giấy, nắp máy in và đèn báo. Trong ứng dụng, giữ nút Quay lại → In thử máy in tích hợp để in trang kiểm tra trực tiếp.',
      rawbt: 'Chưa cài RawBT hoặc RawBT chưa chọn máy in. Cài RawBT, mở ứng dụng, chọn máy in tích hợp (thường tên InnerPrinter) và đặt làm mặc định, rồi in thử lại.',
      usb: 'Kiểm tra cáp/nguồn máy in rồi bấm Kết nối máy in USB lại. Một số máy POS không mở máy in tích hợp cho WebUSB, khi đó dùng RawBT.',
      serial: 'Kiểm tra máy in đã ghép đôi Bluetooth và đang bật. Thử lại tốc độ baud 9600 hoặc 115200, hoặc dùng RawBT.',
      system: 'Trong hộp thoại in, chọn máy in của máy POS (cần cài dịch vụ in của hãng hoặc RawBT). Nếu không có máy in nào, dùng cách in RawBT.',
    }[driver()];
    const fix = test.verdict === 'garbled' && settings.mode === 'image' ? '<button class="secondary" data-printer-fix="text">Chuyển sang Chữ không dấu</button>'
      : test.verdict === 'cut' ? `<button class="secondary" data-printer-fix="paper">Đổi sang ${paper() === 80 ? 58 : 80}mm</button>`
      : test.verdict === 'none' && !['rawbt', 'android'].includes(driver()) ? '<button class="secondary" data-printer-fix="rawbt">Dùng RawBT</button>' : '';
    return `<section class="printer-test-result ${r.ok ? '' : 'failed'}" aria-live="polite"><h3>${r.ok ? (r.confirmed ? '✓ Máy in đã nhận dữ liệu' : '↗ Đã gửi lệnh in thử') : '✕ In thử không thành công'}</h3><p>${esc(r.message)}</p>
${r.ok && !test.verdict ? `<p><b>Giấy in thử ra thế nào?</b></p><div class="printer-verdicts">${Object.entries(VERDICTS).map(([k, v]) => `<button class="secondary" data-printer-verdict="${k}">${v}</button>`).join('')}</div>` : ''}
${advice ? `<p class="${test.verdict === 'ok' ? 'note' : 'warning'}">${esc(advice)}</p>${fix}` : ''}</section>`;
  }
  function dialog() {
    const d = driver(), p = paper(), s = settings.shop, last = settings.lastTest;
    const preview = detection ? receiptImage(layout(testJob(settings, detection), PAPERS[p].chars), p) : '';
    return `<div class="small-dialog printer-dialog" id="printer-dialog"><div class="dialog-heading"><h2>Máy in bill</h2><button class="icon-button" data-action="dismiss" aria-label="Đóng">×</button></div>
<p class="muted">Cài đặt lưu riêng trên thiết bị này (mỗi máy POS một máy in).${last ? ` Lần in thử gần nhất: ${new Date(last.at).toLocaleString('vi-VN')} · ${esc(VERDICTS[last.verdict] || 'chưa xác nhận')}.` : ''}</p>
<h3>Nhận diện</h3>${deviceSection()}
<div class="printer-actions"><button class="secondary" data-printer-action="scan">↻ Quét lại</button>${detection?.caps.usb ? '<button class="secondary" data-printer-action="pair-usb">Kết nối máy in USB</button>' : ''}${detection?.caps.serial ? '<button class="secondary" data-printer-action="pair-serial">Kết nối Bluetooth/Serial</button>' : ''}${detection?.caps.app ? '<a class="secondary" href="lamanpos://settings">Cài đặt ứng dụng</a>' : detection?.device.android ? `<a class="secondary" href="${APP_APK}">Tải ứng dụng Lam An POS</a><a class="secondary" href="${RAWBT_PLAY}" target="_blank" rel="noopener">Cài RawBT</a>` : ''}</div>
<h3>Cài đặt</h3><form class="printer-form" id="printer-form" onsubmit="return false">
<label>Cách in<select id="printer-driver">${Object.entries(DRIVERS).map(([k, v]) => `<option value="${k}" ${settings.driver === k ? 'selected' : ''}>${esc(k === 'auto' && detection ? `${v} (đang dùng: ${DRIVERS[detection.recommended].split(' (')[0]})` : v)}</option>`).join('')}</select></label>
<label>Khổ giấy<select id="printer-paper"><option value="" ${!settings.paper ? 'selected' : ''}>Tự động (${detection?.device.suggestedPaper || 58}mm)</option><option value="58" ${Number(settings.paper) === 58 ? 'selected' : ''}>58mm (32 ký tự)</option><option value="80" ${Number(settings.paper) === 80 ? 'selected' : ''}>80mm (48 ký tự)</option></select></label>
${d !== 'system' ? `<label>Chế độ in<select id="printer-mode"><option value="image" ${settings.mode !== 'text' ? 'selected' : ''}>Ảnh – giữ dấu tiếng Việt</option><option value="text" ${settings.mode === 'text' ? 'selected' : ''}>Chữ không dấu – nhanh, mọi máy in</option></select></label>` : ''}
${d === 'serial' ? `<label>Tốc độ baud<select id="printer-baud">${[9600, 19200, 38400, 115200].map(b => `<option ${Number(settings.baudRate) === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>` : ''}
<label>Số liên mỗi lần in<select id="printer-copies">${[1, 2, 3].map(n => `<option ${Number(settings.copies) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
<label class="check-label"><input type="checkbox" id="printer-auto" ${settings.autoPrint ? 'checked' : ''}> Tự in bill ngay sau khi xác nhận thanh toán</label>
<label>Tên quán trên bill<input id="printer-shop-name" maxlength="60" value="${esc(s.name)}"></label>
<label>Địa chỉ<input id="printer-shop-address" maxlength="120" value="${esc(s.address)}" placeholder="Không bắt buộc"></label>
<label>Số điện thoại<input id="printer-shop-phone" maxlength="20" value="${esc(s.phone)}" placeholder="Không bắt buộc"></label>
<label>Lời chào cuối bill<input id="printer-shop-footer" maxlength="120" value="${esc(s.footer)}"></label></form>
<button class="primary full" data-printer-action="test" ${detection ? '' : 'disabled'}>🖨︎ In thử</button>
${testSection()}
${preview ? `<details class="printer-preview"><summary>Xem trước trang in thử (${p}mm)</summary>${preview}</details>` : ''}</div>`;
  }

  async function runTest() {
    const d = await ready();
    const result = await send(testJob(settings, d), settings, d, { fallback: true });
    test = { result, verdict: null };
    settings.lastTest = { at: new Date().toISOString(), driver: driver(), paper: paper(), ok: result.ok, verdict: null };
    save();
    rerender();
  }

  document.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.printOrder) {
      const order = context().db.orders.find(o => o.id === b.dataset.printOrder);
      b.disabled = true;
      try { await printOrder(order); } finally { b.disabled = false; }
    }
    if (b.dataset.printerAction === 'open') { open(); if (!detection && !scanning) scan(); }
    if (b.dataset.printerAction === 'scan') { detection = null; rerender(); await scan(); }
    if (b.dataset.printerAction === 'test') await runTest();
    if (b.dataset.printerAction === 'pair-usb' || b.dataset.printerAction === 'pair-serial') {
      try {
        b.dataset.printerAction === 'pair-usb' ? await pairUsb() : await pairSerial();
        settings.driver = b.dataset.printerAction === 'pair-usb' ? 'usb' : 'serial';
        save();
        await scan();
        toast('Đã kết nối máy in. Bấm In thử để kiểm tra.');
      } catch (err) {
        if (err?.name !== 'NotFoundError') toast(err?.message || 'Không kết nối được máy in.');
      }
    }
    if (b.dataset.printerVerdict && test) {
      test.verdict = b.dataset.printerVerdict;
      settings.lastTest = { ...(settings.lastTest || {}), verdict: test.verdict };
      save();
      rerender();
    }
    if (b.dataset.printerFix) {
      if (b.dataset.printerFix === 'text') settings.mode = 'text';
      if (b.dataset.printerFix === 'paper') settings.paper = paper() === 80 ? 58 : 80;
      if (b.dataset.printerFix === 'rawbt') settings.driver = 'rawbt';
      save();
      test = null;
      rerender();
      toast('Đã đổi cài đặt. Bấm In thử để kiểm tra lại.');
    }
  });
  const fields = { 'printer-driver': 'driver', 'printer-paper': 'paper', 'printer-mode': 'mode', 'printer-copies': 'copies', 'printer-baud': 'baudRate' };
  document.addEventListener('change', e => {
    const id = e.target.id;
    if (fields[id]) {
      const v = e.target.value;
      settings[fields[id]] = ['paper', 'copies', 'baudRate'].includes(fields[id]) ? (v ? Number(v) : null) : v;
      test = null;
      save();
      rerender();
    }
    if (id === 'printer-auto') { settings.autoPrint = e.target.checked; save(); }
  });
  document.addEventListener('input', e => {
    const key = e.target.id?.startsWith('printer-shop-') && e.target.id.slice(13);
    if (key && key in settings.shop) { settings.shop = { ...settings.shop, [key]: e.target.value }; save(); }
  });

  return { dialog, printOrder, afterPay, printButton, settings: () => settings, detection: () => detection };
}
