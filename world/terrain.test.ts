import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { acquireAccraTerrain } from './terrain.ts';

test('supervisor accepts bounded artifacts from the worker and rejects a symlinked build root', async () => {
  const temp = await mkdtemp(path.join(await realpath(os.tmpdir()), 'terrain-supervisor-'));
  try {
    const root = path.join(temp, 'build');
    const other = path.join(temp, 'other');
    await mkdir(other);
    await symlink(other, path.join(temp, 'link'));
    const python = path.join(temp, 'python3');
    const digest = 'a'.repeat(64);
    const source = path.join(root, 'terrain', 'sources', `${digest}.tif`);
    const sidecar = path.join(root, 'terrain', 'sidecars', `${digest}.json`);
    const script = `#!/bin/sh\nset -eu\n/bin/mkdir -p '${path.dirname(source)}' '${path.dirname(sidecar)}'\n/bin/dd if=/dev/zero of='${source}' bs=3511272 count=1 2>/dev/null\nprintf '{}' > '${sidecar}'\nprintf '%s\\n' '${JSON.stringify({ sourcePath: source, sidecarPath: sidecar, sha256: digest, bytes: 3511272, cacheHit: false, networkBytes: 3511272 })}'\n`;
    await writeFile(python, script, { mode: 0o700 });
    await chmod(python, 0o700);
    const result = await acquireAccraTerrain({ buildRoot: root, pythonExecutable: python });
    assert.equal(result.sha256, digest);
    assert.equal(result.bytes, 3_511_272);
    assert.equal((await readFile(sidecar, 'utf8')), '{}');
    await assert.rejects(acquireAccraTerrain({ buildRoot: path.join(temp, 'link', 'nested'), pythonExecutable: python }), /symlink/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
