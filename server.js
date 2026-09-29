'use strict';

/**
 * Zero-dependency static server for the dashboard.
 *
 *   npm start            http://localhost:4000, and on the LAN for phones
 *   PORT=5000 npm start
 *
 * The dashboard is open to everyone: no sign-in, every app. Only its public files are served,
 * never server.js, package.json or tools/.
 */

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4000;

const PUBLIC = new Set(['index.html', 'app.js', 'apps.js', 'sw.js', 'manifest.webmanifest']);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const isIcon = (rel) => /^icons\/[\w.-]+\.(png|svg)$/.test(rel);

const send = (res, code, type, body) => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
};

const server = http.createServer((req, res) => {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  } catch {
    return send(res, 400, 'text/plain', 'Bad request');
  }
  if (!PUBLIC.has(rel) && !isIcon(rel)) return send(res, 404, 'text/plain', 'Not found');

  fs.readFile(path.join(ROOT, rel), (err, body) => {
    if (err) return send(res, 404, 'text/plain', 'Not found');
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream',
      // Revalidate every load so an edited apps.js is picked up immediately.
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nUniversal Dashboard running\n  on this PC   http://localhost:${PORT}`);
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  on a phone   http://${a.address}:${PORT}   (${name})`);
    }
  }
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`\nPort ${PORT} is already in use. Try PORT=${PORT + 1} npm start\n`);
  else console.error(err);
  process.exit(1);
});
