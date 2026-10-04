#!/usr/bin/env node
/**
 * A local stand-in for Sentry and PostHog: it records what the game WOULD send, so the wiring and
 * the scrubbing can be checked on one machine without an account, a key or a network.
 *
 *   node scripts/telemetry-capture.ts            # listens on 127.0.0.1:3361 and prints each event
 *
 *   # then, in another shell, a game server pointed at it (fake keys; TELEMETRY_DEBUG lets localhost run):
 *   TELEMETRY_ENV=dev TELEMETRY_DEBUG=1 BUILD_ID=local \
 *   SENTRY_DSN_CLIENT=http://client@127.0.0.1:3361/11 SENTRY_DSN_SERVER=http://server@127.0.0.1:3361/22 \
 *   POSTHOG_KEY=phc_local_capture POSTHOG_HOST=http://127.0.0.1:3361 npm start
 *
 *   GET    /__captured   everything recorded so far, as JSON
 *   DELETE /__captured   forget it
 *
 * It answers every request with 200 and permissive CORS, stores nothing on disk and talks to nobody.
 * `startCapture({ port })` is the same thing for a script.
 */
import http from 'node:http';
import type { Server } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** One recorded request, as `/__captured` returns it. */
interface CapturedBase {
  at: number; method: string; path: string; query: string; agent: string; origin: string; hasCookie: boolean; auth: string;
}
type Decoded =
  | { kind: 'sentry'; lines: unknown[] }
  | { kind: 'posthog'; json: unknown }
  | { kind: 'other'; text: string };
export type CapturedEntry = CapturedBase & Decoded;

/** Narrow a parsed value to a plain object so its fields can be read. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

export interface CaptureOptions { port?: number; host?: string; log?: (line: string) => void }
export interface Capture { server: Server; captured: CapturedEntry[]; close: () => Promise<void> }

function decode(buffer: Buffer, request: http.IncomingMessage, url: URL): Decoded {
  let bytes: Buffer = buffer;
  if (request.headers['content-encoding'] === 'gzip' || url.searchParams.get('compression') === 'gzip-js' || (bytes[0] === 0x1f && bytes[1] === 0x8b)) { try { bytes = gunzipSync(bytes); } catch { /* not gzip after all */ } }
  const text = bytes.toString('utf8');
  if (url.pathname.includes('/envelope')) return { kind: 'sentry', lines: text.split('\n').filter(Boolean).map((line): unknown => { try { return JSON.parse(line); } catch { return line; } }) };
  try { return { kind: 'posthog', json: JSON.parse(text) }; } catch { return { kind: 'other', text: text.slice(0, 2000) }; }
}

/** One line per recorded request: which service, from where, and the names of what it carried. */
function summary(entry: CapturedEntry): string {
  const from = /node|undici/i.test(entry.agent) || !entry.agent ? 'server ' : 'browser';
  if (entry.kind === 'sentry') {
    const event = asRecord(entry.lines[2]);
    const values = asRecord(event.exception).values;
    const first = asRecord(Array.isArray(values) ? values[0] : undefined);
    return `sentry  ${from} ${asRecord(entry.lines[1]).type ?? '?'}: ${first.type ?? ''} ${first.value ?? event.message ?? event.transaction ?? ''}`.trim();
  }
  if (entry.kind === 'posthog') {
    const wrapped = asRecord(entry.json).batch;
    const batch: unknown[] = Array.isArray(entry.json) ? entry.json : Array.isArray(wrapped) ? wrapped : [entry.json];
    return `posthog ${from} ${batch.map((event) => asRecord(event).event).join(', ')}`;
  }
  return `other   ${from} ${entry.method} ${entry.path}`;
}

export function startCapture({ port = 3361, host = '127.0.0.1', log = console.log }: CaptureOptions = {}): Promise<Capture> {
  const captured: CapturedEntry[] = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    const cors = { 'Access-Control-Allow-Origin': request.headers.origin || '*', 'Access-Control-Allow-Headers': request.headers['access-control-request-headers'] || '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Credentials': 'true' };
    if (url.pathname === '/__captured') {
      if (request.method === 'DELETE') captured.length = 0;
      response.writeHead(200, { 'Content-Type': 'application/json', ...cors }); response.end(JSON.stringify(captured)); return;
    }
    if (request.method === 'OPTIONS') { response.writeHead(204, cors); response.end(); return; }
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const entry: CapturedEntry = { at: Date.now(), method: request.method ?? '', path: url.pathname, query: url.search, agent: request.headers['user-agent'] || '', origin: request.headers.origin || '',
        hasCookie: Boolean(request.headers.cookie), auth: String(request.headers['x-sentry-auth'] || ''), ...decode(Buffer.concat(chunks), request, url) };
      captured.push(entry);
      log(summary(entry));
      response.writeHead(200, { 'Content-Type': 'application/json', ...cors }); response.end('{"status":1}');
    });
  });
  return new Promise<Capture>((ready) => server.listen(port, host, () => ready({ server, captured, close: () => new Promise<void>((done) => { server.closeAllConnections?.(); server.close(() => done()); }) })));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.CAPTURE_PORT) || 3361;
  await startCapture({ port });
  console.log(`Telemetry capture listening on http://127.0.0.1:${port} — nothing it receives leaves this machine.`);
}
