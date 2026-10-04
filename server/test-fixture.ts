// Shared server test fixture: a real server on a random port with a controllable clock.
// Usage is documented in server/routes/index.ts ("HOW TO TEST").
import { mkdtemp, rm, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createServer } from './server.ts';
import { createStore } from './store.ts';
import type { StoreOptions } from './store.ts';
import type { ServerOptions, AllworldServer } from './server.ts';
import type { TestContext } from 'node:test';
import type { ActionResponse, PublicSession, ServerFrame, SessionResponse } from '../src/types/protocol.ts';
import type { ActionRequest } from '../src/types/protocol.ts';
import type { ActionType } from '../src/types/actions.ts';

/** A request body a test sends on purpose in a shape the client never would (a refusal test): any fields beside the type. */
export interface ActionAttempt { type: ActionType; [field: string]: unknown }

/** File calls a test can break (see flakyDisk). */
export interface FlakyDisk {
  /** An error code (`'ENOSPC'`); null when writes work. */
  fail: string | null
  gate: Promise<void> | null
  /** How many writes were attempted. */
  writes: number
  /** The next write waits until the returned function is called. */
  hold(): () => void
  io: { writeFile: NonNullable<NonNullable<StoreOptions['io']>['writeFile']>; rename: NonNullable<NonNullable<StoreOptions['io']>['rename']> }
}
/** What a test passes to fixture(): the server options, plus a disk it can break. */
export type FixtureOptions = ServerOptions & { disk?: FlakyDisk };
/** A signed-in device: its cookie and its public identity. */
export type Device = PublicSession & { cookie: string };
/** A socket a test holds: the ws WebSocket and a reader of the frames the server sent it. */
export interface TestSocket { ws: WebSocket; next(): Promise<ServerFrame> }

/**
 * File calls a test can break (pass as fixture(t, { disk }) or createStore(dir, { io: disk.io })):
 *   disk.fail = 'ENOSPC'   every write of the data file fails from now on; null heals it
 *   disk.hold()            the next write waits until the returned function is called
 */
export function flakyDisk(): FlakyDisk {
  const disk: FlakyDisk = {
    fail: null, gate: null, writes: 0,
    hold: () => { let open: () => void = () => {}; const gate = disk.gate = new Promise<void>((done) => { open = done; }); return () => { if (disk.gate === gate) disk.gate = null; open(); }; },
    io: {
      async writeFile(path, text, options) {
        disk.writes += 1;
        const gate = disk.gate;
        if (gate) await gate;
        if (disk.fail) throw Object.assign(new Error(`${disk.fail}: injected write failure`), { code: disk.fail });
        return writeFile(path, text, options);
      },
      rename,
    },
  };
  return disk;
}

export async function fixture(t: TestContext, { disk, ...options }: FixtureOptions = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'joinallworld-test-'));
  let time = 100000;
  const logs: string[] = []; // what the server would have printed: tests read it, and failure-injection tests stay quiet
  const log = (line: string): void => { logs.push(String(line)); };
  const store = disk ? await createStore(dir, { io: disk.io, log, ...(options.lazyFlushMs !== undefined ? { lazyFlushMs: options.lazyFlushMs } : {}) }) : undefined;
  const server = await createServer({ dataDir: dir, now: () => time, sessionTtlMs: 2592000000, ...(store ? { store } : {}), ...(disk ? { log } : {}), ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The server is not listening on a port');
  const base = `http://127.0.0.1:${address.port}`;
  const sockets: WebSocket[] = [];
  // Every socket the server still holds is closed first — also ones a test opened by itself — so a test that
  // fails halfway can never leave the teardown waiting for a connection nobody will close.
  t.after(async () => { for (const ws of sockets) ws.terminate(); for (const ws of server.wss.clients) ws.terminate(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await server.store.close?.().catch(() => {}); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); });
  async function request(path: string, body?: unknown, cookie?: string): Promise<Response> {
    return fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  }
  async function device(name: string): Promise<Device> {
    const res = await request('/api/session', { name });
    const header = res.headers.get('set-cookie');
    if (header === null) throw new TypeError('The session answer set no cookie');
    // The server under test answers with its documented session shape.
    return { cookie: header.split(';')[0] ?? '', ...((await res.json()) as SessionResponse).session };
  }
  async function action(cookie: string, fields: (Partial<ActionRequest> & Pick<ActionRequest, 'type'>) | ActionAttempt): Promise<ActionResponse & { error?: string }> { return (await request('/api/action', { actionId: `${time}:${randomUUID()}`, cityId: 'lagos', ...fields }, cookie)).json() as Promise<ActionResponse & { error?: string }>; }
  async function socket(device: { cookie: string }): Promise<TestSocket> {
    const ws = new WebSocket(base.replace('http', 'ws') + '/socket', { headers: { Cookie: device.cookie, Origin: base } });
    sockets.push(ws); const queue: ServerFrame[] = []; const waiting: ((message: ServerFrame) => void)[] = [];
    ws.on('message', data => { const message = JSON.parse(data.toString()) as ServerFrame; const wait = waiting.shift(); if (wait) wait(message); else queue.push(message); });
    await once(ws, 'open');
    return { ws, next: (): Promise<ServerFrame> => { const first = queue.shift(); return first ? Promise.resolve(first) : new Promise<ServerFrame>((resolve, reject) => { const timeout = setTimeout(() => reject(Error('Message timeout')), 2000); waiting.push(message => { clearTimeout(timeout); resolve(message); }); }); } };
  }
  async function joinRoom(device: { cookie: string }): Promise<TestSocket> { const peer = await socket(device); peer.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); await peer.next(); return peer; }
  /** A client id / request id as a browser makes one: server time, then a random UUID (server/routes/once.ts). */
  const id = () => `${time}:${randomUUID()}`;
  return { base, request, device, action, socket, joinRoom, id, logs, advance: (ms: number): void => { time += ms; }, dir, server, now: () => time, flush: async (): Promise<void> => { await server.store.flush?.(); } };
}
