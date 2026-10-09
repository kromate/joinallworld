#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const manifestPath = 'evidence/graphics-loop/authored-complete-body-v1/native-full-runtime-v1/trouser-sock-trim-ab-v4/source-pins-v4.json';
const manifest = JSON.parse(await readFile(path.join(root, manifestPath), 'utf8'));
if (manifest.status !== 'source-prepared-not-executed' || !Array.isArray(manifest.files)) throw new Error('Unexpected sock V4 source manifest');
const seen = new Set();
for (const entry of manifest.files) {
  if (!entry || typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || !Number.isSafeInteger(entry.bytes)) throw new Error(`Malformed pin: ${JSON.stringify(entry)}`);
  if (seen.has(entry.path)) throw new Error(`Duplicate pinned path: ${entry.path}`);
  seen.add(entry.path);
  const file = path.resolve(root, entry.path);
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error(`Pin escapes repository: ${entry.path}`);
  const info = await stat(file);
  if (!info.isFile() || info.size !== entry.bytes) throw new Error(`Pinned byte count mismatch: ${entry.path}`);
  const actual = createHash('sha256').update(await readFile(file)).digest('hex');
  if (actual !== entry.sha256) throw new Error(`Pinned SHA mismatch: ${entry.path}: ${actual}`);
}
console.log(JSON.stringify({ status: 'pins-verified', files: manifest.files.length }, null, 2));
