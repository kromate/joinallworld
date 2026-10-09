import test from 'node:test';
import assert from 'node:assert/strict';
import { pageEvaluationError, serializeCdpExceptionDetails } from './cdp-exception.mjs';

test('CDP serializer keeps exception value, description, source coordinates, and complete stack payload', () => {
  const payload = {
    text: 'Uncaught',
    lineNumber: 23,
    columnNumber: 8,
    url: 'http://127.0.0.1:4000/assets/app.js',
    exception: { type: 'object', subtype: 'error', className: 'TypeError', value: undefined, description: 'TypeError: expected mesh geometry' },
    stackTrace: { callFrames: [{ functionName: 'load', url: 'http://127.0.0.1:4000/assets/app.js', lineNumber: 23, columnNumber: 8 }] },
  };
  const serialized = serializeCdpExceptionDetails(payload);
  assert.equal(serialized.text, 'Uncaught');
  assert.equal(serialized.exceptionDescription, 'TypeError: expected mesh geometry');
  assert.equal(serialized.exceptionClassName, 'TypeError');
  assert.equal(serialized.exceptionSubtype, 'error');
  assert.equal(serialized.lineNumber, 23);
  assert.equal(serialized.columnNumber, 8);
  assert.deepEqual(serialized.stackTrace, payload.stackTrace);
  assert.deepEqual(serialized.raw, JSON.parse(JSON.stringify(payload)));
});

test('page evaluation errors retain structured CDP details instead of collapsing to Uncaught', () => {
  const details = {
    text: 'Uncaught', lineNumber: 3, columnNumber: 4,
    exception: { description: 'RangeError: source face 17 did not close', value: 17 },
    stackTrace: { callFrames: [{ functionName: 'loadActors', lineNumber: 9, columnNumber: 2 }] },
  };
  const error = pageEvaluationError(details);
  assert.match(error.message, /RangeError: source face 17 did not close/);
  assert.deepEqual(error.cdpException.raw, details);
  assert.equal(error.cdpException.exceptionValue, 17);
  assert.equal(error.cdpException.stackTrace.callFrames[0].functionName, 'loadActors');
});

test('malformed exception payloads fail closed', () => {
  assert.throws(() => serializeCdpExceptionDetails(null), /must be an object/);
  assert.throws(() => serializeCdpExceptionDetails([]), /must be an object/);
});
