#!/usr/bin/env node
/**
 * Upload the production build's source maps to Sentry.
 *
 *   SOURCEMAPS=1 npm run build          (the default build writes no maps; this one writes them to dist-maps/, never dist/)
 *   BUILD_ID=<release> SENTRY_AUTH_TOKEN=… SENTRY_ORG=… SENTRY_PROJECT=… npm run sentry:sourcemaps
 *
 * Run it AFTER that build and BEFORE the build is deployed or served: it writes a debug id
 * into each bundle (that is how Sentry pairs a bundle with its map), so the files that are
 * deployed must be the ones this script has processed. The maps are copied next to their bundles for
 * the Sentry CLI and taken out of dist/ again before the script ends, so dist/ never keeps a map.
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
 *   --strip-only   upload nothing; only delete dist-maps/ (for a deploy without Sentry)
 *   --keep-maps    upload, and keep dist-maps/ (the default deletes it once uploaded)
 *   --dry-run      say what would be done and stop
 *
 * The Sentry CLI is fetched by npx at the pinned version when this runs; it is not a dependency of
 * the game.
 */
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join, relative, dirname } from 'node:path';

const CLI = '@sentry/cli@3.8.0';
const flags = new Set(process.argv.slice(2));
const dist = resolve('dist');
const mapsRoot = resolve('dist-maps');
const assets = join(dist, 'assets');

async function mapsIn(dir: string): Promise<string[]> {
  const found: string[] = [];
  let entries: Dirent[] = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await mapsIn(path));
    else if (entry.name.endsWith('.map')) found.push(path);
  }
  return found;
}
function fail(message: string): never { console.error(`sentry:sourcemaps — ${message}`); process.exit(1); }
function cli(args: string[]): void {
  // The token travels in the environment only; argv (visible in a process list) carries no secret.
  const result = spawnSync('npx', ['--yes', CLI, ...args], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) fail(`the Sentry CLI failed (${args.slice(0, 2).join(' ')}). Nothing was deleted.`);
}

const maps = await mapsIn(mapsRoot);
if (!maps.length) fail('no source maps in dist-maps/. Run `SOURCEMAPS=1 npm run build` first (the default build writes none).');
const bytes = (await Promise.all(maps.map((path: string) => stat(path)))).reduce((sum, info) => sum + info.size, 0);
console.log(`sentry:sourcemaps — ${maps.length} source maps in dist-maps/ (${(bytes / 1048576).toFixed(1)} MB).`);
const inDist = (map: string): string => join(dist, relative(mapsRoot, map));

if (!flags.has('--strip-only')) {
  const release = (process.env.BUILD_ID || '').trim();
  const missing = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT', 'BUILD_ID'].filter((name) => !(process.env[name] || '').trim());
  if (missing.length) fail(`missing ${missing.join(', ')}. Set them in the environment (never in a committed file), or pass --strip-only to delete the maps without uploading.`);
  if (!/^[A-Za-z0-9._+-]{1,40}$/.test(release)) fail('BUILD_ID must be 1–40 characters of letters, digits, dot, underscore, plus or dash.');
  if (flags.has('--dry-run')) {
    console.log(`Would copy the maps next to their bundles in ${dist}, run: npx ${CLI} sourcemaps inject ${assets}`);
    console.log(`Would run: npx ${CLI} sourcemaps upload --release ${release} ${assets}   (org ${process.env.SENTRY_ORG}, project ${process.env.SENTRY_PROJECT}, token from the environment)`);
    console.log(`Would then take the maps out of dist/ again${flags.has('--keep-maps') ? ' (dist-maps/ is kept).' : ' and delete dist-maps/.'}`);
    process.exit(0);
  }
  // The CLI pairs a bundle with the map beside it: put them there, and take them out again whatever happens.
  try {
    for (const map of maps) { await mkdir(dirname(inDist(map)), { recursive: true }); await copyFile(map, inDist(map)); }
    cli(['sourcemaps', 'inject', assets]);
    cli(['sourcemaps', 'upload', '--release', release, assets]);
  } finally {
    await Promise.all(maps.map((map: string) => rm(inDist(map), { force: true })));
  }
  console.log(`sentry:sourcemaps — uploaded for release ${release}; dist/ holds no source map.`);
} else if (flags.has('--dry-run')) {
  console.log('Would delete dist-maps/.');
  process.exit(0);
}

if (!flags.has('--keep-maps')) {
  await rm(mapsRoot, { recursive: true, force: true });
  console.log('sentry:sourcemaps — removed dist-maps/.');
}
