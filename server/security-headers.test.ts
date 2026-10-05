import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './test-fixture.ts';
import core from './routes/core.ts';
import { appContentSecurityPolicy, appHeaders, apiHeaders, inlineScriptHashes, isLocalHost, pageHeaders, telemetryOrigins } from './security-headers.ts';
import { readTelemetryConfig } from './telemetry/config.ts';
import type { PageHandler, RouteModule } from './types.ts';

const INDEX = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const sha = (text: string): string => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
const TELEMETRY_ENV = { TELEMETRY_ENV: 'production', SENTRY_DSN_CLIENT: 'https://abcdef0123456789@o123.ingest.example-sentry.test/456', POSTHOG_KEY: 'phc_fakefakefake', POSTHOG_HOST: 'https://eu.i.example-posthog.test' };
const directive = (policy: string, name: string): string => policy.split('; ').find((part) => part.startsWith(`${name} `)) ?? '';

test('the inline scripts are hashed from the page itself; data blocks and external scripts are not scripts', async () => {
  const bodies = [...INDEX.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] as string);
  assert.equal(bodies.length, 2, 'index.html has two inline scripts (the early error buffer and the unsupported-browser notice)');
  assert.deepEqual(await inlineScriptHashes(INDEX), bodies.map(sha));
  assert.deepEqual(await inlineScriptHashes('<script type="application/ld+json">{"a":1}</script><script type="module" src="/x.js"></script><script src="/y.js"></script><script></script>'), []);
  assert.deepEqual(await inlineScriptHashes('<script type="module">import("/a.js")</script>'), [sha('import("/a.js")')]);
  assert.notDeepEqual(await inlineScriptHashes(INDEX.replace('q.length<10', 'q.length<11')), await inlineScriptHashes(INDEX), 'a changed script changes its hash');
});

test('the game page policy: only what the app needs, scripts by hash, never unsafe-inline or unsafe-eval for scripts', async () => {
  const scriptHashes = await inlineScriptHashes(INDEX);
  const policy = appContentSecurityPolicy({ secure: true, host: 'joinallworld.com', scriptHashes });
  assert.equal(directive(policy, 'script-src'), `script-src 'self' ${scriptHashes.join(' ')}`);
  assert.ok(!/unsafe-eval/.test(policy) && !/script-src[^;]*unsafe-inline/.test(policy));
  assert.equal(directive(policy, 'connect-src'), "connect-src 'self' wss://joinallworld.com");
  for (const wanted of ["default-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'", "media-src 'self' blob:", "worker-src 'self' blob:", "manifest-src 'self'", "base-uri 'self'", "form-action 'self'", "object-src 'none'", "frame-ancestors 'none'", 'upgrade-insecure-requests']) assert.ok(policy.split('; ').includes(wanted), wanted);
  assert.ok(!/https?:\/\//.test(policy), 'no outside host without telemetry');
});

test('HTTPS adds Strict-Transport-Security and upgrade-insecure-requests; a developer machine and plain HTTP get neither', async () => {
  const base = { scriptHashes: [] };
  const live = appHeaders({ ...base, secure: true, host: 'joinallworld.com' });
  assert.equal(live['Strict-Transport-Security'], 'max-age=31536000; includeSubDomains');
  assert.match(live['Content-Security-Policy'] as string, /upgrade-insecure-requests/);
  for (const facts of [{ secure: true, host: 'localhost:3000' }, { secure: false, host: 'joinallworld.com' }, { secure: true, host: '127.0.0.1:8787' }, { secure: false }]) {
    const headers = appHeaders({ ...base, ...facts });
    assert.equal(headers['Strict-Transport-Security'], undefined, JSON.stringify(facts));
    assert.ok(!/upgrade-insecure-requests/.test(headers['Content-Security-Policy'] as string), JSON.stringify(facts));
  }
  assert.match(appContentSecurityPolicy({ ...base, secure: false, host: 'localhost:3000' }), /connect-src 'self' wss:\/\/localhost:3000 ws:\/\/localhost:3000/);
  assert.deepEqual(['localhost', 'localhost:80', '127.0.0.1', '[::1]:3000', 'joinallworld.com', 'localhost.evil.example'].map(isLocalHost), [true, true, true, true, false, false]);
  assert.equal(live['X-Frame-Options'], 'DENY'); assert.equal(live['X-Content-Type-Options'], 'nosniff');
  assert.equal(live['Referrer-Policy'], 'strict-origin-when-cross-origin'); assert.equal(live['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.match(live['Permissions-Policy'] as string, /microphone=\(self\), geolocation=\(self\), camera=\(\), payment=\(\), usb=\(\)/);
});

test('telemetry hosts reach connect-src only when telemetry is configured, from the same configuration the client is given', async () => {
  assert.deepEqual(telemetryOrigins(readTelemetryConfig({})), []);
  assert.deepEqual(telemetryOrigins(readTelemetryConfig({ TELEMETRY_ENV: 'production' })), [], 'an environment alone configures nothing');
  assert.deepEqual(telemetryOrigins(readTelemetryConfig({ ...TELEMETRY_ENV, TELEMETRY_ENV: 'dev' })), [], 'dev without the debug switch stays off');
  assert.deepEqual(telemetryOrigins(readTelemetryConfig({ ...TELEMETRY_ENV, SENTRY_DSN_SERVER: 'https://k@server.example-sentry.test/9' })).sort(), ['https://eu.i.example-posthog.test', 'https://o123.ingest.example-sentry.test'], 'the server project DSN is never sent to a browser');
  const only = telemetryOrigins(readTelemetryConfig({ TELEMETRY_ENV: 'production', POSTHOG_KEY: 'phc_fakefakefake' }));
  assert.deepEqual(only, ['https://us.i.posthog.com'], 'the default PostHog host');
  const policy = appContentSecurityPolicy({ secure: true, host: 'joinallworld.com', scriptHashes: [], telemetry: only });
  assert.equal(directive(policy, 'connect-src'), "connect-src 'self' wss://joinallworld.com https://us.i.posthog.com");
});

test('module pages and API answers have their own sets', () => {
  const page = pageHeaders({ secure: true, host: 'joinallworld.com' });
  assert.equal(page['Referrer-Policy'], 'no-referrer'); assert.equal(page['X-Robots-Tag'], 'noindex, nofollow');
  assert.match(page['Content-Security-Policy'] as string, /^default-src 'none'; .*frame-ancestors 'none'; upgrade-insecure-requests$/);
  assert.ok(!/script-src/.test(page['Content-Security-Policy'] as string));
  assert.deepEqual(apiHeaders({ secure: true, host: 'joinallworld.com' }), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' });
  assert.equal(apiHeaders({ secure: false, host: 'localhost' })['Strict-Transport-Security'], undefined);
});

const pageRoutes: RouteModule = (ctx) => { ctx.pages?.set('/p/', (async () => ({ status: 200, html: '<p>page</p>' })) satisfies PageHandler); return {}; };

/** A GET with a Host of our choosing (fetch cannot set one). */
const getAs = (port: number, path: string, headers: Record<string, string>): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> => new Promise((resolve, reject) => {
  const req = httpRequest({ host: '127.0.0.1', port, path, headers }, (res) => { let body = ''; res.setEncoding('utf8'); res.on('data', (chunk: string) => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body })); });
  req.on('error', reject); req.end();
});

test('the Node host: the page and its deep links, a module page, the API and a static file', async (t) => {
  const dist = await mkdtemp(join(tmpdir(), 'joinallworld-dist-'));
  t.after(() => rm(dist, { recursive: true, force: true }));
  await mkdir(join(dist, 'assets'));
  await writeFile(join(dist, 'index.html'), INDEX);
  await writeFile(join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
  const f = await fixture(t, { distDir: dist, routes: [core, pageRoutes], trustProxy: true, env: TELEMETRY_ENV, log: () => {} });
  const hashes = await inlineScriptHashes(INDEX);
  for (const path of ['/', '/some/deep/link']) {
    const response = await fetch(`${f.base}${path}`);
    assert.equal(response.status, 200);
    const csp = response.headers.get('content-security-policy') as string;
    assert.equal(directive(csp, 'script-src'), `script-src 'self' ${hashes.join(' ')}`, path);
    assert.match(directive(csp, 'connect-src'), /^connect-src 'self' wss:\/\/127\.0\.0\.1:\d+ ws:\/\/127\.0\.0\.1:\d+ https:\/\/o123\.ingest\.example-sentry\.test https:\/\/eu\.i\.example-posthog\.test$/, 'telemetry configured: its hosts are allowed');
    assert.deepEqual([response.headers.get('x-frame-options'), response.headers.get('x-content-type-options'), response.headers.get('referrer-policy'), response.headers.get('cross-origin-opener-policy'), response.headers.get('strict-transport-security')], ['DENY', 'nosniff', 'strict-origin-when-cross-origin', 'same-origin', null], `${path}: localhost is not sent HSTS`);
    assert.match(response.headers.get('permissions-policy') as string, /microphone=\(self\)/);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    await response.arrayBuffer();
  }
  const port = Number(new URL(f.base).port);
  const secure = await getAs(port, '/some/deep/link', { host: 'play.example', 'x-forwarded-proto': 'https' });
  assert.equal(secure.headers['strict-transport-security'], 'max-age=31536000; includeSubDomains');
  assert.match(secure.headers['content-security-policy'] as string, /connect-src 'self' wss:\/\/play\.example https:\/\/o123/);
  assert.match(secure.headers['content-security-policy'] as string, /upgrade-insecure-requests$/);
  const head = await fetch(`${f.base}/`, { method: 'HEAD' });
  assert.equal(head.headers.get('content-security-policy'), (await fetch(`${f.base}/`).then(async (r) => { await r.arrayBuffer(); return r.headers.get('content-security-policy'); })), 'HEAD gets the same policy');
  const page = await getAs(port, '/p/x', { host: 'play.example', 'x-forwarded-proto': 'https' });
  assert.match(page.headers['content-security-policy'] as string, /^default-src 'none'; .*upgrade-insecure-requests$/);
  assert.deepEqual([page.headers['strict-transport-security'], page.headers['referrer-policy'], page.headers['cross-origin-opener-policy']], ['max-age=31536000; includeSubDomains', 'no-referrer', 'same-origin']);
  const api = await getAs(port, '/api/does-not-exist', { host: 'play.example', 'x-forwarded-proto': 'https' });
  assert.deepEqual([api.status, api.headers['cache-control'], api.headers['x-content-type-options'], api.headers['cross-origin-resource-policy'], api.headers['strict-transport-security']], [404, 'no-store', 'nosniff', 'same-origin', 'max-age=31536000; includeSubDomains']);
  const local = await fetch(`${f.base}/api/does-not-exist`);
  assert.deepEqual([local.headers.get('cross-origin-resource-policy'), local.headers.get('strict-transport-security')], ['same-origin', null]);
  await local.arrayBuffer();
  const asset = await fetch(`${f.base}/assets/app-abc123.js`);
  assert.deepEqual([asset.headers.get('x-content-type-options'), asset.headers.get('content-security-policy')], ['nosniff', null]);
  await asset.arrayBuffer();
});

test('the Node host without telemetry: no outside host in the policy', async (t) => {
  const dist = await mkdtemp(join(tmpdir(), 'joinallworld-dist-'));
  t.after(() => rm(dist, { recursive: true, force: true }));
  await writeFile(join(dist, 'index.html'), INDEX);
  const f = await fixture(t, { distDir: dist, env: {}, log: () => {} });
  const response = await fetch(`${f.base}/`);
  assert.ok(!/https:\/\//.test(response.headers.get('content-security-policy') as string));
  await response.arrayBuffer();
});
