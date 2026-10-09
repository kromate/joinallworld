import { createServer } from 'vite';
const server = await createServer({ configFile: false, root: process.cwd(), optimizeDeps: { entries: ['evidence/graphics-loop/expressive-character-v1/index.html'] }, server: { host: '127.0.0.1', port: 5197, strictPort: true, preTransformRequests: false } });
await server.listen();
