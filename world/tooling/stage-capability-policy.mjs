const ENABLED = '1';
const DISABLED = '0';
const SHA256 = /^[a-f0-9]{64}$/;

function assertCapability(value, label) {
  if (value !== undefined && value !== ENABLED && value !== DISABLED) {
    throw new TypeError(`${label} must be the literal 1 or 0`);
  }
}

export function resolveInteractiveTeachingStarts(requested, checkpointValue) {
  assertCapability(requested, '--interactive-teaching-starts');
  assertCapability(checkpointValue, 'checkpoint interactiveTeachingStarts');
  // A checkpoint records history, not permission. ON must be requested for
  // each finite process window; an omitted value always means OFF.
  return requested ?? DISABLED;
}

export function interactiveTeachingBindings(value) {
  assertCapability(value, 'interactiveTeachingStarts');
  return value === ENABLED ? Object.freeze({ INTERACTIVE_TEACHING_STARTS: ENABLED }) : Object.freeze({});
}

export function assertPinnedStageToolingSha(expected, actual, label) {
  if (typeof expected !== 'string' || !SHA256.test(expected)) throw new TypeError(`${label} pin must be exactly 64 lowercase hexadecimal characters`);
  if (typeof actual !== 'string' || !SHA256.test(actual)) throw new TypeError(`${label} actual SHA-256 is invalid`);
  if (actual !== expected) throw new Error(`${label} SHA-256 does not match its explicit staging pin`);
  return actual;
}
