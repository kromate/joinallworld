/**
 * The feature journeys' local lab: the real server of server/server.ts run inside the journey process, on a loopback port with a
 * fresh data folder, the sign-in stand-in of server/accounts/test-tokens.ts (no outside request is ever made), an operator token made
 * up here for the run, and a clock the journey can move forward (the 24-hour waits of the product are played with it, not skipped
 * in the product). A founder account is signed in so the admin routes can fund and verify players.
 */
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from '../../server/server.ts';
import { claimsFor, fakeProvider, makeKey, signToken } from '../../server/accounts/test-tokens.ts';
import { createServerTelemetry } from '../../server/telemetry/index.ts';
import type { Browser } from './cdp.ts';

const PROJECT = 'allworld-journey-local', FOUNDER = 'journey-founder@example.test';
export const OPERATOR = `journey-operator-${randomUUID()}`;

export interface Lab {
  base: string; dir: string; port: number;
  advance(ms: number): void; now(): number; offset(): number;
  /** A JSON call with an optional cookie and extra headers; resolves to { status, ...body }. */
  call(path: string, body?: unknown, cookie?: string, headers?: Record<string, string>): Promise<Record<string, any>>;
  founder: string;
  admin(path: string, body?: unknown): Promise<Record<string, any>>;
  mod(path: string, body?: unknown): Promise<Record<string, any>>;
  /** Signs the page in as an account (stand-in provider); returns nothing, the page keeps the new cookie. */
  signIn(page: Browser, email: string): Promise<void>;
  stop(): Promise<void>;
}

export async function startLab(port: number): Promise<Lab> {
  const dir = mkdtempSync(join(tmpdir(), 'journey-lab-'));
  const dataDir = join(dir, 'data'); mkdirSync(dataDir);
  let offset = 0;
  const now = (): number => Date.now() + offset;
  const env = {
    ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'journey-local-api-key-0000000000000000000000',
    FOUNDER_EMAIL_SHA256: createHash('sha256').update(FOUNDER).digest('hex'), NEW_SESSIONS_PER_ADDRESS: '1000',
  };
  const key = await makeKey('journey-local-key');
  const provider = fakeProvider([key]);
  const server = await createServer({
    dataDir, distDir: resolve('dist'), env, publicOrigin: `http://127.0.0.1:${port}`, moderatorToken: OPERATOR, now,
    telemetry: createServerTelemetry({ env: {}, now }),
    fetch: (url, init) => provider.fetch(url, init as { body?: unknown }),
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${port}`;
  const call: Lab['call'] = async (path, body, cookie, headers = {}) => {
    const res = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    let parsed: Record<string, any> = {};
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 200) }; }
    return { status: res.status, setCookie: res.headers.get('set-cookie')?.split(';')[0] ?? '', ...parsed };
  };
  const token = (email: string): Promise<string> => signToken(key, claimsFor(PROJECT, now(), { subject: `Uid${email.replace(/\W/g, '')}`, email, n: now() + Math.random() }));
  // the founder
  const guest = await call('/api/session', { name: 'Fixture founder' });
  await call('/api/life?city=lagos', undefined, guest.setCookie);
  const acct = await call('/api/account', undefined, guest.setCookie);
  const signed = await call('/api/account/sign-in', { csrf: acct['csrf'], idToken: await token(FOUNDER) }, guest.setCookie);
  const founder = signed['setCookie'] as string;
  if (signed.status !== 200 || !founder || (await call('/api/admin/me', undefined, founder)).status !== 200) throw new Error(`The fixture founder could not sign in (${signed.status}).`);
  writeFileSync(join(dir, 'founder.cookie'), founder, { mode: 0o600 });
  return {
    base, dir, port, advance: (ms) => { offset += ms; }, now, offset: () => offset, call, founder,
    admin: (path, body) => call(path, body, founder),
    mod: (path, body) => call(path, body, undefined, { Authorization: `Bearer ${OPERATOR}` }),
    async signIn(page, email) {
      const idToken = await token(email);
      const out = await page.eval<number>(`(async () => { const a = await fetch('/api/account').then((r) => r.json()); const r = await fetch('/api/account/sign-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csrf: a.csrf, idToken: ${JSON.stringify(idToken)} }) }); return r.status; })()`);
      if (out !== 200) throw new Error(`sign-in answered ${out}`);
    },
    async stop() {
      const deadline = setTimeout(() => process.exit(0), 20000); deadline.unref();
      try { server.closeIdleConnections(); for (const ws of server.wss.clients) ws.terminate(); } catch { /* closing */ }
      await server.flush().catch(() => undefined);
      await new Promise<void>((done) => server.close(() => done()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
