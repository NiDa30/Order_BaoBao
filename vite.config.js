import { defineConfig } from 'vite';

// Chrome 64+ so the full app also runs in older Android WebViews (e.g. SUNMI T1, Android 6) inside the
// Lam An POS Android app. Runtime APIs are covered by src/polyfills.js.
export default defineConfig({
  build: { target: ['chrome64', 'safari12', 'firefox67', 'edge79'] },
});
