// Printer detection, per-device settings and print drivers for Android POS terminals.
// A web page cannot list the printers of a device by itself, so detection combines:
//  - the device model (User-Agent Client Hints / User-Agent) matched against known POS terminals,
//  - browser capabilities (WebUSB, Web Serial),
//  - printers this browser was already allowed to use (navigator.usb.getDevices / serial.getPorts).
import { PAPERS, DEFAULT_SHOP, layout, receiptBlocks, testBlocks } from './receipt.js';
import { textJob, imageJob, packMonochrome, toBase64 } from './escpos.js';

export const PRINTER_KEY = 'lam-an-printer-v1';
export const DRIVERS = {
  auto: 'Tự động',
  rawbt: 'Ứng dụng RawBT (máy in tích hợp / Bluetooth)',
  usb: 'USB trực tiếp (WebUSB)',
  serial: 'Bluetooth / cổng Serial (Web Serial)',
  system: 'Hộp thoại in của hệ thống',
};
export const RAWBT_PLAY = 'https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter';
const SPP = '00001101-0000-1000-8000-00805f9b34fb';
export const defaultSettings = () => ({ driver: 'auto', paper: null, mode: 'image', copies: 1, autoPrint: false, baudRate: 9600, shop: { ...DEFAULT_SHOP }, lastTest: null });

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(PRINTER_KEY) || 'null') || {};
    const d = defaultSettings();
    return { ...d, ...saved, shop: { ...d.shop, ...(saved.shop || {}) } };
  } catch { return defaultSettings(); }
}
export function saveSettings(settings, storage = globalThis.localStorage) {
  try { storage?.setItem(PRINTER_KEY, JSON.stringify(settings)); return true; } catch { return false; }
}

// Known Android POS terminals with a built-in thermal printer. Models are matched on the
// model string reported by the browser; brand names also match when the vendor puts them there.
const POS_MODELS = [
  { vendor: 'SUNMI', re: /sunmi/i, kind: null },
  { vendor: 'SUNMI', re: /^(T1|T2|T2s|T2 ?mini|T2s ?lite|T3( Pro)?|D2|D2s|D2 ?mini|D3( Pro| mini)?|K2|S2)\b/i, kind: 'desktop' },
  { vendor: 'SUNMI', re: /^(V1s?|V2s?|V2[ _-]?Pro|V2s?[ _-]?Plus|V3( Mix)?|P1|P2( ?(Lite|Pro|SE|mini))?|P3|L2s?|M2( Max)?)\b/i, kind: 'handheld' },
  { vendor: 'iMin', re: /\bimin\b/i, kind: null },
  { vendor: 'iMin', re: /^(D1( Pro)?|D4( Pro)?|Swan ?\d|Falcon ?\d|Crane ?\d)\b/i, kind: 'desktop' },
  { vendor: 'iMin', re: /^(M2( Pro| Max)?|Swift ?\d|Lark ?\d)\b/i, kind: 'handheld' },
  { vendor: 'PAX', re: /^(A920( ?Pro)?|A910s?|A930|A77|A35|A60|A80|A50|IM30|E700|E800)\b/i, kind: 'handheld' },
  { vendor: 'Telpo', re: /^TPS\d+/i, kind: 'handheld' },
  { vendor: 'Senraise', re: /^H10s?\b/i, kind: 'handheld' },
  { vendor: 'Landi', re: /^(APOS|C20|SP630)\b/i, kind: 'handheld' },
  { vendor: 'Newland', re: /^N9[01]0\b/i, kind: 'handheld' },
  { vendor: 'Urovo', re: /^(i9000s|i9100)\b/i, kind: 'handheld' },
];
const DESKTOP_HINT = /\b(T\d|D\d|desktop|Swan|Falcon|Crane|K2|S2)\b/i;

export function modelFromUA(ua = '') {
  const parts = (ua.match(/\(([^)]*Android[^)]*)\)/i)?.[1] || '').split(';').map(x => x.trim());
  const i = parts.findIndex(x => /^Android\b/i.test(x));
  const model = (parts.slice(i + 1).find(x => x && !/^[a-z]{2}([-_][a-z]{2})?$/i.test(x) && x !== 'wv' && !/^U$/.test(x)) || '').replace(/\s*Build\/.*$/i, '').trim();
  return model === 'K' ? '' : model; // Chrome's reduced User-Agent hides the model as "K"
}

/** Pure device classification from model / UA. */
export function classifyDevice({ ua = '', model = '', brand = '' } = {}) {
  const android = /android/i.test(ua);
  const name = (model || modelFromUA(ua)).trim();
  let match = null;
  for (const p of POS_MODELS) if (p.re.test(name) || (brand && p.re.test(brand)) || (p.kind === null && p.re.test(ua))) { match = p; break; }
  const kind = match ? match.kind || (DESKTOP_HINT.test(name) ? 'desktop' : 'handheld') : null;
  return {
    android,
    model: name,
    vendor: match?.vendor || '',
    isPos: !!match && android,
    kind,
    suggestedPaper: kind === 'desktop' ? 80 : 58,
  };
}

const isPrinterUsb = d => d?.configuration?.interfaces?.some(i => i.alternates?.some(a => a.interfaceClass === 7)) || d?.deviceClass === 7;
const usbName = d => [d.manufacturerName, d.productName].filter(Boolean).join(' ') || `USB ${d.vendorId?.toString(16)}:${d.productId?.toString(16)}`;
const serialName = p => {
  const info = p.getInfo?.() || {};
  if (info.bluetoothServiceClassId) return 'Bluetooth Serial (SPP)';
  return info.usbVendorId ? `Serial USB ${info.usbVendorId.toString(16)}:${(info.usbProductId || 0).toString(16)}` : 'Cổng Serial';
};

/** Full detection: device, browser capabilities, already-granted printers and a recommended driver. */
export async function detect(nav = globalThis.navigator) {
  let model = '';
  try { model = (await nav.userAgentData?.getHighEntropyValues?.(['model']))?.model || ''; } catch { /* hints are optional */ }
  const device = classifyDevice({ ua: nav.userAgent || '', model });
  const caps = { usb: !!nav.usb, serial: !!nav.serial, print: typeof globalThis.print === 'function' };
  let usb = [], serial = [];
  try { usb = caps.usb ? (await nav.usb.getDevices()).filter(isPrinterUsb) : []; } catch { usb = []; }
  try { serial = caps.serial ? await nav.serial.getPorts() : []; } catch { serial = []; }
  const recommended = usb.length ? 'usb' : serial.length ? 'serial' : device.android ? 'rawbt' : 'system';
  return {
    device,
    caps,
    usb: usb.map(d => ({ name: usbName(d), device: d })),
    serial: serial.map(p => ({ name: serialName(p), port: p })),
    recommended,
    notes: recommendationNotes(device, caps, recommended),
  };
}

export function recommendationNotes(device, caps, recommended) {
  const notes = [];
  if (device.isPos) notes.push(`Đây là máy POS ${device.vendor}${device.model ? ' ' + device.model : ''} (${device.kind === 'desktop' ? 'để bàn' : 'cầm tay'}), thường có máy in nhiệt ${device.suggestedPaper}mm tích hợp.`);
  else if (device.android) notes.push('Thiết bị Android chưa có trong danh sách máy POS đã biết. Vẫn in được nếu máy có máy in tích hợp hoặc kết nối máy in Bluetooth/USB.');
  else notes.push('Không phải thiết bị Android: dùng máy in đã cài trên máy tính qua hộp thoại in, hoặc máy in nhiệt USB qua WebUSB.');
  if (recommended === 'rawbt') notes.push('Đề xuất: cài ứng dụng RawBT, chọn máy in tích hợp (InnerPrinter/USB) trong RawBT rồi bấm In thử. RawBT nhận lệnh in trực tiếp, không hiện hộp thoại.');
  if (recommended === 'usb') notes.push('Đã tìm thấy máy in USB được cấp quyền trước đó, in trực tiếp không cần hộp thoại.');
  if (recommended === 'serial') notes.push('Đã có cổng Serial/Bluetooth được cấp quyền trước đó.');
  if (!caps.usb && !caps.serial) notes.push('Trình duyệt này không hỗ trợ WebUSB/Web Serial. Dùng Chrome bản mới nhất để có thêm cách kết nối trực tiếp.');
  return notes;
}

export const resolveDriver = (settings, detection) => (settings.driver && settings.driver !== 'auto' ? settings.driver : detection?.recommended || 'system');
export const resolvePaper = (settings, detection) => Number(settings.paper) || detection?.device?.suggestedPaper || 58;

export const rawbtUrl = (bytes, { fallback = false } = {}) =>
  `intent:base64,${toBase64(bytes)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;${fallback ? `S.browser_fallback_url=${encodeURIComponent(RAWBT_PLAY)};` : ''}end;`;

/**
 * Draw laid-out lines onto a canvas sized for the paper and return packed 1-bit pixels.
 * Each character is drawn centred in its own grid cell with the system sans-serif font
 * (Roboto/Noto on Android cover all Vietnamese precomposed letters such as ố, ẫ, ự);
 * wide glyphs are squeezed to the cell so columns stay aligned like on a monospace printer.
 */
export function renderBitmap(lines, paper, doc = globalThis.document) {
  const { dots, chars } = PAPERS[paper] || PAPERS[58];
  const canvas = doc.createElement('canvas'), ctx = canvas.getContext('2d');
  const family = 'Roboto,"Noto Sans","Be Vietnam Pro","DejaVu Sans",Arial,sans-serif';
  const cell = dots / chars, fs = Math.round(cell * 1.75), base = Math.ceil(fs * 1.45);
  const heights = lines.map(l => (l.size === 'tall' || l.size === 'big' ? base * 2 : base));
  canvas.width = dots;
  canvas.height = heights.reduce((a, b) => a + b, 0) + 8;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let y = 0;
  lines.forEach((l, i) => {
    const sx = l.size === 'big' ? 2 : 1, sy = l.size === 'big' || l.size === 'tall' ? 2 : 1;
    ctx.font = `${l.bold ? 'bold ' : ''}${fs}px ${family}`;
    const baseline = y + (base - Math.round(fs * 0.32)) * sy;
    [...l.text].forEach((c, x) => {
      if (c === ' ') return;
      const w = ctx.measureText(c).width, squeeze = w > cell * 0.96 ? (cell * 0.96) / w : 1;
      ctx.save();
      ctx.translate((x + 0.5) * cell * sx, baseline);
      ctx.scale(squeeze * sx, sy);
      ctx.fillText(c, 0, 0);
      ctx.restore();
    });
    y += heights[i];
  });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { bits: packMonochrome(img.data, canvas.width, canvas.height), width: canvas.width, height: canvas.height, canvas };
}

/** The exact bitmap a thermal printer receives, as an <img> sized to the printable width. Used for preview and browser printing. */
export function receiptImage(lines, paper, doc = globalThis.document) {
  const p = PAPERS[paper] || PAPERS[58], { canvas } = renderBitmap(lines, paper, doc);
  const alt = lines.map(l => l.text.trim()).filter(Boolean).join('\n').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<img class="receipt-img" style="width:${p.printableMm}mm" src="${canvas.toDataURL('image/png')}" alt="${alt}">`;
}
/** Page height in mm for the browser print dialog (thermal printers print 8 dots per mm). */
export const receiptHeightMm = (lines, paper, doc = globalThis.document) => Math.ceil(renderBitmap(lines, paper, doc).height / 8) + 6;

export function buildJob(blocks, { paper = 58, mode = 'image', doc } = {}) {
  const lines = layout(blocks, (PAPERS[paper] || PAPERS[58]).chars);
  if (mode === 'text') return { lines, bytes: textJob(lines) };
  const bmp = renderBitmap(lines, paper, doc);
  return { lines, bytes: imageJob(bmp.bits, bmp.width, bmp.height) };
}
const concat = arrays => {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrays) { out.set(a, o); o += a.length; }
  return out;
};

async function writeUsb(device, bytes) {
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  const iface = device.configuration.interfaces.find(i => i.alternates.some(a => a.interfaceClass === 7)) ||
    device.configuration.interfaces.find(i => i.alternates.some(a => a.endpoints.some(e => e.direction === 'out' && e.type === 'bulk')));
  if (!iface) throw new Error('Không tìm thấy cổng ghi dữ liệu của máy in USB.');
  const alt = iface.alternates.find(a => a.endpoints.some(e => e.direction === 'out' && e.type === 'bulk'));
  const ep = alt.endpoints.find(e => e.direction === 'out' && e.type === 'bulk');
  if (!iface.claimed) await device.claimInterface(iface.interfaceNumber);
  for (let i = 0; i < bytes.length; i += 4096) {
    const r = await device.transferOut(ep.endpointNumber, bytes.subarray(i, i + 4096));
    if (r.status !== 'ok') throw new Error(`Máy in USB trả về trạng thái ${r.status}.`);
  }
}
async function writeSerial(port, bytes, baudRate = 9600) {
  if (!port.writable) await port.open({ baudRate });
  const writer = port.writable.getWriter();
  try { await writer.write(bytes); } finally { writer.releaseLock(); }
}

/** Ask the user to choose a USB printer (must run inside a click handler). */
export async function pairUsb(nav = globalThis.navigator) {
  if (!nav.usb) throw new Error('Trình duyệt không hỗ trợ WebUSB. Hãy dùng Chrome trên Android hoặc máy tính.');
  return nav.usb.requestDevice({ filters: [{ classCode: 7 }] });
}
/** Ask the user to choose a Bluetooth (SPP) or USB serial printer (must run inside a click handler). */
export async function pairSerial(nav = globalThis.navigator) {
  if (!nav.serial) throw new Error('Trình duyệt không hỗ trợ Web Serial. Chrome Android 138+ hoặc Chrome máy tính mới hỗ trợ.');
  try { return await nav.serial.requestPort({ allowedBluetoothServiceClassIds: [SPP] }); }
  catch (e) { if (e?.name === 'TypeError') return nav.serial.requestPort(); throw e; }
}

// The receipt stays in the page (hidden on screen by CSS) until the next print. Chrome re-renders the
// print preview from the live page while its dialog is open (and fires `afterprint` early), so removing
// it on `afterprint` makes the preview blank and drops the @page size.
const browserPrint = async (html, paper, heightMm, win = globalThis) => {
  const doc = win.document;
  doc.querySelector('#print-root')?.remove();
  doc.querySelector('#print-page-size')?.remove();
  const root = doc.createElement('div');
  root.id = 'print-root';
  root.dataset.paper = String(paper);
  root.innerHTML = html;
  doc.body.appendChild(root);
  const style = doc.createElement('style');
  style.id = 'print-page-size';
  style.textContent = `@page{size:${paper}mm ${heightMm}mm;margin:0}`;
  doc.head.appendChild(style);
  doc.body.classList.add('printing-receipt');
  // Wait until the receipt images are decoded, otherwise the first preview can be empty.
  await Promise.all([...root.querySelectorAll('img')].map(img => (img.decode ? img.decode().catch(() => {}) : null)));
  win.print();
};

/**
 * Send a job. Returns {ok, driver, confirmed, message}. `confirmed` is true only when the browser
 * actually delivered the bytes to the printer (USB/Serial); RawBT and the system dialog cannot report back.
 */
export async function send(jobs, settings, detection, { win = globalThis, fallback = false } = {}) {
  const driver = resolveDriver(settings, detection), paper = resolvePaper(settings, detection);
  const mode = settings.mode === 'text' ? 'text' : 'image';
  const list = Array.isArray(jobs[0]) ? jobs : [jobs]; // one or several copies (block lists)
  try {
    if (driver === 'system') {
      const pages = list.map(b => layout(b, PAPERS[paper].chars));
      const heightMm = Math.max(...pages.map(l => receiptHeightMm(l, paper, win.document)));
      await browserPrint(pages.map(l => `<div class="receipt-page">${receiptImage(l, paper, win.document)}</div>`).join(''), paper, heightMm, win);
      return { ok: true, driver, confirmed: false, message: 'Đã mở hộp thoại in. Chọn máy in của máy POS rồi bấm In.' };
    }
    const bytes = concat(list.map(b => buildJob(b, { paper, mode, doc: win.document }).bytes));
    if (driver === 'rawbt') {
      const a = win.document.createElement('a'); // Chrome Android hands intent: links to the RawBT app
      a.href = rawbtUrl(bytes, { fallback });
      a.hidden = true;
      win.document.body.appendChild(a);
      a.click();
      a.remove();
      return { ok: true, driver, confirmed: false, message: 'Đã gửi lệnh in sang RawBT. Kiểm tra giấy in ra.' };
    }
    if (driver === 'usb') {
      const dev = detection?.usb?.[0]?.device;
      if (!dev) return { ok: false, driver, message: 'Chưa kết nối máy in USB. Mở Máy in → Kết nối máy in USB.' };
      await writeUsb(dev, bytes);
      return { ok: true, driver, confirmed: true, message: `Đã gửi ${bytes.length} byte tới ${detection.usb[0].name}.` };
    }
    if (driver === 'serial') {
      const port = detection?.serial?.[0]?.port;
      if (!port) return { ok: false, driver, message: 'Chưa kết nối máy in Bluetooth/Serial. Mở Máy in → Kết nối Bluetooth/Serial.' };
      await writeSerial(port, bytes, Number(settings.baudRate) || 9600);
      return { ok: true, driver, confirmed: true, message: `Đã gửi ${bytes.length} byte qua ${detection.serial[0].name}.` };
    }
    return { ok: false, driver, message: 'Cách in không hợp lệ.' };
  } catch (e) {
    return { ok: false, driver, message: `In không thành công: ${e?.message || e}` };
  }
}

export function receiptJobs(order, settings, extra = {}) {
  const copies = Math.min(3, Math.max(1, Number(settings.copies) || 1));
  return Array.from({ length: copies }, (_, i) => receiptBlocks(order, { shop: settings.shop, copy: i + 1, copies, ...extra }));
}
export const testJob = (settings, detection) =>
  testBlocks({
    paper: resolvePaper(settings, detection),
    driver: DRIVERS[resolveDriver(settings, detection)].split(' (')[0],
    device: [detection?.device?.vendor, detection?.device?.model].filter(Boolean).join(' ') || (detection?.device?.android ? 'Android' : 'Máy tính'),
    mode: settings.mode,
    shop: settings.shop,
  });
