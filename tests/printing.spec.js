import { mock, login } from './helpers/cloud.js';
import { test, expect } from '@playwright/test';
import { layout, receiptBlocks, testBlocks, PAPERS } from '../src/receipt.js';
import { textJob, imageJob, packMonochrome, toAscii } from '../src/escpos.js';
import { classifyDevice, modelFromUA, rawbtUrl, resolveDriver } from '../src/printer.js';

const SUNMI_UA = 'Mozilla/5.0 (Linux; Android 11; V2s Build/RKQ1.200826.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const paidOrder = {
  id: 'o1', code: '20261114-001-ABC123', label: 'Bàn 15', table: '15', customer: 'Chị Linh', shift: 1, day: '2026-11-14',
  created: '2026-11-14T03:00:00Z', status: 'paid', paidAt: '2026-11-14T03:20:00Z', paymentMethod: 'cash', paymentTotals: { cash: 114000, transfer: 0, unknown: 0 },
  items: [{ id: 'm1', name: 'Cà phê sữa', price: 22000, qty: 2 }, { id: 'm2', name: 'Trà sữa lá dứa kem cheese siêu to khổng lồ', price: 35000, qty: 2 }],
};
// Record intent: links (RawBT) and window.print instead of leaving the page / opening a dialog.
async function captureOutput(page) {
  await page.addInitScript(() => {
    window.__intents = [];
    window.__prints = [];
    document.addEventListener('click', e => {
      const a = e.target.closest?.('a[href^="intent:"]');
      if (a) { e.preventDefault(); window.__intents.push(a.href); }
    }, true);
    window.print = () => {
      window.__prints.push([...document.querySelectorAll('#print-root img')].map(i => i.alt).join('\n'));
      window.__pageSize = document.querySelector('#print-page-size')?.textContent;
      setTimeout(() => window.dispatchEvent(new Event('afterprint')));
    };
  });
}
async function fakeUsbPrinter(page) {
  await page.addInitScript(() => {
    window.__usbBytes = [];
    const ep = { endpointNumber: 1, direction: 'out', type: 'bulk' };
    const dev = {
      productName: 'POS-80', manufacturerName: 'Printer', vendorId: 0x0416, productId: 0x5011, opened: false, configuration: null,
      async open() { this.opened = true; },
      async selectConfiguration() { this.configuration = { interfaces: [{ interfaceNumber: 0, claimed: false, alternates: [{ interfaceClass: 7, endpoints: [ep] }] }] }; },
      async claimInterface() { this.configuration.interfaces[0].claimed = true; },
      async transferOut(n, data) { window.__usbBytes.push(...data); return { status: 'ok', bytesWritten: data.length }; },
    };
    dev.selectConfiguration();
    Object.defineProperty(navigator, 'usb', { value: { getDevices: async () => [dev], requestDevice: async () => dev } });
  });
}
const openPrinter = page => page.locator('[data-printer-action=open]').filter({ visible: true }).first().click();

test('bill layout fits 58mm and 80mm grids and keeps Vietnamese text', () => {
  for (const paper of [58, 80]) {
    const { chars } = PAPERS[paper];
    for (const blocks of [receiptBlocks(paidOrder, { cashier: 'Bảo' }), testBlocks({ paper })]) {
      const lines = layout(blocks, chars);
      for (const l of lines) expect([...l.text].length).toBe(l.size === 'big' ? chars / 2 : chars);
    }
    const text = layout(receiptBlocks(paidOrder, { cashier: 'Bảo' }), chars).map(l => l.text).join('\n');
    expect(text).toContain('HÓA ĐƠN THANH TOÁN');
    expect(text).toMatch(/TỔNG CỘNG\s+114\.000đ/);
    expect(text).toContain('14/11/2026 10:20');
    expect(text).toContain('Tiền mặt');
  }
  const marks = layout(testBlocks({ paper: 80 }), 48).find(l => l.text.startsWith('|<'));
  expect(marks.text).toBe('|<' + ' '.repeat(44) + '>|');
  const pre = layout(receiptBlocks({ ...paidOrder, status: 'open', paidAt: null }), 32).map(l => l.text).join('\n');
  expect(pre).toContain('PHIẾU TẠM TÍNH');
  expect(pre).toContain('(Chưa thanh toán)');
  expect(layout(receiptBlocks(paidOrder, { copies: 2, copy: 2 }), 32).map(l => l.text).join('')).toContain('Liên 2/2');
});

test('ESC/POS encoder: text mode strips accents, image mode sends GS v 0 raster', () => {
  expect(toAscii('Cà phê sữa đá – Đ')).toBe('Ca phe sua da - D');
  const t = textJob(layout(receiptBlocks(paidOrder), 32));
  expect([...t.slice(0, 2)]).toEqual([0x1b, 0x40]);
  expect([...t].every(b => b < 0x80)).toBe(true);
  expect([...t.slice(-4)]).toEqual([0x1d, 0x56, 0x42, 0x00]);
  const w = 16, h = 3, rgba = new Uint8ClampedArray(w * h * 4).fill(255);
  rgba.set([0, 0, 0, 255], 0); // top-left pixel black
  const bits = packMonochrome(rgba, w, h);
  expect([...bits]).toEqual([0x80, 0, 0, 0, 0, 0]);
  const img = imageJob(bits, w, h);
  const i = [...img].findIndex((b, k) => b === 0x1d && img[k + 1] === 0x76 && img[k + 2] === 0x30);
  expect([...img.slice(i, i + 8)]).toEqual([0x1d, 0x76, 0x30, 0, 2, 0, 3, 0]);
  expect(rawbtUrl(Uint8Array.from([0x1b, 0x40]))).toBe('intent:base64,G0A=#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;');
});

test('device detection recognises POS terminals and recommends a driver', () => {
  expect(modelFromUA(SUNMI_UA)).toBe('V2s');
  expect(classifyDevice({ ua: SUNMI_UA })).toMatchObject({ isPos: true, vendor: 'SUNMI', kind: 'handheld', suggestedPaper: 58 });
  expect(classifyDevice({ ua: 'Mozilla/5.0 (Linux; Android 10; K)', model: 'T2s' })).toMatchObject({ vendor: 'SUNMI', kind: 'desktop', suggestedPaper: 80 });
  expect(classifyDevice({ ua: 'Mozilla/5.0 (Linux; Android 12; K)', model: 'D4-503' })).toMatchObject({ vendor: 'iMin', kind: 'desktop' });
  expect(classifyDevice({ ua: 'Mozilla/5.0 (Linux; Android 13; SM-A546E)' })).toMatchObject({ android: true, isPos: false });
  expect(classifyDevice({ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toMatchObject({ android: false, isPos: false });
  expect(resolveDriver({ driver: 'auto' }, { recommended: 'rawbt' })).toBe('rawbt');
  expect(resolveDriver({ driver: 'system' }, { recommended: 'rawbt' })).toBe('system');
});

test.describe('on a SUNMI handheld', () => {
  test.use({ userAgent: SUNMI_UA });
  test('detects the POS, test-prints through RawBT and gives advice from the verdict', async ({ page, context }) => {
    await captureOutput(page);
    await mock(context, { workspace: null });
    await login(page);
    await openPrinter(page);
    const dialog = page.locator('#printer-dialog');
    await expect(dialog).toContainText('SUNMI V2s');
    await expect(dialog).toContainText('Máy POS cầm tay');
    await expect(dialog).toContainText('đang dùng: Ứng dụng RawBT');
    await expect(dialog.locator('#printer-paper')).toContainText('Tự động (58mm)');
    await dialog.getByRole('button', { name: '🖨︎ In thử' }).click();
    await expect(dialog).toContainText('Đã gửi lệnh in thử');
    const [intent] = await page.evaluate(() => window.__intents);
    expect(intent).toMatch(/^intent:base64,[A-Za-z0-9+/=]+#Intent;scheme=rawbt;package=ru\.a402d\.rawbtprinter;S\.browser_fallback_url=/);
    const bytes = Buffer.from(intent.split(',')[1].split('#')[0], 'base64');
    expect([...bytes.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect(bytes.includes(Buffer.from([0x1d, 0x76, 0x30]))).toBe(true); // Vietnamese printed as an image
    await dialog.getByRole('button', { name: 'Chữ lỗi / ký tự lạ' }).click();
    await expect(dialog.locator('.warning')).toContainText('Chữ không dấu');
    await dialog.getByRole('button', { name: 'Chuyển sang Chữ không dấu' }).click();
    await expect(dialog.locator('#printer-mode')).toHaveValue('text');
    await page.reload();
    await openPrinter(page);
    await expect(page.locator('#printer-mode')).toHaveValue('text');
    await expect(page.locator('#printer-dialog')).toContainText('Chữ lỗi / ký tự lạ');
  });
});

test('auto-print after payment uses the system dialog with only the receipt; pre-bill for open orders', async ({ page, context }) => {
  await captureOutput(page);
  await mock(context, { workspace: null });
  await login(page);
  await openPrinter(page);
  const dialog = page.locator('#printer-dialog');
  await expect(dialog).toContainText('Không phải Android');
  await dialog.locator('#printer-paper').selectOption('80');
  await dialog.locator('#printer-auto').check();
  await dialog.locator('#printer-shop-address').fill('12 Lê Lợi, Huế');
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
  await page.getByRole('button', { name: '＋ Tạo đơn mới', exact: true }).click();
  await page.getByRole('button', { name: /Cà phê Cà phê sữa/ }).click();
  await page.getByRole('button', { name: 'Tăng Cà phê sữa' }).click();
  await page.locator('#customer-input').fill('Chị Linh');
  await page.getByRole('button', { name: 'Lưu đơn hàng' }).click();
  await page.locator('.order-card').click();
  await page.getByRole('button', { name: '🖨︎ In phiếu tạm tính' }).click();
  await expect.poll(() => page.evaluate(() => window.__prints.length)).toBe(1);
  expect(await page.evaluate(() => window.__prints[0])).toContain('PHIẾU TẠM TÍNH');
  await page.getByRole('button', { name: '✓ Xác nhận đã thanh toán' }).click();
  await expect.poll(() => page.evaluate(() => window.__prints.length)).toBe(2);
  const bill = await page.evaluate(() => window.__prints[1]);
  expect(bill).toContain('HÓA ĐƠN THANH TOÁN');
  expect(bill).toContain('12 Lê Lợi, Huế');
  expect(bill).toContain('Chị Linh');
  expect(bill).toMatch(/TỔNG CỘNG\s+44\.000đ/);
  expect(bill).toContain('Thu ngân:');
  expect(await page.evaluate(() => window.__pageSize)).toMatch(/^@page\{size:80mm \d+mm;margin:0\}$/);
  await expect(page.locator('#print-root')).toHaveCount(0);
  await page.locator('.order-card').click();
  await expect(page.getByRole('button', { name: '🖨︎ In bill cho khách' })).toBeVisible();
});

test('a previously paired USB printer is detected and confirms the bytes it received', async ({ page, context }) => {
  await fakeUsbPrinter(page);
  await mock(context, { workspace: null });
  await login(page);
  await openPrinter(page);
  const dialog = page.locator('#printer-dialog');
  await expect(dialog).toContainText('Printer POS-80');
  await expect(dialog).toContainText('đang dùng: USB trực tiếp');
  await dialog.getByRole('button', { name: '🖨︎ In thử' }).click();
  await expect(dialog).toContainText('Máy in đã nhận dữ liệu');
  const bytes = await page.evaluate(() => window.__usbBytes);
  expect(bytes.slice(0, 2)).toEqual([0x1b, 0x40]);
  await dialog.getByRole('button', { name: 'Mất chữ ở mép / tràn dòng' }).click();
  await dialog.getByRole('button', { name: /Đổi sang (58|80)mm/ }).click();
  await expect(dialog.locator('#printer-paper')).not.toHaveValue('');
});
