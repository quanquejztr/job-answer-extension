// Test-only static server: Node standard library, loopback only, serves tests/fixtures.
// The product itself has no local server.
import { createServer } from 'node:http';
import { URL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1';
const PORT = 4310;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
const SERVER_FILES = new Set(['serve.mjs']);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
    const file = join(ROOT, rel);
    const name = rel.split(sep).pop() ?? '';
    if (
      req.method !== 'GET' ||
      !file.startsWith(ROOT + sep) ||
      SERVER_FILES.has(name) ||
      !(extname(file) in TYPES)
    ) {
      res.writeHead(404).end('Not found');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)], 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

server.listen(PORT, HOST);
