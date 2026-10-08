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
  assert.equal(directive(policy, 'script-src'), `script-src 'self' ${scriptHashes.join(' ')} https://static.cloudflareinsights.com`);
  assert.ok(!/unsafe-eval/.test(policy) && !/script-src[^;]*unsafe-inline/.test(policy));
  assert.equal(directive(policy, 'connect-src'), "connect-src 'self' wss://joinallworld.com https://cloudflareinsights.com");
  for (const wanted of ["default-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'", "media-src 'self' blob:", "worker-src 'self' blob:", "manifest-src 'self'", "base-uri 'self'", "form-action 'self'", "object-src 'none'", "frame-ancestors 'none'", 'upgrade-insecure-requests']) assert.ok(policy.split('; ').includes(wanted), wanted);
  assert.deepEqual(policy.match(/https?:\/\/[^\s;]+/g), ['https://static.cloudflareinsights.com', 'https://cloudflareinsights.com'], 'without telemetry the only outside hosts are the edge analytics beacon\'s two');
});

test('avatar decoding opts into Wasm and blob connections without allowing JavaScript eval or widening other pages', () => {
  const facts = { secure: true, host: 'joinallworld.com', scriptHashes: [] };
  const plain = appContentSecurityPolicy(facts);
  const avatars = appContentSecurityPolicy({ ...facts, avatarAssets: true });
  const admin = appContentSecurityPolicy({ ...facts, avatarAssets: true, admin: true });
  assert.equal(directive(avatars, 'script-src'), "script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com");
  assert.equal(directive(avatars, 'connect-src'), "connect-src 'self' blob: wss://joinallworld.com https://cloudflareinsights.com");
  for (const policy of [plain, avatars, admin]) {
    assert.ok(!directive(policy, 'script-src').includes("'unsafe-eval'"));
    assert.ok(!directive(policy, 'script-src').includes("'unsafe-inline'"));
  }
  for (const policy of [plain, admin]) {
    assert.ok(!directive(policy, 'script-src').includes("'wasm-unsafe-eval'"));
    assert.ok(!directive(policy, 'connect-src').includes('blob:'));
  }
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
  assert.equal(directive(policy, 'connect-src'), "connect-src 'self' wss://joinallworld.com https://us.i.posthog.com https://cloudflareinsights.com");
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
    assert.equal(directive(csp, 'script-src'), `script-src 'self' ${hashes.join(' ')} 'wasm-unsafe-eval' https://static.cloudflareinsights.com`, path);
    assert.match(directive(csp, 'connect-src'), /^connect-src 'self' blob: wss:\/\/127\.0\.0\.1:\d+ ws:\/\/127\.0\.0\.1:\d+ https:\/\/o123\.ingest\.example-sentry\.test https:\/\/eu\.i\.example-posthog\.test https:\/\/cloudflareinsights\.com$/, 'telemetry configured: its hosts and the declared avatar decoder are allowed');
    assert.deepEqual([response.headers.get('x-frame-options'), response.headers.get('x-content-type-options'), response.headers.get('referrer-policy'), response.headers.get('cross-origin-opener-policy'), response.headers.get('strict-transport-security')], ['DENY', 'nosniff', 'strict-origin-when-cross-origin', 'same-origin', null], `${path}: localhost is not sent HSTS`);
    assert.match(response.headers.get('permissions-policy') as string, /microphone=\(self\)/);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    await response.arrayBuffer();
  }
  const port = Number(new URL(f.base).port);
  const secure = await getAs(port, '/some/deep/link', { host: 'play.example', 'x-forwarded-proto': 'https' });
  assert.equal(secure.headers['strict-transport-security'], 'max-age=31536000; includeSubDomains');
  assert.match(secure.headers['content-security-policy'] as string, /connect-src 'self' blob: wss:\/\/play\.example https:\/\/o123/);
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
  assert.deepEqual((response.headers.get('content-security-policy') as string).match(/https:\/\/[^\s;]+/g), ['https://static.cloudflareinsights.com', 'https://cloudflareinsights.com']);
  await response.arrayBuffer();
});

const ACCOUNTS_ENV = { ACCOUNTS_FIREBASE_PROJECT_ID: 'demo-allworld-test', ACCOUNTS_FIREBASE_API_KEY: 'AIzaFakeFakeFakeFakeFakeFakeFakeFake1', ACCOUNTS_GOOGLE_CLIENT_ID: '123456789012-fakefakefake.apps.googleusercontent.com' };

test('accounts widen the policy only when configured: the identity endpoints, then Google’s button, and the popup-friendly opener policy', async () => {
  const facts = { secure: true, host: 'joinallworld.com', scriptHashes: ["'sha256-x'"] };
  const off = appHeaders(facts), none = appHeaders({ ...facts, accounts: null });
  assert.deepEqual(none, off, 'null is the same as unset');
  assert.equal(off['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.ok(!/googleapis|google\.com|frame-src/.test(off['Content-Security-Policy'] as string), 'unconfigured: exactly the strict policy');
  const email = appHeaders({ ...facts, accounts: { projectId: 'demo-allworld-test', apiKey: 'k'.repeat(30), googleClientId: '' } });
  const emailPolicy = email['Content-Security-Policy'] as string;
  assert.equal(directive(emailPolicy, 'connect-src'), "connect-src 'self' wss://joinallworld.com https://cloudflareinsights.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com");
  assert.equal(directive(emailPolicy, 'script-src'), "script-src 'self' 'sha256-x' https://static.cloudflareinsights.com");
  assert.equal(directive(emailPolicy, 'frame-src'), '');
  assert.equal(email['Cross-Origin-Opener-Policy'], 'same-origin', 'no Google button, no popup');
  const google = appHeaders({ ...facts, accounts: { projectId: 'demo-allworld-test', apiKey: 'k'.repeat(30), googleClientId: ACCOUNTS_ENV.ACCOUNTS_GOOGLE_CLIENT_ID } });
  const policy = google['Content-Security-Policy'] as string;
  assert.equal(directive(policy, 'script-src'), "script-src 'self' 'sha256-x' https://static.cloudflareinsights.com https://accounts.google.com/gsi/client");
  assert.equal(directive(policy, 'frame-src'), 'frame-src https://accounts.google.com/gsi/');
  assert.equal(directive(policy, 'style-src'), "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style");
  assert.match(directive(policy, 'connect-src'), /https:\/\/accounts\.google\.com\/gsi\/$/);
  assert.equal(google['Cross-Origin-Opener-Policy'], 'same-origin-allow-popups');
  assert.match(policy, /default-src 'self'/); assert.match(policy, /frame-ancestors 'none'/); assert.ok(!/unsafe-eval/.test(policy));
});

test('the Node host: the page carries the strict policy until accounts are configured, then the sign-in additions', async (t) => {
  const dist = await mkdtemp(join(tmpdir(), 'joinallworld-dist-'));
  t.after(() => rm(dist, { recursive: true, force: true }));
  await writeFile(join(dist, 'index.html'), INDEX);
  const plain = await fixture(t, { distDir: dist, env: {}, log: () => {} });
  const off = await fetch(`${plain.base}/`); await off.arrayBuffer();
  assert.ok(!/google/.test(off.headers.get('content-security-policy') as string));
  assert.equal(off.headers.get('cross-origin-opener-policy'), 'same-origin');
  const on = await fixture(t, { distDir: dist, env: ACCOUNTS_ENV, log: () => {} });
  const response = await fetch(`${on.base}/some/deep/link`); await response.arrayBuffer();
  const csp = response.headers.get('content-security-policy') as string;
  assert.match(directive(csp, 'connect-src'), /https:\/\/identitytoolkit\.googleapis\.com https:\/\/securetoken\.googleapis\.com https:\/\/accounts\.google\.com\/gsi\/$/);
  assert.match(directive(csp, 'script-src'), /https:\/\/accounts\.google\.com\/gsi\/client$/);
  assert.equal(directive(csp, 'frame-src'), 'frame-src https://accounts.google.com/gsi/');
  assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
  const api = await fetch(`${on.base}/api/does-not-exist`); await api.arrayBuffer();
  assert.equal(api.headers.get('content-security-policy'), null, 'the API answers carry no page policy');
});

test('the edge analytics beacon is allowed by origin only: its script and its connection, nothing wider', async () => {
  const policy = appContentSecurityPolicy({ secure: true, host: 'joinallworld.com', scriptHashes: ["'sha256-x'"] });
  assert.match(directive(policy, 'script-src'), /(^| )https:\/\/static\.cloudflareinsights\.com( |$)/);
  assert.match(directive(policy, 'connect-src'), /(^| )https:\/\/cloudflareinsights\.com( |$)/);
  assert.ok(!/\*|https:( |;|$)/.test(policy), 'no wildcard and no bare scheme');
  assert.ok(!/cloudflareinsights/.test(directive(policy, 'default-src') + directive(policy, 'img-src') + directive(policy, 'frame-src')), 'only the two directives');
});


test('mutable street manifest revalidates while its immutable version remains cached', async t => {
  const dist = await mkdtemp(join(tmpdir(), 'allworld-street-cache-'));
  t.after(() => rm(dist, { recursive: true, force: true }));
  await mkdir(join(dist, 'assets/street/lagos'), { recursive: true });
  await writeFile(join(dist, 'index.html'), INDEX);
  await writeFile(join(dist, 'assets/street/lagos/manifest.txt'), '{"p":1,"city":"lagos","targetVersion":"street-v1-test"}');
  await writeFile(join(dist, 'assets/street/lagos/manifest-street-v1-test.txt'), '{"v":1}');
  const f = await fixture(t, { distDir: dist, env: {}, log: () => {} });
  for (const path of ['/assets/street/lagos/manifest.txt', '/assets/street/lagos/%6danifest.txt']) {
    const response = await fetch(`${f.base}${path}`);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-cache');
    await response.arrayBuffer();
  }
  const immutable = await fetch(`${f.base}/assets/street/lagos/manifest-street-v1-test.txt`);
  assert.equal(immutable.status, 200); assert.equal(immutable.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  await immutable.arrayBuffer();
});
