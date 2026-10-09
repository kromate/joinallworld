// Fixed abrupt-exit cases for supervised capture-ingestion recovery checks.
// This accepts only named boundaries and performs no arbitrary code execution.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ingestFeatureIndex } from './index_ingest.ts';

const allowed = new Set(['before-transaction', 'after-commit', 'after-checkpoint']);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const selected = process.argv[2];
  assert.equal(process.argv.length, 3, 'Ingestion crash witness requires exactly one boundary.');
  assert.ok(selected && allowed.has(selected), 'Ingestion crash boundary is not registered.');
  ingestFeatureIndex(boundary => {
    if (boundary === selected) process.kill(process.pid, 'SIGKILL');
  });
  throw new Error('Fixed ingestion crash witness did not reach its selected boundary.');
}
