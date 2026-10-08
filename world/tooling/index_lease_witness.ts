// Fixed descriptor-inheritance witness. No database, network, ledger or file writes.
import assert from 'node:assert/strict';
import { fstatSync, lstatSync, realpathSync } from 'node:fs';
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
console.log(JSON.stringify({ scope: 'fixed inherited Node descriptor witness; not coordinator-crash/index acceptance',
  nodeVersion: process.version, descriptorSurvivedExec: true, dev: held.dev, ino: held.ino,
  bytes: held.size, maximumRssKiB: process.resourceUsage().maxRSS }));
