#!/usr/bin/env node
/**
 * The Worker host on this machine: the bundled Worker, its SQLite Durable Object and the built assets, served by
 * Miniflare (the same tooling the edge suite uses, from deploy/tooling) on one local port.
 *
 *   npm run build && npm run start:worker            http://localhost:8787
 *   PORT=3500 DATA_DIR=/tmp/aw-worker npm run start:worker
 *
 * DATA_DIR keeps the object's storage between runs (default: a temporary folder that is removed on exit). Bindings a
 * deployment would set as vars or secrets are read from the environment when present: BUILD_ID, PUBLIC_ORIGIN,
 * MODERATOR_TOKEN and the outreach settings (server/host-context.js OUTREACH_ENV). Nothing here deploys anything.
 */
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createServer, connect, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { OUTREACH_ENV } from '../server/host-context.js';

/** The few pieces of the pinned tooling (miniflare, esbuild) this runner uses. */
interface MiniflareHandle { ready: Promise<URL>; dispose(): Promise<void> }
interface MiniflareTooling {
  Miniflare: new (options: Record<string, unknown>) => MiniflareHandle
  convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown>
}
interface EsbuildTooling { build(options: Record<string, unknown>): Promise<unknown> }

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(resolve(process.env.JOINALLWORLD_TOOLS || join(root, 'deploy/tooling'), 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as MiniflareTooling;
const { build } = require('esbuild') as EsbuildTooling;

const port = Number(process.env.PORT) || 8787;
const scratch = await mkdtemp(join(tmpdir(), 'allworld-worker-'));
const storage = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(scratch, 'storage');
await mkdir(storage, { recursive: true });
const bundle = join(scratch, 'worker.mjs');
await build({ entryPoints: [join(root, 'deploy/cloudflare-worker.ts')], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], logLevel: 'error' });
const bindings: Record<string, string> = { BUILD_ID: process.env.BUILD_ID || 'local' };
for (const name of ['PUBLIC_ORIGIN', 'MODERATOR_TOKEN', 'VOTES_PER_ADDRESS', 'VOTE_CAP_MODE', ...OUTREACH_ENV]) { const value = process.env[name]; if (value) bindings[name] = value; }
const options: Record<string, unknown> = { name: 'allworld-local', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01',
  durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: storage, bindings,
  // The same asset rules as wrangler.jsonc: the Worker runs first, and an unknown path is the game's own page.
  assets: { directory: join(root, 'dist'), binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } } };
// The runtime listens on a port of its own choosing; THIS process owns the public port and forwards every connection
// (HTTP and WebSocket alike, byte for byte). So stopping whatever listens on the port stops everything, in order.
const mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: storage, host: '127.0.0.1', port: 0 });
const inner = await mf.ready;
const front = createServer((socket: Socket) => {
  const upstream = connect(Number(inner.port), '127.0.0.1');
  socket.pipe(upstream).pipe(socket);
  for (const end of [socket, upstream]) end.on('error', () => { socket.destroy(); upstream.destroy(); });
});
front.listen(port, '127.0.0.1', () => console.log(`Allworld Worker (Miniflare) listening on http://localhost:${port} · storage ${storage}`));
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  if (stopping) return; stopping = true;
  front.close();
  try { await mf.dispose(); } finally { process.exit(0); }
});
// However the process ends, its scratch folder (the bundle, and the storage when DATA_DIR was not given) goes with it.
process.on('exit', () => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* nothing to remove */ } });
