// Shared server test fixture: a real server on a random port with a controllable clock.
// Usage is documented in server/routes/index.js ("HOW TO TEST").
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createServer } from './server.js';

export async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'joinallworld-test-'));
  let time = 100000;
  const server = await createServer({ dataDir: dir, now: () => time, sessionTtlMs: 2592000000, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];
  t.after(async () => { for (const ws of sockets) ws.terminate(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await server.store?.close?.().catch(() => {}); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); });
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
  const id = () => `${time}:${randomUUID()}`;
  return { base, request, device, action, socket, joinRoom, id, advance: ms => { time += ms; }, dir, server, now: () => time, flush: () => server.store.flush() };
}
