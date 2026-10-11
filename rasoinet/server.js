const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./src/db');
const { seed } = require('./src/seed');
const { createApi, HttpError } = require('./src/api');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'rasoinet.db');
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

function start({ port = PORT, dbFile = DB_FILE, reseed = process.argv.includes('--reseed') } = {}) {
  if (dbFile !== ':memory:') {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    if (reseed) ['', '-wal', '-shm'].forEach((s) => fs.rmSync(dbFile + s, { force: true }));
  }
  const db = openDb(dbFile);
  if (!db.prepare('SELECT COUNT(*) AS n FROM outlets').get().n) {
    console.log('Seeding demo data…');
    seed(db);
  }
  const api = createApi(db);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      let raw = '';
      req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try {
          const body = raw ? JSON.parse(raw) : {};
          const result = api.handle(req.method, url.pathname, Object.fromEntries(url.searchParams), body);
          res.writeHead(req.method === 'POST' ? 201 : 200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          const status = err instanceof HttpError ? err.status : err instanceof SyntaxError ? 400 : 500;
          if (status === 500) console.error(err);
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: status === 500 ? 'Internal error' : err.message }));
        }
      });
      return;
    }
    const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve) => server.listen(port, () => resolve({ server, db })));
}

if (require.main === module) {
  start().then(({ server }) => console.log(`RasoiNet running at http://localhost:${server.address().port}`));
}

module.exports = { start };
