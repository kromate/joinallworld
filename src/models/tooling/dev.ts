import './register-dependencies.ts';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { createServer } = await import('vite');
const port = Number(process.env.MODELS_PORT || 3400);
if (port < 3400 || port > 3409) throw new RangeError('Model preview ports are 3400–3409.');
const threeRoot = dirname(fileURLToPath(import.meta.resolve('three')));
const server = await createServer({
  configFile: false, root, cacheDir: resolve(root, 'src/models/.cache/vite'),
  resolve: { alias: [
    { find: /^three\/addons\//, replacement: resolve(threeRoot, '../examples/jsm') + '/' },
    { find: /^three$/, replacement: resolve(threeRoot, 'three.module.js') },
  ] },
  server: { host: '127.0.0.1', port, strictPort: true, watch: { ignored: ['**/src/models/.cache/**','**/src/models/evidence/**'] }, fs: { allow: [root, resolve(threeRoot, '..')] } },
});
await server.listen();
console.log(`Model library: http://127.0.0.1:${port}/models.html`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close().then(() => process.exit(0)));
