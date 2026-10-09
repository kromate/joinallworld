#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { constants } from 'node:fs';
import { open, mkdir, mkdtemp, rm, lstat, unlink, readFile, chmod, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { verifySourceAndPackage } from './verify-sealed-africa.mjs';
import { assertOwnedGroupGone, checkpointPolicy, validateUpgradeArguments } from './stage-checkpoint-policy.mjs';
import { assertPinnedStageToolingSha, interactiveTeachingBindings, resolveInteractiveTeachingStarts } from './stage-capability-policy.mjs';
import { publishControlState, replacePrivateControl } from './stage-control-file.mjs';

const HELP = `Usage: node --experimental-strip-types world/tooling/serve-sealed-africa.mjs --source GAME_SOURCE_DIR --package ABSOLUTE_DIR --sha 40_HEX --tools ABSOLUTE_DIR --control ABSOLUTE_FILE --stage-helper-sha256 64_HEX --stage-capability-policy-sha256 64_HEX [--interactive-teaching-starts 1|0] [--seconds 600] [--retain-store]
       node --experimental-strip-types world/tooling/serve-sealed-africa.mjs --source GAME_SOURCE_DIR --package ABSOLUTE_DIR --sha 40_HEX --tools ABSOLUTE_DIR --control ABSOLUTE_CHECKPOINT --resume-control ABSOLUTE_CHECKPOINT --stage-helper-sha256 64_HEX --stage-capability-policy-sha256 64_HEX [--interactive-teaching-starts 1|0] [--recover-interrupted | --upgrade-from EXACT40_SHA] [--seconds 600] [--retain-store]

Starts the exact sealed Worker bytes and packaged ASSETS on a finite 127.0.0.1 Miniflare listener. The stage helper and capability policy each require explicit SHA-256 pins, separate from the clean game checkout supplied as --source. A new stage gets a fresh SQLite store; --resume-control reopens a safely stopped retained checkpoint on its original port and store. --recover-interrupted additionally permits an unfinished running checkpoint only after both its prior owner and owned process group are absent. Interactive teaching starts default off for every process window; pass --interactive-teaching-starts 1 to explicitly enable the Worker binding, or 0 to explicitly disable it. The private mode-0600 control contains the synthetic founder admin cookie for the authorized native journey only. SIGWINCH restarts the Worker on the same port and store without renewing the stage deadline. The internal deadline stops gracefully; Miniflare's own HUP/INT/TERM exit hooks can interrupt cleanup. By default the control and store are removed at shutdown; --retain-store saves a private stopped checkpoint.

This is a local synthetic staging fixture, not production continuity, deployment, or release approval.`;
const SOURCE_SHA = /^[a-f0-9]{40}$/;
const FOUNDER = 'africa-founder@example.test';
const PROJECT = 'allworld-africa-worker-test';
const REQUEST_LIMIT_MS = 20_000;
const DISPOSE_LIMIT_MS = 10_000;
const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const object = value => { assert.ok(isRecord(value), 'expected object response'); return value; };
const sha256 = value => createHash('sha256').update(value).digest('hex');

async function boundedRegularFileSha256(path, label) {
  assert.equal(typeof constants.O_NOFOLLOW, 'number', 'this platform must support O_NOFOLLOW for stage-tooling pins');
  const flags = constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0);
  const file = await open(path, flags);
  try {
    const stat = await file.stat();
    assert.ok(stat.isFile(), `${label} must be a regular file`);
    assert.ok(stat.size <= 256 * 1024, `${label} exceeds the 256 KiB pin-read limit`);
    const bytes = Buffer.alloc(256 * 1024 + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.byteLength, 0);
    assert.ok(bytesRead <= 256 * 1024, `${label} exceeds the 256 KiB pin-read limit`);
    assert.equal(bytesRead, stat.size, `${label} changed while its pin was being read`);
    return sha256(bytes.subarray(0, bytesRead));
  } finally {
    await file.close();
  }
}

function argumentsOf(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--retain-store' || flag === '--recover-interrupted') {
      if (Object.hasOwn(result, flag)) throw new Error(`duplicate argument: ${flag}`);
      result[flag] = true;
      continue;
    }
    if (!['--source', '--package', '--sha', '--tools', '--control', '--seconds', '--resume-control', '--upgrade-from', '--interactive-teaching-starts', '--stage-helper-sha256', '--stage-capability-policy-sha256'].includes(flag) || Object.hasOwn(result, flag)) throw new Error(`unknown or duplicate argument: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
    result[flag] = value;
    index += 1;
  }
  for (const flag of ['--source', '--package', '--sha', '--tools', '--control']) if (!result[flag]) throw new Error(`missing ${flag}`);
  for (const flag of ['--source', '--package', '--tools', '--control', ...(result['--resume-control'] ? ['--resume-control'] : [])]) if (!isAbsolute(result[flag])) throw new Error(`${flag} must be absolute`);
  if (!SOURCE_SHA.test(result['--sha'])) throw new Error('--sha must be exactly 40 lowercase hexadecimal characters');
  const SHA256 = /^[a-f0-9]{64}$/;
  for (const flag of ['--stage-helper-sha256', '--stage-capability-policy-sha256']) {
    if (!SHA256.test(result[flag] ?? '')) throw new Error(`${flag} must be exactly 64 lowercase hexadecimal characters`);
  }
  const seconds = result['--seconds'] === undefined ? 600 : Number(result['--seconds']);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 900) throw new Error('--seconds must be an integer from 1 to 900');
  resolveInteractiveTeachingStarts(result['--interactive-teaching-starts'], undefined);
  const control = resolve(result['--control']);
  const resumeControl = result['--resume-control'] ? resolve(result['--resume-control']) : undefined;
  if (resumeControl && resumeControl !== control) throw new Error('--control must be the exact same checkpoint path as --resume-control');
  if (result['--recover-interrupted'] && !resumeControl) throw new Error('--recover-interrupted requires --resume-control');
  const args = { source: resolve(result['--source']), packageRoot: resolve(result['--package']), sha: result['--sha'], tools: resolve(result['--tools']), control, resumeControl, upgradeFrom: result['--upgrade-from'], seconds, retainStore: result['--retain-store'] === true, recoverInterrupted: result['--recover-interrupted'] === true, requestedInteractiveTeachingStarts: result['--interactive-teaching-starts'], expectedStageHelperSha256: result['--stage-helper-sha256'], expectedStageCapabilityPolicySha256: result['--stage-capability-policy-sha256'] };
  validateUpgradeArguments(args);
  return args;
}

function isAncestor(source, from, to) {
  try {
    execFileSync('git', ['-C', source, 'merge-base', '--is-ancestor', from, to], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch (error) {
    if (error?.status === 1) return false;
    throw new Error('could not verify bounded Git ancestry for source upgrade');
  }
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
  const contents = serializeControl(value);
  const handle = await open(path, 'wx', 0o600);
  let identity;
  try {
    const stat = await handle.stat();
    identity = { dev: stat.dev, ino: stat.ino };
    await handle.chmod(0o600);
    await handle.writeFile(contents, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    return identity;
  } catch (error) {
    await handle.close().catch(() => {});
    if (identity) await removeOwnedControl(path, identity).catch(() => {});
    throw error;
  }
}

function serializeControl(value) {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  assert.ok(Buffer.byteLength(contents, 'utf8') <= 16 * 1024, 'resume checkpoint exceeds the 16384-byte limit');
  return contents;
}

async function writePrivateJson(path, value) {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, { encoding: 'utf8' });
    await handle.sync();
  } finally { await handle.close(); }
}

async function removeOwnedControl(path, identity) {
  if (!identity) return;
  try {
    const current = await lstat(path);
    if (current.isFile() && current.dev === identity.dev && current.ino === identity.ino) await unlink(path);
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

async function updateOwnedControl(path, identity, value) {
  return replacePrivateControl(path, identity, serializeControl(value));
}

async function readPrivateJson(path, maxBytes, description) {
  assert.equal(typeof constants.O_NOFOLLOW, 'number', 'this platform must support O_NOFOLLOW for private checkpoint safety');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    assert.ok(stat.isFile(), `${description} must be a regular file`);
    assert.equal(stat.uid, process.getuid(), `${description} must be owned by the current user`);
    assert.equal(stat.mode & 0o777, 0o600, `${description} permissions must be 0600`);
    assert.ok(stat.size <= maxBytes, `${description} exceeds the ${maxBytes}-byte limit`);
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    assert.ok(length <= maxBytes, `${description} exceeds the ${maxBytes}-byte limit`);
    const value = JSON.parse(bytes.subarray(0, length).toString('utf8'));
    return { value, identity: { dev: stat.dev, ino: stat.ino } };
  } finally { await handle.close(); }
}

function assertPublicFixtureJwk(value) {
  assert.ok(isRecord(value), 'checkpoint is missing the synthetic fixture provider public JWK');
  assert.deepEqual(Object.keys(value).sort(), ['alg', 'e', 'kid', 'kty', 'n', 'use'], 'checkpoint must contain only public JWK fields');
  assert.deepEqual([value.kty, value.alg, value.use], ['RSA', 'RS256', 'sig']);
  for (const field of ['e', 'kid', 'n']) assert.ok(typeof value[field] === 'string' && value[field].length > 0 && value[field].length <= 4096, `invalid public JWK field ${field}`);
  return value;
}

function assertPriorOwnerStopped(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0, 'checkpoint owner PID is invalid');
  try {
    process.kill(pid, 0);
    assert.fail('checkpoint owner process is still live; refusing resume');
  } catch (error) {
    if (error?.code === 'ESRCH') return;
    if (error?.code === 'EPERM') assert.fail('checkpoint owner process is still live; refusing resume');
    if (error?.code === 'ERR_ASSERTION') throw error;
    throw error;
  }
}

async function validateCheckpoint(args, checked) {
  const controlParent = dirname(args.resumeControl);
  const controlParentStat = await lstat(controlParent);
  assert.ok(controlParentStat.isDirectory() && !controlParentStat.isSymbolicLink(), 'checkpoint parent must be a real directory');
  assert.equal(controlParentStat.uid, process.getuid(), 'checkpoint parent must be owned by the current user');
  assert.equal(controlParentStat.mode & 0o777, 0o700, 'checkpoint parent permissions must be 0700');
  assert.equal(await realpath(controlParent), controlParent, 'checkpoint parent must be canonical');
  const { value: checkpoint, identity } = await readPrivateJson(args.resumeControl, 16 * 1024, 'resume checkpoint');
  assert.ok(isRecord(checkpoint), 'resume checkpoint must be a JSON object');
  assert.equal(checkpoint.schemaVersion, 1, 'unsupported resume checkpoint version');
  if (args.recoverInterrupted) assert.equal(checkpoint.stageStatus, 'running', 'interrupted recovery requires an unfinished running checkpoint');
  else assert.equal(checkpoint.stageStatus, 'stopped', 'only a cleanly stopped stage can be resumed');
  const provenance = checkpointPolicy({ checkpoint, args, packageDigest: checked.packageDigest, packageManifestSourceSha: checked.manifest.sourceSha, isAncestor: (from, to) => isAncestor(args.source, from, to) });
  assert.equal(typeof checkpoint.founderCookieForAdminCredit, 'string');
  assert.ok(checkpoint.founderCookieForAdminCredit.length > 0 && checkpoint.founderCookieForAdminCredit.length <= 4096 && !/[\r\n]/.test(checkpoint.founderCookieForAdminCredit), 'invalid private founder cookie field');
  assert.equal(typeof checkpoint.storagePath, 'string');
  assert.equal(typeof checkpoint.storeMarkerPath, 'string');
  assert.ok(typeof checkpoint.storeId === 'string' && /^[0-9a-f-]{36}$/.test(checkpoint.storeId), 'invalid store identity');
  assertPublicFixtureJwk(checkpoint.fixtureProviderJwk);
  assertPriorOwnerStopped(checkpoint.ownerChildPid);
  if (args.recoverInterrupted) {
    // The watchdog creates the helper's own process group. A killed owner alone
    // is insufficient: its old group must contain no surviving Worker children.
    try {
      process.kill(-checkpoint.ownerChildPid, 0);
      assert.fail('previous stage process group is still live; refusing interrupted recovery');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  assert.ok(Number.isSafeInteger(checkpoint.restartCount) && checkpoint.restartCount >= 0, 'invalid checkpoint restart count');
  assert.ok(typeof checkpoint.deadline === 'string' && Number.isFinite(Date.parse(checkpoint.deadline)), 'invalid prior stage deadline');
  const url = new URL(checkpoint.stageUrl);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  const port = Number(checkpoint.port);
  assert.ok(Number.isSafeInteger(port) && port > 0 && Number(url.port) === port, 'checkpoint stage URL must contain its fixed port');
  assert.equal(url.origin, checkpoint.stageUrl, 'checkpoint stage URL must be a canonical origin');
  const parent = resolve(checkpoint.storagePath, '..');
  assert.equal(checkpoint.storagePath, join(parent, 'sqlite'), 'checkpoint storage directory must be the expected private child');
  assert.equal(checkpoint.storeMarkerPath, join(parent, 'store-marker.json'), 'checkpoint store marker path is invalid');
  const parentStat = await lstat(parent);
  assert.ok(parentStat.isDirectory() && !parentStat.isSymbolicLink(), 'checkpoint store parent must be a real directory');
  assert.equal(parentStat.uid, process.getuid(), 'checkpoint store parent must be owned by the current user');
  assert.equal(parentStat.mode & 0o777, 0o700, 'checkpoint store parent permissions must be 0700');
  assert.equal(await realpath(parent), parent, 'checkpoint store parent must be canonical');
  const storageStat = await lstat(checkpoint.storagePath);
  assert.ok(storageStat.isDirectory() && !storageStat.isSymbolicLink(), 'checkpoint SQLite storage must be a real directory');
  assert.equal(storageStat.uid, process.getuid(), 'checkpoint SQLite storage must be owned by the current user');
  assert.equal(storageStat.mode & 0o077, 0, 'checkpoint SQLite storage must not be group/world accessible');
  assert.equal(await realpath(checkpoint.storagePath), checkpoint.storagePath, 'checkpoint SQLite storage must be canonical');
  const { value: marker } = await readPrivateJson(checkpoint.storeMarkerPath, 2048, 'store identity marker');
  assert.deepEqual(marker, { schemaVersion: 1, ...provenance.marker }, 'store marker does not match the immutable store origin');
  if (args.upgradeFrom !== undefined) {
    assert.equal(checkpoint.stageStatus, 'stopped', 'source upgrade requires a cleanly stopped checkpoint');
    assertOwnedGroupGone(() => {
      try { process.kill(-checkpoint.ownerChildPid, 0); return true; }
      catch (error) { if (error?.code === 'ESRCH') return false; throw error; }
    });
  }
  return { checkpoint, identity, provenance, storagePath: checkpoint.storagePath, folder: parent, port, origin: url.origin };
}

async function main(args) {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'run with Node 24 or newer and --experimental-strip-types');
  const checked = verifySourceAndPackage(args);
  const stageHelperSha256 = await boundedRegularFileSha256(new URL('./serve-sealed-africa.mjs', import.meta.url), 'running stage helper');
  const stageCapabilityPolicySha256 = await boundedRegularFileSha256(new URL('./stage-capability-policy.mjs', import.meta.url), 'running stage capability policy');
  assertPinnedStageToolingSha(args.expectedStageHelperSha256, stageHelperSha256, 'stage helper');
  assertPinnedStageToolingSha(args.expectedStageCapabilityPolicySha256, stageCapabilityPolicySha256, 'stage capability policy');
  const require = createRequire(join(args.tools, 'package.json'));
  const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
  assert.equal(typeof Miniflare, 'function', 'pinned Miniflare is unavailable from --tools');
  assert.equal(typeof convertV4MiniflareOptions, 'function', 'Miniflare config converter is unavailable');

  const [testTokens, tokenModule] = await Promise.all([
    import(pathToFileURL(join(args.source, 'server/accounts/test-tokens.ts')).href),
    import(pathToFileURL(join(args.source, 'server/accounts/token.ts')).href),
  ]);
  const resumed = args.resumeControl ? await validateCheckpoint(args, checked) : undefined;
  const interactiveTeachingStarts = resolveInteractiveTeachingStarts(args.requestedInteractiveTeachingStarts, resumed?.checkpoint.interactiveTeachingStarts);
  const resumedFromInteractiveTeachingStarts = resumed?.checkpoint.interactiveTeachingStarts ?? null;
  const key = resumed ? undefined : await within('synthetic provider key generation', testTokens.makeKey('africa-native-stage-test-key'));
  const fixtureProviderJwk = resumed?.checkpoint.fixtureProviderJwk ?? key?.jwk;
  assertPublicFixtureJwk(fixtureProviderJwk);
  let folder = resumed?.folder ?? await mkdtemp(join(tmpdir(), 'joinallworld-sealed-africa-stage-'));
  if (!resumed) {
    await chmod(folder, 0o700);
    folder = await realpath(folder);
  }
  const storagePath = resumed?.storagePath ?? join(folder, 'sqlite');
  if (!resumed) {
    await mkdir(storagePath, { mode: 0o700 });
    await chmod(storagePath, 0o700);
  }
  const storeId = resumed?.checkpoint.storeId ?? randomUUID();
  const storeMarkerPath = resumed?.checkpoint.storeMarkerPath ?? join(folder, 'store-marker.json');
  if (!resumed) await writePrivateJson(storeMarkerPath, { schemaVersion: 1, sourceSha: args.sha, packageDigest: checked.packageDigest, storeId });
  const responseBodies = new Set();
  let worker;
  const checkpointState = { controlIdentity: resumed?.identity, controlState: undefined, stageStarted: false, forceRetainCheckpoint: false };
  let deadlineTimer;
  let resolveFinished;
  let restartTask;
  let restartCount = resumed?.checkpoint.restartCount ?? 0;
  let boundPort;
  let origin;
  let deadlineAt;
  let stageReady = false;
  let restarting = false;
  let stopRequested = false;
  let founderCookie;
  let verifyLifeCapabilityResponse;
  let lifeCapabilityEvidence;
  const requestControllers = new Set();
  const removeSignals = [];
  const finished = new Promise(resolveFinishedFn => { resolveFinished = resolveFinishedFn; });
  const publishControl = async value => {
    return publishControlState(checkpointState, value, (identity, nextValue) => updateOwnedControl(args.control, identity, nextValue));
  };
  const cancelUnusedBodies = async () => {
    for (const response of responseBodies) if (response.body && !response.bodyUsed) await response.body.cancel().catch(() => {});
    responseBodies.clear();
  };
  const dispose = async () => {
    if (!worker) return;
    const previous = worker;
    await within('Miniflare disposal', previous.dispose(), DISPOSE_LIMIT_MS);
    worker = null;
  };
  let options;
  const makeWorker = port => new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: storagePath, host: '127.0.0.1', port, handleStructuredLogs: () => {} });
  const withinStageLife = (label, operation, localLimit) => {
    const remaining = deadlineAt === undefined ? localLimit : deadlineAt - Date.now();
    assert.ok(remaining > 0, 'sealed Africa stage deadline has elapsed');
    return within(label, operation, Math.max(1, Math.min(localLimit, remaining)));
  };
  const assertLoopbackReady = (ready, expectedPort) => {
    const url = ready instanceof URL ? ready : new URL(String(ready));
    assert.equal(url.protocol, 'http:', 'stage listener must use HTTP on loopback');
    assert.equal(url.hostname, '127.0.0.1', 'stage listener must bind to 127.0.0.1 only');
    assert.ok(Number(url.port) > 0, 'Miniflare must choose a nonzero ephemeral port');
    if (expectedPort !== undefined) assert.equal(Number(url.port), expectedPort, 'stage restart must reuse its original port');
    return url;
  };
  const onStop = signal => {
    if (stopRequested) return;
    stopRequested = true;
    for (const controller of requestControllers) controller.abort();
    process.stderr.write(`Sealed Africa stage stopping on ${signal}.\n`);
    resolveFinished();
  };
  const ensureStarting = () => assert.ok(!stopRequested, 'stage stopped during startup');
  const onHangup = () => {
    if (stopRequested) { process.stderr.write('Sealed Africa restart ignored during shutdown.\n'); return; }
    if (restarting) { process.stderr.write('Sealed Africa restart rejected because one is already in progress.\n'); return; }
    if (!stageReady) { process.stderr.write('Sealed Africa restart ignored before stage readiness.\n'); return; }
    restarting = true;
    stageReady = false;
    restartTask = (async () => {
      await cancelUnusedBodies();
      const previous = worker;
      assert.ok(previous, 'stage Worker is unavailable for restart');
      await withinStageLife('Miniflare restart disposal', previous.dispose(), DISPOSE_LIMIT_MS);
      worker = null;
      worker = makeWorker(boundPort);
      const ready = await withinStageLife('Miniflare restart startup', worker.ready, REQUEST_LIMIT_MS);
      origin = assertLoopbackReady(ready, boundPort).origin;
      assert.equal(typeof verifyLifeCapabilityResponse, 'function', 'actual /api/life capability verifier is unavailable');
      lifeCapabilityEvidence = await withinStageLife('actual /api/life capability after restart', verifyLifeCapabilityResponse(), REQUEST_LIMIT_MS);
      stageReady = true;
      restartCount += 1;
      process.stdout.write(`${JSON.stringify({ event: 'restart', sourceSha: args.sha, packageDigest: checked.packageDigest, stageHelperSha256, stageCapabilityPolicySha256, interactiveTeachingStarts, interactiveTeachingBinding: interactiveTeachingStarts === '1' ? '1' : 'omitted', apiLifeInteractiveTeachingStartsPresent: lifeCapabilityEvidence.present, apiLifeInteractiveTeachingStarts: lifeCapabilityEvidence.value, stageUrl: origin, storeReused: true, count: restartCount })}\n`);
    })().catch(error => {
      process.exitCode = 1;
      const message = error instanceof Error ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 240) : 'restart failed';
      process.stderr.write(`Sealed Africa restart failed: ${message}\n`);
      stopRequested = true;
      resolveFinished();
    }).finally(() => { restarting = false; restartTask = undefined; });
  };
  for (const [signal, handler] of [['SIGINT', () => onStop('SIGINT')], ['SIGTERM', () => onStop('SIGTERM')], ['SIGHUP', () => onStop('SIGHUP')], ['SIGWINCH', onHangup]]) {
    process.on(signal, handler);
    removeSignals.push(() => process.removeListener(signal, handler));
  }
  let retainFolder = false;
  let cleanupFailed = false;
  try {
    options = {
      name: 'joinallworld-sealed-africa-stage', script: await readFile(join(args.packageRoot, 'worker.js'), 'utf8'),
      modules: true, compatibilityDate: '2026-10-01',
      durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } },
      durableObjectsPersist: storagePath, resourcePersistencePath: storagePath,
      bindings: { BUILD_ID: `joinallworld-${args.sha}`, ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT,
        ACCOUNTS_FIREBASE_API_KEY: 'africa-edge-test-api-key-0000000000000000000000',
        FOUNDER_EMAIL_SHA256: sha256(FOUNDER),
        ...interactiveTeachingBindings(interactiveTeachingStarts) },
      assets: { directory: join(args.packageRoot, 'assets'), binding: 'ASSETS', run_worker_first: true,
        routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } },
      outboundService: async request => {
        const url = new URL(request.url);
        if (url.href.split('?')[0] === tokenModule.TOKEN_KEYS_URL) return new Response(JSON.stringify({ keys: [fixtureProviderJwk] }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
        throw new Error('sealed Africa staging refuses every non-fixture outbound request');
      },
      handleStructuredLogs: () => {},
    };
    worker = makeWorker(resumed?.port ?? 0);
    const ready = await within('Miniflare startup', worker.ready);
    ensureStarting();
    const stageUrl = assertLoopbackReady(ready, resumed?.port);
    origin = stageUrl.origin;
    boundPort = Number(stageUrl.port);
    const ips = { next: 0 };
    const send = async (path, body, cookie) => {
      const controller = new AbortController();
      requestControllers.add(controller);
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
      } finally { if (timer) clearTimeout(timer); requestControllers.delete(controller); }
    };
    const json = async (label, response) => {
      assert.equal(response.status, 200, `${label} returned ${response.status}`);
      return object(await within(`${label} response body`, response.json()));
    };
    if (resumed) {
      founderCookie = resumed.checkpoint.founderCookieForAdminCredit;
    } else {
      const guest = await send('/api/session', { name: 'Africa fixture founder' });
      ensureStarting();
      assert.equal(guest.status, 200, 'synthetic founder guest creation succeeds');
      const guestCookie = guest.headers.get('set-cookie')?.split(';')[0];
      assert.ok(guestCookie, 'synthetic founder guest cookie');
      await guest.body?.cancel().catch(() => {});
      await json('founder guest life', await send('/api/life?city=lagos', undefined, guestCookie));
      ensureStarting();
      const account = await json('founder account state', await send('/api/account', undefined, guestCookie));
      ensureStarting();
      assert.ok(key, 'fresh stage signing key is available');
      const idToken = await testTokens.signToken(key, testTokens.claimsFor(PROJECT, Date.now(), {
        subject: 'AfricaFixtureFounder', email: FOUNDER, n: 1,
      }));
      const signedIn = await send('/api/account/sign-in', { csrf: account.csrf, idToken }, guestCookie);
      ensureStarting();
      const authenticatedFounderCookie = signedIn.headers.get('set-cookie')?.split(';')[0];
      assert.ok(signedIn.status === 200 && authenticatedFounderCookie, 'synthetic founder authentication succeeds');
      await signedIn.body?.cancel().catch(() => {});
      founderCookie = authenticatedFounderCookie;
    }
    const root = await json('founder admin identity', await send('/api/admin/me', undefined, founderCookie));
    ensureStarting();
    assert.equal(root.level, 'root', 'control cookie belongs to the synthetic founder admin');

    verifyLifeCapabilityResponse = async () => {
      const life = await json('actual /api/life teaching capability', await send('/api/life?city=lagos', undefined, founderCookie));
      ensureStarting();
      const present = Object.hasOwn(life, 'interactiveTeachingStarts');
      const value = present ? life.interactiveTeachingStarts : null;
      if (interactiveTeachingStarts === '1') {
        assert.equal(present, true, 'ON /api/life response must include the top-level interactiveTeachingStarts flag');
        assert.equal(value, true, 'ON /api/life top-level interactiveTeachingStarts must be true');
      } else {
        assert.equal(present, false, 'OFF /api/life response must omit the top-level interactiveTeachingStarts flag');
      }
      return { present, value };
    };
    lifeCapabilityEvidence = await verifyLifeCapabilityResponse();

    deadlineAt = Date.now() + args.seconds * 1000;
    const deadline = new Date(deadlineAt).toISOString();
    checkpointState.controlState = {
      schemaVersion: 1,
      stageStatus: 'running',
      stageUrl: origin,
      port: boundPort,
      sourceSha: args.sha,
      packageDigest: checked.packageDigest,
      packageManifestSourceSha: checked.manifest.sourceSha,
      stageHelperSha256,
      stageCapabilityPolicySha256,
      interactiveTeachingStarts,
      interactiveTeachingBinding: interactiveTeachingStarts === '1' ? '1' : 'omitted',
      resumedFromInteractiveTeachingStarts,
      apiLifeInteractiveTeachingStartsPresent: lifeCapabilityEvidence.present,
      apiLifeInteractiveTeachingStarts: lifeCapabilityEvidence.value,
      ownerChildPid: process.pid,
      storagePath,
      storeMarkerPath,
      storeId,
      fixtureProviderJwk,
      restartCount,
      deadline,
      founderCookieForAdminCredit: founderCookie,
    };
    if (resumed?.provenance.upgraded) {
      checkpointState.controlState.storeOrigin = resumed.provenance.storeOrigin;
      checkpointState.controlState.sourceUpgradeHistory = resumed.provenance.sourceUpgradeHistory;
    } else if (resumed?.checkpoint.storeOrigin !== undefined) {
      checkpointState.controlState.storeOrigin = resumed.checkpoint.storeOrigin;
      checkpointState.controlState.sourceUpgradeHistory = resumed.checkpoint.sourceUpgradeHistory;
    }
    if (resumed) await publishControl(checkpointState.controlState);
    else checkpointState.controlIdentity = await writeControl(args.control, checkpointState.controlState);
    checkpointState.stageStarted = true;
    stageReady = true;
    process.stdout.write(`${JSON.stringify({ stageUrl: origin, buildId: `joinallworld-${args.sha}`, sourceSha: args.sha, packageDigest: checked.packageDigest, stageHelperSha256, stageCapabilityPolicySha256, interactiveTeachingStarts, interactiveTeachingBinding: interactiveTeachingStarts === '1' ? '1' : 'omitted', resumedFromInteractiveTeachingStarts, apiLifeInteractiveTeachingStartsPresent: lifeCapabilityEvidence.present, apiLifeInteractiveTeachingStarts: lifeCapabilityEvidence.value, deadline })}\n`);
    deadlineTimer = setTimeout(() => onStop('deadline'), args.seconds * 1000);
    await finished;
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    for (const controller of requestControllers) controller.abort();
    stageReady = false;
    if (restartTask) await restartTask.catch(() => {});
    await cancelUnusedBodies();
    try { await dispose(); } catch { cleanupFailed = true; }
    retainFolder = checkpointState.forceRetainCheckpoint || (args.retainStore && Boolean(checkpointState.controlIdentity)) || Boolean(resumed && !checkpointState.stageStarted);
    if (retainFolder) {
      try {
        if (checkpointState.stageStarted) await publishControl({ ...checkpointState.controlState, stageStatus: cleanupFailed ? 'cleanup_failed' : 'stopped', stoppedAt: new Date().toISOString(), restartCount });
        else if (resumed && cleanupFailed) await publishControl({
          ...resumed.checkpoint, stageStatus: 'cleanup_failed', ownerChildPid: process.pid,
          stoppedAt: new Date().toISOString(),
        });
      } catch { cleanupFailed = true; }
    } else {
      try { await removeOwnedControl(args.control, checkpointState.controlIdentity); } catch { cleanupFailed = true; }
    }
    if (checkpointState.forceRetainCheckpoint) retainFolder = true;
    if (!retainFolder) {
      try { await rm(folder, { recursive: true, force: true }); } catch { cleanupFailed = true; }
    }
    if (retainFolder) process.stdout.write(`${JSON.stringify({ retainedStoragePath: storagePath })}\n`);
    for (const remove of removeSignals) remove();
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
