#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { selectAfricaBatches, selectedAssets } from './sealed-africa-coverage.mjs';
import { sealedAdminRateWaitPolicy } from './sealed-admin-rate-policy.mjs';

const HELP = `Usage: node --experimental-strip-types world/tooling/verify-sealed-africa.mjs --source ABSOLUTE_DIR --package ABSOLUTE_DIR --sha 40_HEX --tools ABSOLUTE_DIR

Checks a sealed release package against a clean tracked source checkout, runs the exact packaged Worker bytes with packaged ASSETS and an isolated SQLite Durable Object in Miniflare, and drives every source-exported Africa destination batch and homeward fixture. The inspected legacy source SHA is limited to its original first-five fixture.

This is a local synthetic fixture check. It does not establish production continuity, ordinary guest funding, physical-device behavior, deployment, or release approval.`;
const SOURCE_SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const LIMITS = Object.freeze({ totalMs: 168_000, requestMs: 12_000, startMs: 20_000, restartMs: 15_000, disposeMs: 10_000 });
const ORIGIN = 'https://sealed-africa-journey.test';
const FOUNDER = 'africa-founder@example.test';
const PROJECT = 'allworld-africa-worker-test';
const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const object = value => { assert.ok(isRecord(value), 'expected object response'); return value; };
const sha256 = value => createHash('sha256').update(value).digest('hex');

function argumentsOf(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!['--source', '--package', '--sha', '--tools'].includes(flag) || result[flag]) throw new Error(`unknown or duplicate argument: ${flag}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
    result[flag] = value;
    i += 1;
  }
  for (const flag of ['--source', '--package', '--sha', '--tools']) if (!result[flag]) throw new Error(`missing ${flag}`);
  for (const flag of ['--source', '--package', '--tools']) if (!isAbsolute(result[flag])) throw new Error(`${flag} must be absolute`);
  if (!SOURCE_SHA.test(result['--sha'])) throw new Error('--sha must be exactly 40 lowercase hexadecimal characters');
  return { source: resolve(result['--source']), packageRoot: resolve(result['--package']), sha: result['--sha'], tools: resolve(result['--tools']) };
}

function git(source, ...args) {
  return execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, maxBuffer: 1024 * 1024 }).trim();
}

export function verifySourceAndPackage({ source, packageRoot, sha }) {
  const head = git(source, 'rev-parse', 'HEAD');
  assert.equal(head, sha, 'source HEAD does not equal the requested release SHA');
  assert.equal(git(source, 'status', '--porcelain', '--untracked-files=no'), '', 'source tracked files are not clean');
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'manifest.json'), 'utf8'));
  assert.ok(isRecord(manifest), 'package manifest must be an object');
  assert.equal(manifest.sourceSha, sha, 'package manifest source SHA mismatch');
  assert.equal(typeof manifest.publish, 'boolean', 'package manifest publish field must be boolean');
  const checked = execFileSync(process.execPath, [join(source, 'scripts/guard-joinallworld-package.mjs'), 'check', packageRoot, sha, String(manifest.publish)], {
    cwd: source, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  assert.match(checked, HASH, 'package guard did not return a digest');
  assert.ok(Array.isArray(manifest.files), 'package manifest files must be an array');
  const files = new Map();
  for (const entry of manifest.files) {
    assert.ok(isRecord(entry) && typeof entry.path === 'string' && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && HASH.test(entry.sha256), 'invalid package manifest file entry');
    assert.ok(!files.has(entry.path), `duplicate package manifest path: ${entry.path}`);
    files.set(entry.path, entry);
  }
  assert.ok(files.has('assets/index.html'), 'package manifest must include assets/index.html');
  return { manifest, files, packageDigest: checked };
}

async function checkPackagedAssets(send, packageRoot, selected, evidence, within, absolutePreviewImage) {
  const toCheck = selected.entries;
  for (const entry of toCheck) {
    assert.ok(entry, 'asset record is missing from package manifest');
    const url = entry.path === 'assets/index.html' ? '/' : `/${entry.path.replace(/^assets\//, '')}`;
    const response = await within(`asset request ${entry.path}`, send(url), LIMITS.requestMs);
    try {
      assert.equal(response.status, 200, `${entry.path} must be served by packaged ASSETS`);
      const body = Buffer.from(await within(`asset body ${entry.path}`, response.arrayBuffer(), LIMITS.requestMs));
      const disk = await readFile(join(packageRoot, entry.path));
      assert.equal(sha256(disk), entry.sha256, `${entry.path} on disk differs from its manifest`);
      assert.equal(disk.length, entry.bytes, `${entry.path} on-disk byte count differs from its manifest`);
      // The real Worker makes the HTML preview-image URLs absolute for its request origin.
      const expected = entry.path === 'assets/index.html'
        ? Buffer.from(absolutePreviewImage(disk.toString('utf8'), ORIGIN)) : disk;
      assert.equal(body.length, expected.length, `${entry.path} served byte count differs from the exact expected body`);
      assert.equal(sha256(body), sha256(expected), `${entry.path} served SHA differs from the exact expected body`);
      evidence.assets.push({ path: entry.path, status: 'passed', bytes: entry.bytes, sha256: entry.sha256,
        servedBytes: body.length, servedSha256: sha256(body),
        transform: entry.path === 'assets/index.html' ? 'canonical-preview-image-origin' : 'none' });
    } finally {
      if (response.body && !response.bodyUsed) await response.body.cancel().catch(() => {});
    }
  }
}

function withinFactory(deadlineAt) {
  return async (label, operation, localLimit = LIMITS.requestMs) => {
    const remaining = deadlineAt - Date.now();
    assert.ok(remaining > 0, 'verification exceeded its 168-second total deadline');
    let timer;
    try {
      return await Promise.race([
        operation,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), Math.max(1, Math.min(localLimit, remaining))); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  };
}

async function disposeWithin(worker, limitMs = LIMITS.disposeMs) {
  let timer;
  try {
    await Promise.race([
      worker.dispose(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Miniflare disposal timed out')), limitMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

async function makeHost({ options, Miniflare, convertV4MiniflareOptions, storagePath, currentWorker, setWorker, within, responseBodies, remainingMs, adminRate, evidence }) {
  const { makeKey, claimsFor, signToken } = await currentWorker.testTokens;
  const { TOKEN_KEYS_URL } = currentWorker.tokenModule;
  const key = await within('synthetic test signing key', makeKey('africa-sealed-package-fixture'), LIMITS.startMs);
  const minted = { count: 0 };
  const outbound = async request => {
    const url = new URL(request.url);
    if (url.href.split('?')[0] === TOKEN_KEYS_URL) return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  options.outboundService = outbound;
  const make = () => new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: storagePath, unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} });
  let worker = make();
  setWorker(() => worker);
  await within('Miniflare startup', worker.ready, LIMITS.startMs);
  let address = 0;
  const ips = () => `198.51.100.${(address++ % 250) + 1}`;
  const cancelUnusedBodies = async () => {
    for (const response of responseBodies) {
      if (response.body && !response.bodyUsed) await response.body.cancel().catch(() => {});
    }
    responseBodies.clear();
  };
  const send = async (path, body, cookie) => {
    const active = currentWorker.getWorker();
    const budget = Math.min(LIMITS.requestMs, remainingMs());
    assert.ok(budget > 0, 'verification exceeded its 168-second total deadline');
    const controller = new AbortController();
    let timedOut = false;
    const dispatch = active.dispatchFetch(ORIGIN + path, {
      method: body ? 'POST' : 'GET', signal: controller.signal,
      headers: { origin: ORIGIN, 'cf-connecting-ip': ips(), ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).then(async response => {
      responseBodies.add(response);
      if (timedOut && response.body) await response.body.cancel().catch(() => {});
      return response;
    });
    let timer;
    try {
      return await Promise.race([dispatch, new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error(`Worker ${path} timed out`)); }, budget); })]);
    } finally { if (timer) clearTimeout(timer); }
  };
  const founderGuest = await send('/api/session', { name: 'Africa fixture founder' });
  assert.equal(founderGuest.status, 200);
  const guestCookie = founderGuest.headers.get('set-cookie')?.split(';')[0];
  assert.ok(guestCookie, 'test founder session cookie');
  const initialLife = await send('/api/life?city=lagos', undefined, guestCookie);
  assert.equal(initialLife.status, 200, 'the founder guest lifecycle starts in Lagos before sign-in');
  const accountResponse = await send('/api/account', undefined, guestCookie);
  assert.equal(accountResponse.status, 200);
  const accountState = object(await accountResponse.json());
  const idToken = await signToken(key, claimsFor(PROJECT, Date.now(), { subject: 'AfricaFixtureFounder', email: FOUNDER, n: ++minted.count }));
  const signedIn = await send('/api/account/sign-in', { csrf: accountState.csrf, idToken }, guestCookie);
  assert.equal(signedIn.status, 200);
  const founderCookie = signedIn.headers.get('set-cookie')?.split(';')[0];
  assert.ok(founderCookie, 'test founder authentication cookie');
  const founderMe = object(await (await send('/api/admin/me', undefined, founderCookie)).json());
  assert.equal(founderMe.level, 'root', 'funding uses the authenticated founder boundary');

  const adminAction = async (path, intent, phase) => {
    const encodedIntent = JSON.stringify(intent);
    const fixedIntent = Object.freeze(JSON.parse(encodedIntent));
    const safeCode = value => typeof value === 'string' && /^[a-z0-9_]{1,64}$/.test(value) ? value : null;
    while (true) {
      const response = await send(path, fixedIntent, founderCookie);
      const answer = object(await response.json());
      if (response.status === 429 && (answer.code === 'rate_limited' || answer.error === 'rate_limited')) {
        const db = await storage();
        const bucketRows = await db.exec("SELECT count,started_at,expires_at FROM rate_limits_protected WHERE key LIKE 'admin-w:%' LIMIT 2");
        const decision = sealedAdminRateWaitPolicy({ response: { status: response.status, code: answer.code, error: answer.error },
          bucketRows, rate: adminRate, nowMs: Date.now(), remainingMs: remainingMs(), waitsAlready: evidence.adminRateWaits.length });
        assert.equal(decision.ok, true, `admin ${phase} rate wait refused: ${decision.reason ?? 'invalid evidence'}`);
        evidence.adminRateWaits.push({ ...decision.evidence, phase, delayMs: decision.delayMs,
          intentSha256: sha256(encodedIntent), sameIntentRetried: true });
        await within('actual admin write-window expiry', new Promise(resolveWait => setTimeout(resolveWait, decision.delayMs)), decision.delayMs + 1000);
        continue;
      }
      assert.equal(response.status, 200, `admin ${phase} response ${JSON.stringify({ status: response.status, code: safeCode(answer.code), error: safeCode(answer.error) })}`);
      return answer;
    }
  };

  const keyOf = device => {
    const separator = device.cookie.indexOf('=');
    assert.ok(separator > 0);
    return device.cookie.slice(separator + 1);
  };
  const storage = () => currentWorker.getWorker().unsafeGetDurableObjectStorage('joinallworld-sealed-africa', 'JoinAllworldState', { name: 'joinallworld-v1' });
  const host = {
    storageFaults: {
      kinds: ['wallet', 'receipt'],
      failCommit: async (kind, device, actionId) => {
        const db = await storage();
        const player = device.id.replace(/'/g, "''"), intent = actionId.replace(/'/g, "''");
        if (kind === 'wallet') {
          await db.exec(`CREATE TRIGGER reject_homeward_wallet BEFORE INSERT ON wallet_effects
            WHEN NEW.public_id = '${player}' AND NEW.reason = 'Ride home on credit: ticket purchase'
            BEGIN SELECT RAISE(ABORT, 'injected homeward wallet failure'); END`);
        } else {
          assert.equal(kind, 'receipt');
          await db.exec(`CREATE TRIGGER reject_homeward_receipt BEFORE INSERT ON action_receipts
            WHEN NEW.sender = '${player}' AND NEW.action_id = '${intent}'
            BEGIN SELECT RAISE(ABORT, 'injected homeward receipt failure'); END`);
        }
      },
      recoverCommit: async () => { const db = await storage(); await db.exec('DROP TRIGGER IF EXISTS reject_homeward_wallet'); await db.exec('DROP TRIGGER IF EXISTS reject_homeward_receipt'); },
      inspect: async (device, actionId) => {
        const db = await storage();
        const rows = await db.exec('SELECT value FROM sessions WHERE secret = ?', keyOf(device));
        assert.equal(rows.length, 1);
        const session = rows[0]?.value;
        assert.equal(typeof session, 'string');
        const effects = await db.exec('SELECT * FROM wallet_effects WHERE public_id = ? ORDER BY seq', device.id);
        const receipts = await db.exec('SELECT value FROM action_receipts WHERE sender = ? AND action_id = ?', device.id, actionId);
        const receipt = receipts[0]?.value;
        assert.ok(receipt === undefined || typeof receipt === 'string');
        return { bytes: session, session, effects: JSON.stringify(effects), hasReceipt: receipts.length > 0, receipt: receipt ?? null };
      },
      replaceLiabilityField: async (device, city, field, value) => {
        const db = await storage();
        const rows = await db.exec('SELECT value FROM sessions WHERE secret = ?', keyOf(device));
        assert.equal(rows.length, 1);
        const stored = rows[0]?.value;
        assert.equal(typeof stored, 'string');
        const session = object(JSON.parse(stored));
        const state = object(object(object(session.cities)[city]).state);
        assert.equal(object(state.activeAction).kind, 'homeward');
        const target = field === 'travel' ? state : object(state.travel);
        const previous = target[field];
        if (value === undefined) delete target[field]; else target[field] = value;
        await db.exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), keyOf(device));
        return previous;
      },
      replaceTicketKey: async (device, city, ticketKey) => {
        const db = await storage();
        const rows = await db.exec('SELECT value FROM sessions WHERE secret = ?', keyOf(device));
        assert.equal(rows.length, 1);
        const stored = rows[0]?.value;
        assert.equal(typeof stored, 'string');
        const session = object(JSON.parse(stored));
        const state = object(object(object(session.cities)[city]).state);
        const active = object(state.activeAction);
        assert.equal(active.kind, 'homeward');
        const ticket = object(active.ticket), previous = ticket.key;
        assert.equal(typeof previous, 'string');
        ticket.key = ticketKey;
        await db.exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), keyOf(device));
        return previous;
      },
    },
    now: () => Date.now(),
    request: (path, body, cookie) => send(path, body, cookie),
    elapse: async (device, city, ms) => {
      const db = await storage();
      const rows = await db.exec('SELECT value FROM sessions WHERE secret = ?', keyOf(device));
      assert.equal(rows.length, 1);
      const stored = rows[0]?.value;
      assert.equal(typeof stored, 'string');
      const session = object(JSON.parse(stored));
      const entry = object(object(session.cities)[city]);
      assert.equal(typeof entry.updatedAt, 'number');
      entry.updatedAt -= ms;
      await db.exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), keyOf(device));
    },
    restart: async () => {
      const previous = worker;
      await cancelUnusedBodies();
      await within('Miniflare disposal before restart', previous.dispose(), LIMITS.disposeMs);
      worker = null;
      setWorker(() => null);
      worker = make();
      setWorker(() => worker);
      await within('Miniflare restart', worker.ready, LIMITS.restartMs);
    },
    credit: async (device, amount, reason) => {
      const intent = { clientId: `${Date.now()}:${randomUUID()}`, action: 'credit', amount, reason };
      const answer = await adminAction(`/api/admin/players/${device.id}/act`, intent, 'credit');
      assert.equal(answer.code, 'credited', 'synthetic funding is authorized and applied');
      const replay = await adminAction(`/api/admin/players/${device.id}/act`, intent, 'receipt-replay');
      assert.equal(replay.duplicate, true, 'funding receipt replays without a second effect');
      assert.equal(replay.after, answer.after);
    },
    debit: async (device, amount, reason) => {
      const intent = { clientId: `${Date.now()}:${randomUUID()}`, action: 'debit', amount, reason };
      let answer = await adminAction(`/api/admin/players/${device.id}/act`, intent, 'debit');
      if (answer.code === 'confirmation_required') {
        assert.equal(typeof answer.token, 'string');
        intent.confirm = answer.token;
        answer = await adminAction(`/api/admin/players/${device.id}/act`, intent, 'debit-confirmation');
      }
      assert.equal(answer.code, 'debited', 'synthetic spending uses the authenticated admin route');
      const replay = await adminAction(`/api/admin/players/${device.id}/act`, intent, 'receipt-replay');
      assert.equal(replay.duplicate, true, 'spending receipt replays without a second effect');
      assert.equal(replay.after, answer.after);
    },
  };
  return { host, send, cancelUnusedBodies, stop: async () => { await cancelUnusedBodies(); if (!worker) return; const prior = worker; worker = null; setWorker(() => null); await disposeWithin(prior); } };
}

async function main(args) {
  const startedAt = Date.now(), deadlineAt = startedAt + LIMITS.totalMs, within = withinFactory(deadlineAt);
  const evidence = { schemaVersion: 1, sourceSha: args.sha, packagePath: args.packageRoot, packageDigest: null, packageManifestSourceSha: null, releaseReady: false, outcomes: [], assets: [], adminRateWaits: [], scope: 'local synthetic sealed-package verification only; not production continuity, ordinary guest funding, physical-device verification, deployment, or approval' };
  let folder;
  let fixture;
  let workerGetter = () => null;
  const responseBodies = new Set();
  const remainingMs = () => Math.max(0, deadlineAt - Date.now());
  let currentCheck = 'source-and-package-identity';
  try {
    const checked = verifySourceAndPackage(args);
    evidence.packageDigest = checked.packageDigest;
    evidence.packageManifestSourceSha = checked.manifest.sourceSha;
    evidence.outcomes.push({ check: 'source-and-package-identity', status: 'passed' });
    currentCheck = 'sealed-worker-start-and-sqlite';
    const require = createRequire(join(args.tools, 'package.json'));
    const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
    assert.equal(typeof Miniflare, 'function', 'pinned Miniflare is unavailable from --tools');
    assert.equal(typeof convertV4MiniflareOptions, 'function', 'Miniflare config converter is unavailable');
    const script = await readFile(join(args.packageRoot, 'worker.js'), 'utf8');
    folder = await mkdtemp(join(tmpdir(), 'joinallworld-sealed-africa-'));
    const storagePath = join(folder, 'sqlite');
    const options = {
      name: 'joinallworld-sealed-africa', script, modules: true, compatibilityDate: '2026-10-01',
      durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } },
      durableObjectsPersist: storagePath, resourcePersistencePath: storagePath,
      unsafeInspectDurableObjects: true,
      bindings: { BUILD_ID: `joinallworld-${args.sha}`, ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT,
        ACCOUNTS_FIREBASE_API_KEY: 'africa-edge-test-api-key-0000000000000000000000',
        FOUNDER_EMAIL_SHA256: sha256(FOUNDER) },
      assets: { directory: join(args.packageRoot, 'assets'), binding: 'ASSETS', run_worker_first: true,
        routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } },
      handleStructuredLogs: () => {},
    };
    const sourceUrl = directory => pathToFileURL(join(args.source, directory)).href;
    const [journeys, testTokens, tokenModule, hostContext, adminGate] = await within('canonical fixture imports', Promise.all([
      import(sourceUrl('server/testing/africaJourney.ts')),
      import(sourceUrl('server/accounts/test-tokens.ts')),
      import(sourceUrl('server/accounts/token.ts')),
      import(sourceUrl('server/host-context.ts')),
      import(sourceUrl('server/admin/gate.ts')),
    ]), LIMITS.startMs);
    const batches = selectAfricaBatches(journeys.AFRICA_DESTINATION_BATCHES, args.sha, journeys.AFRICA_CAPITALS);
    const allCities = batches.flatMap(batch => batch.cities);
    const selected = selectedAssets(checked.files, allCities);
    evidence.destinationBatches = batches.map(batch => ({ name: batch.name, cities: [...batch.cities] }));
    evidence.coveredCities = [...allCities];
    const control = { testTokens, tokenModule, getWorker: () => workerGetter(), setWorker: null };
    control.setWorker = getter => { workerGetter = getter; };
    fixture = await makeHost({ options, Miniflare, convertV4MiniflareOptions, storagePath, currentWorker: control, setWorker: control.setWorker, within, responseBodies, remainingMs, adminRate: adminGate.RATE, evidence });
    evidence.outcomes.push({ check: 'sealed-worker-start-and-sqlite', status: 'passed' });
    currentCheck = 'packaged-assets';
    assert.equal(typeof hostContext.absolutePreviewImage, 'function', 'canonical HTML preview transform is unavailable');
    await checkPackagedAssets(fixture.send, args.packageRoot, selected, evidence, within, hostContext.absolutePreviewImage);
    evidence.outcomes.push({ check: 'packaged-assets-all-destinations', status: 'passed', count: evidence.assets.length, cities: [...allCities] });
    for (const batch of batches) {
      currentCheck = `air-travel-save-reload-meal-return-${batch.name}`;
      await within(`${batch.name} Africa journey`, journeys.africaJourney(fixture.host, batch.cities), 145_000);
      evidence.outcomes.push({ check: currentCheck, status: 'passed', cities: [...batch.cities] });
      currentCheck = `homeward-route-and-save-recovery-${batch.name}`;
      await within(`${batch.name} homeward journey`, journeys.homewardJourney(fixture.host, batch.cities), 145_000);
      evidence.outcomes.push({ check: currentCheck, status: 'passed', cities: [...batch.cities] });
    }
    evidence.outcomes.push({ check: 'sqlite-restart', status: 'passed' });
    evidence.elapsedMs = Date.now() - startedAt;
  } catch (error) {
    evidence.elapsedMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 320) : 'verification failed';
    evidence.failure = message;
    evidence.outcomes.push({ check: currentCheck, status: 'failed' });
    process.exitCode = 1;
  } finally {
    if (fixture) await fixture.cancelUnusedBodies().catch(() => {});
    else for (const response of responseBodies) if (response.body && !response.bodyUsed) await response.body.cancel().catch(() => {});
    if (fixture) await fixture.stop().catch(error => { process.exitCode = 1; evidence.cleanup = 'Miniflare disposal failed'; });
    else if (workerGetter()) await disposeWithin(workerGetter()).catch(() => { process.exitCode = 1; evidence.cleanup = 'Miniflare disposal failed'; });
    if (folder) await rm(folder, { recursive: true, force: true }).catch(() => { process.exitCode = 1; evidence.cleanup = 'temporary directory cleanup failed'; });
    evidence.elapsedMs = Date.now() - startedAt;
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
    if (process.exitCode) process.stderr.write('Sealed Africa verification failed.\n');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = argumentsOf(process.argv.slice(2));
    if (args.help) process.stdout.write(`${HELP}\n`);
    else {
      assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'run with Node 24 or newer and --experimental-strip-types');
      await main(args);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid invocation';
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: 'refused', reason: message.slice(0, 320), releaseReady: false })}\n`);
    process.stderr.write('Sealed Africa verification refused.\n');
    process.exitCode = 2;
  }
}
