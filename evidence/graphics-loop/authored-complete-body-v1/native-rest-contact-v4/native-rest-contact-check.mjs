import assert from 'node:assert/strict';
import { validateNativeRestPropSurface } from './native-rest-contact.ts';

const surface = (pose, prop) => ({ id: `fixture-${prop}`, pose, prop, surfaceYAt: () => 0,
  ...(pose === 'wash' ? { headZone: { contains: () => true } } : {}) });

for (const [pose, prop] of [['lie', 'bed'], ['lie', 'mat'], ['soak', 'tub'], ['wash', 'shower']]) {
  assert.doesNotThrow(() => validateNativeRestPropSurface(surface(pose, prop)));
}
for (const [pose, prop] of [['lie', 'tub'], ['soak', 'bed'], ['wash', 'bucket'], ['wash', 'mat']]) {
  assert.throws(() => validateNativeRestPropSurface(surface(pose, prop)), /cannot support|actual shower/);
}
assert.throws(() => validateNativeRestPropSurface({ ...surface('wash', 'shower'), headZone: undefined }), /actual shower/);
assert.throws(() => validateNativeRestPropSurface({ ...surface('lie', 'bed'), surfaceYAt: undefined }), /actual prop-surface query/);
assert.throws(() => validateNativeRestPropSurface({ ...surface('lie', 'bed'), id: '  ' }), /host prop id/);

console.log(JSON.stringify({ status: 'pass', allowed: 4, mismatchesRejected: 4,
  missingShowerZoneRejected: true, missingSurfaceQueryRejected: true, blankPropIdRejected: true,
  limitation: 'Contract-only checks; no actual prop geometry or rendered pose is measured.' }, null, 2));
