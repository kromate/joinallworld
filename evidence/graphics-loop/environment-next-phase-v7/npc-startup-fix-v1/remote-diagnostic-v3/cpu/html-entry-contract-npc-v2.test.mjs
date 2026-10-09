import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rewriteHtmlEntry, validateHtmlPackage } from './html-entry-contract-npc-v2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const witness = JSON.parse(await readFile(path.join(here, 'actual-v1-entry-witness.json'), 'utf8'));
const actualRoutes = witness.actualManifestRouteOutputs;
const packageRecord = {
  entryOutput: witness.compiledEntry.path, htmlEntry: `./${witness.compiledEntry.path}`,
  importMap: witness.actualManifestImportMap,
};
const htmlWith = (moduleTag) => `<html><head><script type="importmap">${JSON.stringify({ imports: witness.actualManifestImportMap })}</script>${moduleTag}</head></html>`;

test('actual v1 HTML and emitted-output witness are rejected as mismatched', () => {
  assert.equal(witness.sourceRunId, '37911271949');
  assert.equal(witness.sourceCommit, '0da02ca0f0e0c4350f2754615f58b2dcd6eaed37');
  assert.equal(witness.htmlSha256, '7eb23066dcf3f0362b95d4001cba5bb17203e4c6785fede9922b249dc226fccb');
  assert.equal(witness.manifestSha256, 'cfbe9edd8e6f0a4fec998e2584245512b7a5b10a4e66724ea04dd4aa4e8d3e30');
  assert.equal(witness.compiledEntry.sha256, 'f5270d9e1ad0420b008b02150b4d1e6c165b8be69b3ca6fdd449fb5b215f492b');
  assert.throws(() => validateHtmlPackage(htmlWith(witness.htmlModuleTag), packageRecord, actualRoutes),
    /HTML requests app\/viewer\.js, but compiler emitted entry app\/viewer-npc-v1\.js/);
});

test('corrected HTML entry passes against actual v1 manifest route hashes and exact import map', () => {
  const tag = '<script type="module" src="./app/viewer-npc-v1.js"></script>';
  const corrected = htmlWith(tag);
  const result = validateHtmlPackage(corrected, packageRecord, actualRoutes);
  assert.equal(result.entryOutput, 'app/viewer-npc-v1.js');
  assert.equal(result.output.sha256, witness.compiledEntry.sha256);
});

test('rewrite selects emitted entry; missing/aliased entry and missing import target fail closed', () => {
  const html = '<head><script type="module" src="./viewer-npc-v1.ts"></script></head>';
  const rewritten = rewriteHtmlEntry(html, '<script type="module" src="./viewer-npc-v1.ts"></script>',
    { imports: packageRecord.importMap }, packageRecord.entryOutput, actualRoutes);
  assert.match(rewritten, /src="\.\/app\/viewer-npc-v1\.js"/);
  assert.equal(validateHtmlPackage(rewritten, packageRecord, actualRoutes).entryOutput, packageRecord.entryOutput);
  assert.throws(() => validateHtmlPackage(htmlWith('<script type="module" src="./app/viewer-alias.js"></script>'), packageRecord, actualRoutes), /HTML requests app\/viewer-alias\.js/);
  assert.throws(() => validateHtmlPackage(rewritten, packageRecord, actualRoutes.filter(row => row.path !== 'vendor/three.module.js')), /Import-map target is absent/);
});

 test('actual emitted stylesheet must resolve without filename aliases', () => {
  const good = htmlWith('<script type="module" src="./app/viewer-npc-v1.js"></script>');
  const css = {path:'app/viewer-npc-v1.css',bytes:12,sha256:'1'.repeat(64)};
  assert.equal(validateHtmlPackage(good+'<link rel="stylesheet" href="./app/viewer-npc-v1.css">',packageRecord,[...actualRoutes,css]).entryOutput,packageRecord.entryOutput);
  assert.throws(()=>validateHtmlPackage(good+'<link rel="stylesheet" href="./app/viewer.css">',packageRecord,[...actualRoutes,css]), /Stylesheet absent/);
 });
