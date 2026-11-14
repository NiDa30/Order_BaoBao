// Small polyfills so the full app also runs in older Android WebViews (Chrome 64+, e.g. SUNMI T1 on
// Android 6). Syntax is lowered at build time (vite.config.js); these cover runtime APIs used by the app.
/* eslint-disable no-extend-native */
const g = typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : window;
if (typeof globalThis === 'undefined') g.globalThis = g;
if (typeof g.structuredClone !== 'function') g.structuredClone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
if (!Object.hasOwn) Object.hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
if (!Object.fromEntries) Object.fromEntries = entries => { const o = {}; for (const [k, v] of entries) o[k] = v; return o; };
if (!String.prototype.replaceAll) {
  String.prototype.replaceAll = function (search, replacement) {
    if (search instanceof RegExp) return this.replace(search, replacement);
    return String(this).split(String(search)).join(replacement);
  };
}
if (!Array.prototype.flat) {
  Array.prototype.flat = function (depth = 1) {
    return depth < 1 ? this.slice() : this.reduce((a, v) => a.concat(Array.isArray(v) ? v.flat(depth - 1) : v), []);
  };
}
if (!Array.prototype.flatMap) Array.prototype.flatMap = function (fn, t) { return this.map(fn, t).flat(); };
if (!Array.prototype.at) Array.prototype.at = function (i) { i = Math.trunc(i) || 0; return this[i < 0 ? this.length + i : i]; };
if (!Promise.allSettled) Promise.allSettled = ps => Promise.all([...ps].map(p => Promise.resolve(p).then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }))));
if (g.crypto && typeof g.crypto.randomUUID !== 'function' && typeof g.crypto.getRandomValues === 'function') {
  g.crypto.randomUUID = () => {
    const b = g.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
}
