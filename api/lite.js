// Vercel Function serving the Lite version at /lite (see vercel.json). No JavaScript runs in the browser.
import { createLiteApp } from '../src/lite/app.js';

let app;
async function readBody(req) {
  if (req.method !== 'POST') return '';
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return new URLSearchParams(Object.entries(req.body).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => [k, x]) : [[k, v]]))).toString();
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').slice(0, 200000);
}

export default async function handler(req, res) {
  app ??= createLiteApp({
    supabaseUrl: (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim(),
    supabaseKey: (process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim(),
  });
  const out = await app({ method: req.method, url: req.url, headers: req.headers, body: await readBody(req) });
  res.statusCode = out.status;
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.end(out.body);
}
