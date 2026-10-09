import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../');
const manifestPath = path.join(here, 'source-pins-v6.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.diagnosticOnly, true);
for (const [relative, expected] of Object.entries(manifest.files)) {
  const absolute = path.resolve(repo, relative);
  assert.ok(absolute.startsWith(`${repo}${path.sep}`), `pin path escaped repository: ${relative}`);
  const bytes = await readFile(absolute);
  const actual = createHash('sha256').update(bytes).digest('hex');
  assert.equal(actual, expected, `source pin changed: ${relative}`);
}
const html = await readFile(path.join(here, 'clothing-body-shoe-ab-v6.html'), 'utf8');
assert.match(html, /src="\.\/clothing-body-shoe-ab-v6\.js"/);
console.log(JSON.stringify({ status: 'PASS', files: Object.keys(manifest.files).length, manifest: createHash('sha256').update(await readFile(manifestPath)).digest('hex') }));
