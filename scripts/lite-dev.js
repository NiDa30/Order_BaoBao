// Local server for the Lite version: `npm run lite` (uses VITE_SUPABASE_* from the environment or .env.local).
// With LITE_FAKE_SUPABASE=1 it runs against an in-memory fake Supabase (used by the Playwright tests).
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import handler from '../api/lite.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
for (const file of ['.env.local', '.env']) {
  const p = path.join(root, file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const port = Number(process.env.LITE_PORT || 5176);
if (process.env.LITE_FAKE_SUPABASE === '1') {
  const { startFakeSupabase } = await import('../tests/helpers/fake-supabase.js');
  const fake = await startFakeSupabase(Number(process.env.LITE_FAKE_PORT || 5177));
  process.env.VITE_SUPABASE_URL = fake.url;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test_only';
}
http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/lite' || p.startsWith('/lite/')) return handler(req, res);
  const file = path.join(root, 'public', path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (existsSync(file) && !file.endsWith(path.sep)) { res.writeHead(200); return res.end(readFileSync(file)); }
  res.writeHead(302, { Location: '/lite' });
  res.end();
}).listen(port, '127.0.0.1', () => console.log(`Lam An Lite: http://127.0.0.1:${port}/lite`));
