// Local dev server: serves /public and runs /api/*.js handlers exactly like Vercel does.
// Usage: npm run dev  →  http://localhost:3000
import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/\/$/, '').replace(/[^a-z0-9_-]/gi, '');
      const file = path.join(ROOT, 'api', `${name}.js`);
      if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('{"error":"Unknown API route"}'); }
      const mod = await import(pathToFileURL(file).href);
      return mod.default(req, res);
    }
    let p = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
    if (!p.startsWith(PUBLIC)) { res.statusCode = 403; return res.end(); }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p) && fs.existsSync(`${p}.html`)) p = `${p}.html`; // clean URLs, like Vercel
    if (!fs.existsSync(p)) { res.statusCode = 404; p = path.join(PUBLIC, '404.html'); }
    res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
    fs.createReadStream(p).pipe(res);
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => console.log(`TickerMind running → http://localhost:${PORT}`));
