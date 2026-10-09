import { createServer } from 'vite';
import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
if (process.env.STATIC_PREVIEW === '1') {
  const root = path.resolve('evidence/graphics-loop/authored-head-spike-v1/results/preview');
  createHttpServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try { const data = await readFile(file); response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream'); response.end(data); }
    catch { response.writeHead(404).end(); }
  }).listen(5197, '127.0.0.1');
} else {
const server = await createServer({ configFile: false, root: process.cwd(), optimizeDeps: { entries: ['evidence/graphics-loop/authored-head-spike-v1/index.html'] }, server: { host: '127.0.0.1', port: 5197, strictPort: true, preTransformRequests: false } });
await server.listen();
}
