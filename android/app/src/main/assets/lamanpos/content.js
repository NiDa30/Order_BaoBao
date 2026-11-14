// Content script (GeckoView built-in extension): exposes window.LamAnAndroid to the page.
// Methods return Promises; the web app awaits them (src/printer.js). The app only answers pages
// of the configured shop site (checked natively against the sender URL).
'use strict';
const port = browser.runtime.connectNative('lamanpos');
let seq = 0;
const pending = new Map();
port.onMessage.addListener(m => {
  const done = pending.get(m.id);
  if (done) { pending.delete(m.id); done(String(m.result)); }
});
const call = (method, arg) => new Promise(resolve => {
  const id = ++seq;
  pending.set(id, resolve);
  port.postMessage({ id, method, arg: arg == null ? '' : String(arg) });
});
const page = window.wrappedJSObject;
const toPage = p => new page.Promise(exportFunction((resolve, reject) => { p.then(v => resolve(v), e => reject(String(e))); }, window));
const api = new page.Object();
exportFunction(() => toPage(call('info')), api, { defineAs: 'info' });
exportFunction(b64 => toPage(call('printBase64', b64)), api, { defineAs: 'printBase64' });
page.LamAnAndroid = api;

// Page state for the device tests and diagnostics (title, whether the app rendered, bridge visible to the page).
function report() {
  call('pageState', JSON.stringify({
    title: document.title,
    url: location.href,
    login: !!document.querySelector('#cloud-login'),
    app: !!document.querySelector('#app *'),
    bridge: typeof page.LamAnAndroid.printBase64,
    text: (document.body && document.body.innerText || '').slice(0, 160),
  }));
}
window.addEventListener('load', () => { setTimeout(report, 2000); setTimeout(report, 8000); });
