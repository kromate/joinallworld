// Shared server test fixture: a real server on a random port with a controllable clock.
// Usage is documented in server/routes/index.js ("HOW TO TEST").
import { mkdtemp, rm, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createServer } from './server.js';
import { createStore } from './store.js';

/**
 * File calls a test can break (pass as fixture(t, { disk }) or createStore(dir, { io: disk.io })):
 *   disk.fail = 'ENOSPC'   every write of the data file fails from now on; null heals it
 *   disk.hold()            the next write waits until the returned function is called
 */
export function flakyDisk() {
  const disk = { fail: null, gate: null, writes: 0 };
  disk.hold = () => { let open; const gate = disk.gate = new Promise((done) => { open = done; }); return () => { if (disk.gate === gate) disk.gate = null; open(); }; };
  disk.io = {
    async writeFile(...args) {
      disk.writes += 1;
      const gate = disk.gate;
      if (gate) await gate;
      if (disk.fail) throw Object.assign(new Error(`${disk.fail}: injected write failure`), { code: disk.fail });
      return writeFile(...args);
    },
    rename,
  };
  return disk;
}

export async function fixture(t, { disk, ...options } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'joinallworld-test-'));
  let time = 100000;
  const logs = []; // what the server would have printed: tests read it, and failure-injection tests stay quiet
  const log = (line) => logs.push(String(line));
  const store = disk ? await createStore(dir, { io: disk.io, log, ...(options.lazyFlushMs !== undefined ? { lazyFlushMs: options.lazyFlushMs } : {}) }) : undefined;
  const server = await createServer({ dataDir: dir, now: () => time, sessionTtlMs: 2592000000, ...(store ? { store } : {}), ...(disk ? { log } : {}), ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];
  // Every socket the server still holds is closed first — also ones a test opened by itself — so a test that
  // fails halfway can never leave the teardown waiting for a connection nobody will close.
  t.after(async () => { for (const ws of sockets) ws.terminate(); for (const ws of server.wss?.clients ?? []) ws.terminate(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await server.store?.close?.().catch(() => {}); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); });
  async function request(path, body, cookie) {
    return fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  }
  async function device(name) { const res = await request('/api/session', { name }); return { cookie: res.headers.get('set-cookie').split(';')[0], ...(await res.json()).session }; }
  async function action(cookie, fields) { return (await request('/api/action', { actionId: `${time}:${randomUUID()}`, cityId: 'lagos', ...fields }, cookie)).json(); }
  async function socket(device) {
    const ws = new WebSocket(base.replace('http', 'ws') + '/socket', { headers: { Cookie: device.cookie, Origin: base } });
    sockets.push(ws); const queue = []; const waiting = [];
    ws.on('message', data => { const message = JSON.parse(data.toString()); const wait = waiting.shift(); if (wait) wait(message); else queue.push(message); });
    await once(ws, 'open');
    return { ws, next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(Error('Message timeout')), 2000); waiting.push(message => { clearTimeout(timeout); resolve(message); }); }) };
  }
  async function joinRoom(device) { const peer = await socket(device); peer.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); await peer.next(); return peer; }
  /** A client id / request id as a browser makes one: server time, then a random UUID (server/routes/once.js). */
  const id = () => `${time}:${randomUUID()}`;
  return { base, request, device, action, socket, joinRoom, id, logs, advance: ms => { time += ms; }, dir, server, now: () => time, flush: () => server.store.flush() };
}
