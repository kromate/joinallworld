import { defineConfig, type Plugin } from 'vite';
import { createReadStream } from 'node:fs';
import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { outputRoute } from './output-route.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const buildRoot = path.resolve(here, '../../.cache/world-build');

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
          const route = outputRoute(raw);
          if (!route) { res.statusCode = 404; res.end('Not found'); return; }
          const outputRoot = path.join(buildRoot, ...route.rootParts);
          const root = await realpath(outputRoot);
          if (root !== outputRoot) { res.statusCode = 403; res.end('Output root resolves through a symlink'); return; }
          const candidate = path.join(root, ...route.assetParts);
          if (candidate !== root && !candidate.startsWith(root + path.sep)) { res.statusCode = 403; res.end('Forbidden'); return; }
          let cursor = root;
          for (const segment of path.relative(root, candidate).split(path.sep)) {
            cursor = path.join(cursor, segment);
            const component = await lstat(cursor);
            if (component.isSymbolicLink()) { res.statusCode = 403; res.end('Symlink output is forbidden'); return; }
          }
          const resolved = await realpath(candidate);
          if (!resolved.startsWith(root + path.sep)) { res.statusCode = 403; res.end('Forbidden'); return; }
          const info = await stat(resolved);
          if (!info.isFile()) { res.statusCode = 404; res.end('Not found'); return; }
          if (info.size > route.limit) { res.statusCode = 413; res.end('Output exceeds size limit'); return; }
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
