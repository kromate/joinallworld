// Fixed SIGKILL startup witness, never selected by the production bootstrap API.
import assert from 'node:assert/strict';
import { bootstrapFeatureIndex } from './index_bootstrap.ts';

const selected = process.argv[2];
assert.ok(selected && ['empty-file', 'schema-checkpointed', 'before-rename', 'after-rename'].includes(selected));
bootstrapFeatureIndex(boundary => {
  if (boundary === selected) process.kill(process.pid, 'SIGKILL');
});
throw Error('Fixed bootstrap witness did not reach its selected abrupt-exit boundary.');
