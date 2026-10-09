// Fixed descriptor-inheritance witness. No database, network, ledger or file writes.
import assert from 'node:assert/strict';
import { fstatSync, lstatSync, realpathSync, readSync } from 'node:fs';
import path from 'node:path';

const root = process.env.TMPDIR;
assert.ok(root && path.isAbsolute(root) && realpathSync(root) === root);
assert.equal(lstatSync(root).mode & 0o777, 0o700);
const value = process.env.WORLD_INDEX_LEASE_DESCRIPTOR;
assert.ok(value && /^[1-9][0-9]{0,8}$/.test(value));
const descriptor = Number(value);
assert.ok(Number.isSafeInteger(descriptor) && descriptor > 2);
const held = fstatSync(descriptor), named = lstatSync(path.join(root, 'writer.lock'));
assert.ok(held.isFile() && named.isFile() && !named.isSymbolicLink());
assert.equal(held.mode & 0o777, 0o600); assert.equal(held.nlink, 1); assert.equal(held.size, 0);
assert.equal(held.uid, process.getuid!());
assert.equal(held.dev, named.dev); assert.equal(held.ino, named.ino);
let namespace: { dev: number; ino: number } | null = null;
if (process.env.WORLD_INDEX_NAMESPACE_DESCRIPTOR !== undefined) {
  const parent = path.dirname(root), info = lstatSync(parent);
  assert.equal(realpathSync(parent), parent);
  assert.ok(info.isDirectory() && info.uid === process.getuid!() && (info.mode & 0o777) === 0o700);
  const fd = Number(process.env.WORLD_INDEX_NAMESPACE_DESCRIPTOR);
  assert.ok(Number.isSafeInteger(fd) && fd > 2 && fd !== descriptor);
  const inherited = fstatSync(fd), lock = lstatSync(path.join(parent, 'writer.lock'));
  assert.ok(inherited.isFile() && lock.isFile() && !lock.isSymbolicLink());
  assert.equal(inherited.mode & 0o777, 0o600); assert.equal(inherited.nlink, 1); assert.equal(inherited.size, 0);
  assert.equal(inherited.uid, process.getuid!());
  assert.equal(inherited.dev, lock.dev); assert.equal(inherited.ino, lock.ino);
  namespace = { dev: inherited.dev, ino: inherited.ino };
}
assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === 'hold' && namespace));
console.log(JSON.stringify({ scope: 'fixed inherited Node descriptor witness; not coordinator-crash/index acceptance',
  nodeVersion: process.version, descriptorSurvivedExec: true, dev: held.dev, ino: held.ino,
  namespace, bytes: held.size, maximumRssKiB: process.resourceUsage().maxRSS }));
// Direct bounded fixture only: its test owns readiness, pipe, timeout and reaping.
if (process.argv[2] === 'hold') assert.equal(readSync(0, Buffer.alloc(1), 0, 1, null), 1);
