// Minimal ESC/POS encoder. Supported by Sunmi/iMin built-in printers, Xprinter, Epson-compatible
// 58/80mm thermal printers and the RawBT print service.
const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

/** Remove Vietnamese diacritics so text mode prints on printers without a Vietnamese code page. */
const PUNCT = { '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '₫': 'd', '×': 'x', '·': '-' };
export const toAscii = s =>
  String(s).replace(/[–—‘’“”…₫×·]/g, c => PUNCT[c]).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^\x20-\x7e]/g, '?');

export class EscPos {
  constructor() { this.parts = []; }
  raw(...bytes) { this.parts.push(Uint8Array.from(bytes.flat())); return this; }
  init() { return this.raw(ESC, 0x40, ESC, 0x74, 0); } // reset + code page PC437
  bold(on) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  size(size) { return this.raw(GS, 0x21, size === 'big' ? 0x11 : size === 'tall' ? 0x01 : 0x00); }
  align(a) { return this.raw(ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0); }
  text(s) { this.parts.push(Uint8Array.from([...toAscii(s)].map(c => c.charCodeAt(0)))); return this; }
  line(s = '') { return this.text(s).raw(LF); }
  feed(n = 1) { return this.raw(ESC, 0x64, Math.max(0, Math.min(255, n))); }
  cut() { return this.raw(GS, 0x56, 0x42, 0x00); } // feed + partial cut; ignored by printers without cutter
  /** Raster bit image (GS v 0). bits: packed rows, 1 = black, MSB first. Sent in bands for small printer buffers. */
  raster(bits, widthDots, height, band = 128) {
    const bytesPerRow = Math.ceil(widthDots / 8);
    for (let y = 0; y < height; y += band) {
      const h = Math.min(band, height - y);
      this.raw(GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, h & 0xff, h >> 8);
      this.parts.push(bits.subarray(y * bytesPerRow, (y + h) * bytesPerRow));
    }
    return this;
  }
  bytes() {
    const out = new Uint8Array(this.parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

/** Convert RGBA pixels to packed 1-bit rows (dark pixel → 1). Transparent counts as white. */
export function packMonochrome(rgba, width, height, threshold = 160) {
  const bytesPerRow = Math.ceil(width / 8), out = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, a = rgba[i + 3] / 255;
      const lum = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * a + 255 * (1 - a);
      if (lum < threshold) out[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  return out;
}

/** Text-mode job from laid-out lines (see receipt.js layout). */
export function textJob(lines, { feed = 4, cut = true } = {}) {
  const p = new EscPos().init();
  for (const l of lines) p.bold(l.bold).size(l.size).line(l.text.replace(/\s+$/, ''));
  p.bold(false).size(1).feed(feed);
  if (cut) p.cut();
  return p.bytes();
}

/** Image-mode job from a packed bitmap. */
export function imageJob(bits, widthDots, height, { feed = 4, cut = true } = {}) {
  const p = new EscPos().init().align('left').raster(bits, widthDots, height).feed(feed);
  if (cut) p.cut();
  return p.bytes();
}

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
