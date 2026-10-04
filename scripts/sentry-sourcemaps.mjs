#!/usr/bin/env node
/**
 * Upload the production build's source maps to Sentry, then remove them from dist/.
 *
 *   BUILD_ID=<release> SENTRY_AUTH_TOKEN=… SENTRY_ORG=… SENTRY_PROJECT=… npm run sentry:sourcemaps
 *
 * Run it AFTER `npm run build` and BEFORE the build is deployed or served: it writes a debug id
 * into each bundle (that is how Sentry pairs a bundle with its map), so the files that are
 * deployed must be the ones this script has processed.
 *
 *   SENTRY_AUTH_TOKEN   an organisation auth token with the "source maps" scope (Sentry → Settings →
 *                       Auth Tokens). It is read from the environment, handed to the Sentry CLI
 *                       through the environment, never printed and never written anywhere.
 *                       It is not a runtime setting: the game server never sees it.
 *   SENTRY_ORG          the organisation slug
 *   SENTRY_PROJECT      the BROWSER project's slug (the one SENTRY_DSN_CLIENT belongs to)
 *   BUILD_ID            the release — the same value the server runs with, so events and maps match
 *   SENTRY_URL          only for a self-hosted Sentry or a region URL (optional)
 *
 *   --strip-only   upload nothing; only delete the maps (for a deploy without Sentry)
 *   --keep-maps    upload, but leave the maps in dist/ (they are still never served: the Node server
 *                  refuses *.map and public/.assetsignore keeps them out of the Worker's assets)
 *   --dry-run      say what would be done and stop
 *
 * The Sentry CLI is fetched by npx at the pinned version when this runs; it is not a dependency of
 * the game.
 */
import { readdir, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const CLI = '@sentry/cli@3.8.0';
const flags = new Set(process.argv.slice(2));
const dist = resolve('dist');
const assets = join(dist, 'assets');

async function mapsIn(dir) {
  const found = [];
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await mapsIn(path));
    else if (entry.name.endsWith('.map')) found.push(path);
  }
  return found;
}
function fail(message) { console.error(`sentry:sourcemaps — ${message}`); process.exit(1); }
function cli(args) {
  // The token travels in the environment only; argv (visible in a process list) carries no secret.
  const result = spawnSync('npx', ['--yes', CLI, ...args], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) fail(`the Sentry CLI failed (${args.slice(0, 2).join(' ')}). Nothing was deleted.`);
}

const maps = await mapsIn(dist);
if (!maps.length) fail('no source maps in dist/. Run `npm run build` first (the build writes hidden source maps).');
const bytes = (await Promise.all(maps.map((path) => stat(path)))).reduce((sum, info) => sum + info.size, 0);
console.log(`sentry:sourcemaps — ${maps.length} source maps in dist/ (${(bytes / 1048576).toFixed(1)} MB).`);

if (!flags.has('--strip-only')) {
  const release = (process.env.BUILD_ID || '').trim();
  const missing = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT', 'BUILD_ID'].filter((name) => !(process.env[name] || '').trim());
  if (missing.length) fail(`missing ${missing.join(', ')}. Set them in the environment (never in a committed file), or pass --strip-only to delete the maps without uploading.`);
  if (!/^[A-Za-z0-9._+-]{1,40}$/.test(release)) fail('BUILD_ID must be 1–40 characters of letters, digits, dot, underscore, plus or dash.');
  if (flags.has('--dry-run')) {
    console.log(`Would run: npx ${CLI} sourcemaps inject ${assets}`);
    console.log(`Would run: npx ${CLI} sourcemaps upload --release ${release} ${assets}   (org ${process.env.SENTRY_ORG}, project ${process.env.SENTRY_PROJECT}, token from the environment)`);
    console.log(flags.has('--keep-maps') ? 'Would keep the maps in dist/.' : `Would then delete ${maps.length} .map files from dist/.`);
    process.exit(0);
  }
  cli(['sourcemaps', 'inject', assets]);
  cli(['sourcemaps', 'upload', '--release', release, assets]);
  console.log(`sentry:sourcemaps — uploaded for release ${release}.`);
} else if (flags.has('--dry-run')) {
  console.log(`Would delete ${maps.length} .map files from dist/.`);
  process.exit(0);
}

if (!flags.has('--keep-maps')) {
  await Promise.all(maps.map((path) => rm(path, { force: true })));
  console.log(`sentry:sourcemaps — removed ${maps.length} .map files from dist/: they are not deployed.`);
}
