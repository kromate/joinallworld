import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const manifestPath='evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/remote-render-v1/review-sources-sofa-v1.json';
const bytes=readFileSync(manifestPath);
assert.equal(createHash('sha256').update(bytes).digest('hex'),process.argv[2]);
const manifest=JSON.parse(bytes);
assert.equal(manifest.schema,'sofa-upholstery-v1-remote-review-source-pins/1');
assert.equal(manifest.files.length,11);
for(const entry of manifest.files){
 const full=path.resolve(entry.path);assert.ok(full.startsWith(process.cwd()+path.sep));
 const content=readFileSync(full);assert.equal(content.length,entry.bytes,entry.path);
 assert.equal(createHash('sha256').update(content).digest('hex'),entry.sha256,entry.path);
}
console.log(JSON.stringify({status:'VERIFIED_EXISTING_FROZEN_MANIFEST',files:manifest.files.length,manifestSha256:process.argv[2]}));
