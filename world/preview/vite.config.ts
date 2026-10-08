import { defineConfig, type Plugin } from 'vite';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputRoot = path.resolve(here, '../../.cache/world-build/output');

function worldOutput(): Plugin {
  return {
    name: 'world-output-only',
    configureServer(server) {
      server.middlewares.use('/world-output', async (req, res, next) => {
        try {
          if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end(); return; }
          let raw = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
          if (raw.startsWith('/world-output/')) raw = raw.slice('/world-output'.length);
          if (raw.includes('\\') || raw.split('/').some(part => part === '..' || part === '.')) { res.statusCode = 400; res.end('Invalid path'); return; }
          if (!raw.startsWith('/manifests/') && !raw.startsWith('/tiles/')) { res.statusCode = 404; res.end('Not found'); return; }
          const root = await realpath(outputRoot);
          const candidate = path.resolve(root, `.${raw}`);
          if (candidate !== root && !candidate.startsWith(root + path.sep)) { res.statusCode = 403; res.end('Forbidden'); return; }
          const resolved = await realpath(candidate);
          if (!resolved.startsWith(root + path.sep)) { res.statusCode = 403; res.end('Forbidden'); return; }
          const info = await stat(resolved);
          if (!info.isFile()) { res.statusCode = 404; res.end('Not found'); return; }
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Content-Length', info.size);
          res.setHeader('Cache-Control', 'no-store');
          if (req.method === 'HEAD') { res.end(); return; }
          createReadStream(resolved).on('error', next).pipe(res);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') { res.statusCode = 404; res.end('Not found'); return; }
          next(error);
        }
      });
    },
  };
}

export default defineConfig({
  root: here,
  plugins: [worldOutput()],
  server: { host: '127.0.0.1', port: 5191, strictPort: true },
  build: { outDir: path.resolve(here, 'dist'), emptyOutDir: true },
});
