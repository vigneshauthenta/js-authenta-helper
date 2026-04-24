/**
 * proxy.js
 *
 * Local dev proxy for the Authenta HTML test console.
 * Runs on http://localhost:3001
 *
 * What it does:
 *   - Serves test.html at http://localhost:3001
 *   - Forwards /api/* requests to the real Authenta API
 *   - Injects x-client-id and x-client-secret headers automatically
 *   - Adds CORS headers so the browser doesn't block responses
 *
 * Usage:
 *   node proxy.js
 *
 * Credentials — set in environment or create a .env file:
 *   AUTHENTA_BASE_URL=https://platform.authenta.ai
 *   AUTHENTA_CLIENT_ID=your_client_id
 *   AUTHENTA_CLIENT_SECRET=your_client_secret
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ── Load .env if present (no dotenv dependency needed) ─────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath   = path.join(__dirname, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
}

// ── Config ─────────────────────────────────────────────────────────────────
const PORT           = 3001;
const API_BASE       = (process.env.AUTHENTA_BASE_URL || 'https://platform.authenta.ai').replace(/\/$/, '');
const CLIENT_ID      = process.env.AUTHENTA_CLIENT_ID     || '';
const CLIENT_SECRET  = process.env.AUTHENTA_CLIENT_SECRET || '';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn('[proxy] Warning: AUTHENTA_CLIENT_ID or AUTHENTA_CLIENT_SECRET not set.');
  console.warn('[proxy] Set them in a .env file or as environment variables.\n');
}

// ── CORS headers added to every response ───────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-client-id, x-client-secret',
};

// ── Server ─────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // Serve static files (test.html, test.css)
  const staticFiles = { '/': 'test.html', '/test.html': 'test.html', '/test.css': 'test.css' };
  const staticFile  = staticFiles[req.url];
  if (staticFile) {
    const mimeTypes = { html: 'text/html', css: 'text/css' };
    const ext  = staticFile.split('.').pop();
    const file = fs.readFileSync(path.join(__dirname, staticFile));
    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': mimeTypes[ext] });
    res.end(file);
    return;
  }

  // Proxy /s3-result?url=... → fetch a presigned S3 result URL server-side
  // Used by test.html to avoid CORS issues when fetching result.json from S3
  if (req.url.startsWith('/s3-result?')) {
    const qs        = new URL(req.url, 'http://localhost').searchParams;
    const targetUrl = qs.get('url');

    if (!targetUrl) {
      res.writeHead(400, CORS_HEADERS);
      res.end(JSON.stringify({ error: 'Missing url parameter' }));
      return;
    }

    const target    = new URL(targetUrl);
    const isHttps   = target.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options = {
      hostname: target.hostname,
      port:     target.port || (isHttps ? 443 : 80),
      path:     target.pathname + target.search,
      method:   'GET',
    };

    const s3Req = transport.request(options, (s3Res) => {
      res.writeHead(s3Res.statusCode, {
        ...CORS_HEADERS,
        'Content-Type': s3Res.headers['content-type'] || 'application/json',
      });
      s3Res.pipe(res);
    });

    s3Req.on('error', (err) => {
      res.writeHead(502, CORS_HEADERS);
      res.end(JSON.stringify({ error: 'S3 fetch error', detail: err.message }));
    });

    s3Req.end();
    return;
  }

  // Proxy /api/* → Authenta API
  if (req.url.startsWith('/api/')) {
    const target   = new URL(req.url, API_BASE);
    const isHttps  = target.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options = {
      hostname: target.hostname,
      port:     target.port || (isHttps ? 443 : 80),
      path:     target.pathname + target.search,
      method:   req.method,
      headers: {
        ...req.headers,
        host:             target.hostname,
        'x-client-id':     CLIENT_ID,
        'x-client-secret': CLIENT_SECRET,
      },
    };

    // Remove browser origin headers that can confuse the upstream
    delete options.headers['origin'];
    delete options.headers['referer'];
    // Remove compression — proxy forwards raw bytes, so we need plain text
    delete options.headers['accept-encoding'];

    const proxyReq = transport.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        ...CORS_HEADERS,
        'Content-Type': proxyRes.headers['content-type'] || 'application/json',
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('[proxy] Upstream error:', err.message);
      res.writeHead(502, CORS_HEADERS);
      res.end(JSON.stringify({ error: 'Proxy upstream error', detail: err.message }));
    });

    req.pipe(proxyReq);
    return;
  }

  // 404 for anything else
  res.writeHead(404, CORS_HEADERS);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\nAuthenta proxy running at http://localhost:${PORT}`);
  console.log(`Open:  http://localhost:${PORT}/test.html`);
  console.log(`API:   ${API_BASE}`);
  console.log(`ID:    ${CLIENT_ID ? CLIENT_ID.slice(0, 6) + '...' : '(not set)'}\n`);
  console.log('Set Base URL in the test console to:  http://localhost:3001\n');
});
