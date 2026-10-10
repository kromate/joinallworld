#!/usr/bin/env node
/**
 * A local, production-like server for the browser journeys (scripts/journeys/run.ts).
 *
 *   node --experimental-strip-types scripts/journeys/serve.ts --port 4311 --data <folder> --cookie-file <file>
 *
 * It serves the built page from dist/ with the real routes and a real data folder, and has one addition for tests: the
 * sign-in provider is the stand-in of server/accounts/test-tokens.ts (no outside request is ever made), and a founder
 * account is signed in on a separate session whose cookie is written to --cookie-file. That session is the authenticated
 * admin wallet route a test uses to fund a player once. Nothing here is read from an environment file.
 * The same data folder can be served again after a stop: the founder cookie is checked and re-made only when needed.
 */
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from '../../server/server.ts';
import { claimsFor, fakeProvider, makeKey, signToken } from '../../server/accounts/test-tokens.ts';
import { createServerTelemetry } from '../../server/telemetry/index.ts';

const arg = (name: string, fallback?: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? process.argv[at + 1] : fallback;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
};
const port = Number(arg('port')), dataDir = resolve(arg('data')), cookieFile = resolve(arg('cookie-file'));
const PROJECT = 'allworld-journey-local', FOUNDER = 'journey-founder@example.test';
const env = {
  ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT,
  ACCOUNTS_FIREBASE_API_KEY: 'journey-local-api-key-0000000000000000000000',
  FOUNDER_EMAIL_SHA256: createHash('sha256').update(FOUNDER).digest('hex'),
  NEW_SESSIONS_PER_ADDRESS: '1000',
};
const key = await makeKey('journey-local-key');
const provider = fakeProvider([key]);
const server = await createServer({
  dataDir, distDir: resolve('dist'), env, publicOrigin: `http://127.0.0.1:${port}`,
  telemetry: createServerTelemetry({ env: {}, now: Date.now }),
  fetch: (url, init) => provider.fetch(url, init as { body?: unknown }),
});
server.listen(port, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${port}`;
const call = (path: string, body?: unknown, cookie?: string) => fetch(base + path, {
  method: body ? 'POST' : 'GET',
  headers: { Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

async function founderCookie(): Promise<string> {
  const saved = await readFile(cookieFile, 'utf8').catch(() => '');
  if (saved && (await call('/api/admin/me', undefined, saved)).status === 200) return saved;
  const guest = await call('/api/session', { name: 'Fixture founder' });
  const cookie = guest.headers.get('set-cookie')?.split(';')[0] ?? '';
  await call('/api/life?city=lagos', undefined, cookie);
  const state = await (await call('/api/account', undefined, cookie)).json() as { csrf: string };
  const idToken = await signToken(key, claimsFor(PROJECT, Date.now(), { subject: 'JourneyFounder', email: FOUNDER, n: Date.now() }));
  const signed = await call('/api/account/sign-in', { csrf: state.csrf, idToken }, cookie);
  const next = signed.headers.get('set-cookie')?.split(';')[0] ?? '';
  if (signed.status !== 200 || !next || (await call('/api/admin/me', undefined, next)).status !== 200) throw new Error(`The fixture founder could not sign in (${signed.status}).`);
  return next;
}
await writeFile(cookieFile, await founderCookie(), { mode: 0o600 });
console.log(`journey server ready ${base} ${randomUUID().slice(0, 8)}`);

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  const deadline = setTimeout(() => process.exit(0), 20000); deadline.unref();
  try { server.closeIdleConnections(); for (const ws of server.wss.clients) ws.terminate(); } catch { /* closing */ }
  server.flush().finally(() => process.exit(0));
});
