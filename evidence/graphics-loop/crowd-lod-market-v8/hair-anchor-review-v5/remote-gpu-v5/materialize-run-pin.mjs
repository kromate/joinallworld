import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const template = JSON.parse(await readFile(path.join(here, 'artifact-pin.json'), 'utf8'));
const required = ['PACKAGE_RUN_ID','PACKAGE_COMMIT','PACKAGE_BRANCH','PACKAGE_MANIFEST_SHA256','HAIR_REVIEW_PIN_PATH'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing successful CPU-job output ${key}`);
if (!/^\d+$/.test(process.env.PACKAGE_RUN_ID) || !/^[a-f0-9]{40}$/.test(process.env.PACKAGE_COMMIT)
  || !/^[a-f0-9]{64}$/.test(process.env.PACKAGE_MANIFEST_SHA256)) throw new Error('Malformed package job provenance output');
if (process.env.PACKAGE_BRANCH !== 'codex/graphics-hair-anchor-v5') throw new Error('Unexpected package workflow branch');
template.packageRunId = process.env.PACKAGE_RUN_ID;
template.packageCommit = process.env.PACKAGE_COMMIT;
template.packageBranch = process.env.PACKAGE_BRANCH;
template.artifactName = `market-hair-anchor-cpu-package-v5-${template.packageRunId}`;
template.packageManifestSha256 = process.env.PACKAGE_MANIFEST_SHA256;
const bytes = Buffer.from(`${JSON.stringify(template, null, 2)}\n`);
await writeFile(process.env.HAIR_REVIEW_PIN_PATH, bytes, { flag: 'wx' });
console.log(JSON.stringify({status:'same-run-cpu-pin-materialized',runId:template.packageRunId,commit:template.packageCommit,artifactName:template.artifactName,manifestSha256:template.packageManifestSha256,pinSha256:createHash('sha256').update(bytes).digest('hex')}));
