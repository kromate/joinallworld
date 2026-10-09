#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const manifestPath = 'evidence/graphics-loop/authored-complete-body-v1/native-full-runtime-v1/office-pixel-attribution-source-pins-v3.json';
const manifest = JSON.parse(await readFile(path.join(root, manifestPath), 'utf8'));
if (manifest.status !== 'source-prepared-not-executed') throw new Error(`Unexpected diagnostic state: ${manifest.status}`);
if (!/^[a-f0-9]{64}$/.test(manifest.sourceBodyIndexSha256 ?? '')) throw new Error('Missing or malformed source Body index digest');
if (!Array.isArray(manifest.files) || manifest.files.length < 8) throw new Error('Pinned file list is incomplete');

const seen = new Set();
for (const entry of manifest.files) {
  if (!entry || typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
    throw new Error(`Malformed pin entry: ${JSON.stringify(entry)}`);
  }
  if (seen.has(entry.path)) throw new Error(`Duplicate pinned path: ${entry.path}`);
  seen.add(entry.path);
  const resolved = path.resolve(root, entry.path);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Pinned path escapes repository: ${entry.path}`);
  const info = await stat(resolved);
  if (!info.isFile() || info.size !== entry.bytes) throw new Error(`Pinned file size/type mismatch: ${entry.path}`);
  const digest = createHash('sha256').update(await readFile(resolved)).digest('hex');
  if (digest !== entry.sha256) throw new Error(`Pinned SHA-256 mismatch: ${entry.path}: ${digest}`);
}

const fixture = manifest.files.find((entry) => entry.path.endsWith('/calf-component-toggle-v2/office-pixel-attribution-v1.ts'));
if (!fixture || !(await readFile(path.resolve(root, fixture.path), 'utf8')).includes(manifest.sourceBodyIndexSha256) || !(await readFile(path.resolve(root, fixture.path), 'utf8')).includes('sourceFace == null')) {
  throw new Error('Fixture does not enforce the pinned raw source Body index digest');
}
console.log(JSON.stringify({ status: 'pins-verified', count: manifest.files.length, sourceBodyIndexSha256: manifest.sourceBodyIndexSha256 }, null, 2));
