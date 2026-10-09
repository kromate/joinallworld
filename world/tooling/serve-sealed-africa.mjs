#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { open, mkdtemp, rm, lstat, unlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifySourceAndPackage } from './verify-sealed-africa.mjs';

const HELP = `Usage: node --experimental-strip-types world/tooling/serve-sealed-africa.mjs --source ABSOLUTE_DIR --package ABSOLUTE_DIR --sha 40_HEX --tools ABSOLUTE_DIR --control ABSOLUTE_FILE [--seconds 600]

Starts the exact sealed Worker bytes and packaged ASSETS on a finite 127.0.0.1 Miniflare listener with a fresh SQLite store. Writes the synthetic founder admin cookie to an exclusive mode-0600 control file for the authorized native journey only. The file is removed when the stage stops.

This is a local synthetic staging fixture, not production continuity, deployment, or release approval.`;
const SOURCE_SHA = /^[a-f0-9]{40}$/;
const FOUNDER = 'africa-founder@example.test';
const PROJECT = 'allworld-africa-worker-test';
const REQUEST_LIMIT_MS = 20_000;
const DISPOSE_LIMIT_MS = 10_000;
const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const object = value => { assert.ok(isRecord(value), 'expected object response'); return value; };
const sha256 = value => createHash('sha256').update(value).digest('hex');

function argumentsOf(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!['--source', '--package', '--sha', '--tools', '--control', '--seconds'].includes(flag) || Object.hasOwn(result, flag)) throw new Error(`unknown or duplicate argument: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
    result[flag] = value;
    index += 1;
  }
  for (const flag of ['--source', '--package', '--sha', '--tools', '--control']) if (!result[flag]) throw new Error(`missing ${flag}`);
  for (const flag of ['--source', '--package', '--tools', '--control']) if (!isAbsolute(result[flag])) throw new Error(`${flag} must be absolute`);
  if (!SOURCE_SHA.test(result['--sha'])) throw new Error('--sha must be exactly 40 lowercase hexadecimal characters');
  const seconds = result['--seconds'] === undefined ? 600 : Number(result['--seconds']);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 900) throw new Error('--seconds must be an integer from 1 to 900');
  return { source: resolve(result['--source']), packageRoot: resolve(result['--package']), sha: result['--sha'], tools: resolve(result['--tools']), control: resolve(result['--control']), seconds };
}

async function within(label, operation, limitMs = REQUEST_LIMIT_MS) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), limitMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

async function writeControl(path, value) {
  const handle = await open(path, 'wx', 0o600);
  let identity;
  try {
    const stat = await handle.stat();
    identity = { dev: stat.dev, ino: stat.ino };
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    return identity;
  } catch (error) {
    await handle.close().catch(() => {});
    if (identity) await removeOwnedControl(path, identity).catch(() => {});
    throw error;
  }
}

async function removeOwnedControl(path, identity) {
  if (!identity) return;
  try {
    const current = await lstat(path);
    if (current.isFile() && current.dev === identity.dev && current.ino === identity.ino) await unlink(path);
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

async function main(args) {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'run with Node 24 or newer and --experimental-strip-types');
  const checked = verifySourceAndPackage(args);
  const require = createRequire(join(args.tools, 'package.json'));
  const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
  assert.equal(typeof Miniflare, 'function', 'pinned Miniflare is unavailable from --tools');
  assert.equal(typeof convertV4MiniflareOptions, 'function', 'Miniflare config converter is unavailable');

  const [testTokens, tokenModule] = await Promise.all([
    import(pathToFileURL(join(args.source, 'server/accounts/test-tokens.ts')).href),
    import(pathToFileURL(join(args.source, 'server/accounts/token.ts')).href),
  ]);
  const key = await within('synthetic provider key generation', testTokens.makeKey('africa-native-stage-test-key'));
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-sealed-africa-stage-'));
  const storagePath = join(folder, 'sqlite');
  const responseBodies = new Set();
  let worker;
  let controlIdentity;
  let finished;
  let deadlineTimer;
  const removeSignals = [];
  const cancelUnusedBodies = async () => {
    for (const response of responseBodies) if (response.body && !response.bodyUsed) await response.body.cancel().catch(() => {});
    responseBodies.clear();
  };
  const dispose = async () => {
    if (!worker) return;
    const previous = worker;
    worker = null;
    await within('Miniflare disposal', previous.dispose(), DISPOSE_LIMIT_MS);
  };
  try {
    const options = {
      name: 'joinallworld-sealed-africa-stage', script: await readFile(join(args.packageRoot, 'worker.js'), 'utf8'),
      modules: true, compatibilityDate: '2026-10-01', host: '127.0.0.1', port: 0,
      durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } },
      durableObjectsPersist: storagePath, resourcePersistencePath: storagePath,
      bindings: { BUILD_ID: `joinallworld-${args.sha}`, ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT,
        ACCOUNTS_FIREBASE_API_KEY: 'africa-edge-test-api-key-0000000000000000000000',
        FOUNDER_EMAIL_SHA256: sha256(FOUNDER) },
      assets: { directory: join(args.packageRoot, 'assets'), binding: 'ASSETS', run_worker_first: true,
        routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } },
      outboundService: async request => {
        const url = new URL(request.url);
        if (url.href.split('?')[0] === tokenModule.TOKEN_KEYS_URL) return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
        throw new Error('sealed Africa staging refuses every non-fixture outbound request');
      },
      handleStructuredLogs: () => {},
    };
    worker = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: storagePath, host: '127.0.0.1', port: 0, handleStructuredLogs: () => {} });
    const ready = await within('Miniflare startup', worker.ready);
    const stageUrl = ready instanceof URL ? ready : new URL(String(ready));
    assert.equal(stageUrl.protocol, 'http:', 'stage listener must use HTTP on loopback');
    assert.equal(stageUrl.hostname, '127.0.0.1', 'stage listener must bind to 127.0.0.1 only');
    assert.ok(Number(stageUrl.port) > 0, 'Miniflare must choose an ephemeral port');
    const origin = stageUrl.origin;
    const ips = { next: 0 };
    const send = async (path, body, cookie) => {
      const controller = new AbortController();
      let timedOut = false;
      const dispatch = worker.dispatchFetch(origin + path, {
        method: body ? 'POST' : 'GET', signal: controller.signal,
        headers: { origin, 'cf-connecting-ip': `198.51.100.${(ips.next++ % 250) + 1}`,
          ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }).then(async response => {
        responseBodies.add(response);
        if (timedOut && response.body) await response.body.cancel().catch(() => {});
        return response;
      });
      let timer;
      try {
        return await Promise.race([dispatch, new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error(`Worker ${path} timed out`)); }, REQUEST_LIMIT_MS); })]);
      } finally { if (timer) clearTimeout(timer); }
    };
    const json = async (label, response) => {
      assert.equal(response.status, 200, `${label} returned ${response.status}`);
      return object(await within(`${label} response body`, response.json()));
    };
    const guest = await send('/api/session', { name: 'Africa native staging founder' });
    const guestCookie = guest.headers.get('set-cookie')?.split(';')[0];
    assert.ok(guestCookie, 'synthetic founder guest cookie');
    await guest.body?.cancel().catch(() => {});
    await json('founder guest life', await send('/api/life?city=lagos', undefined, guestCookie));
    const account = await json('founder account state', await send('/api/account', undefined, guestCookie));
    const idToken = await testTokens.signToken(key, testTokens.claimsFor(PROJECT, Date.now(), {
      subject: 'AfricaFixtureFounder', email: FOUNDER, n: 1,
    }));
    const signedIn = await send('/api/account/sign-in', { csrf: account.csrf, idToken }, guestCookie);
    const founderCookie = signedIn.headers.get('set-cookie')?.split(';')[0];
    assert.ok(signedIn.status === 200 && founderCookie, 'synthetic founder authentication succeeds');
    await signedIn.body?.cancel().catch(() => {});
    const root = await json('founder admin identity', await send('/api/admin/me', undefined, founderCookie));
    assert.equal(root.level, 'root', 'control cookie belongs to the synthetic founder admin');

    controlIdentity = await writeControl(args.control, {
      schemaVersion: 1,
      stageUrl: origin,
      sourceSha: args.sha,
      packageDigest: checked.packageDigest,
      packageManifestSourceSha: checked.manifest.sourceSha,
      founderCookieForAdminCredit: founderCookie,
    });
    const expiresAt = new Date(Date.now() + args.seconds * 1000).toISOString();
    process.stdout.write(`${JSON.stringify({ stageUrl: origin, buildId: `joinallworld-${args.sha}`, sourceSha: args.sha, packageDigest: checked.packageDigest, deadline: expiresAt })}\n`);
    let resolveFinished;
    finished = new Promise(resolveFinishedFn => { resolveFinished = resolveFinishedFn; });
    const onSignal = signal => { process.stderr.write(`Sealed Africa stage stopping on ${signal}.\n`); resolveFinished(); };
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => onSignal(signal);
      process.once(signal, handler);
      removeSignals.push(() => process.removeListener(signal, handler));
    }
    deadlineTimer = setTimeout(resolveFinished, args.seconds * 1000);
    await finished;
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    for (const remove of removeSignals) remove();
    await cancelUnusedBodies();
    let cleanupFailed = false;
    try { await dispose(); } catch { cleanupFailed = true; }
    try { await removeOwnedControl(args.control, controlIdentity); } catch { cleanupFailed = true; }
    try { await rm(folder, { recursive: true, force: true }); } catch { cleanupFailed = true; }
    if (cleanupFailed) throw new Error('sealed Africa stage cleanup failed');
  }
}

try {
  const args = argumentsOf(process.argv.slice(2));
  if (args.help) process.stdout.write(`${HELP}\n`);
  else await main(args);
} catch (error) {
  const message = error instanceof Error ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 320) : 'stage failed';
  process.stderr.write(`Sealed Africa stage failed: ${message}\n`);
  process.exitCode = 1;
}
