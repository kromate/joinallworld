import test from 'node:test';
import assert from 'node:assert/strict';
import { createGlbRequestLifecycle, strictNetworkGateFailure } from './glb-request-lifecycle.mjs';

const request = (requestId, url, extra = {}) => ({
  requestId, request: { url, method: 'GET' }, type: 'XHR', frameId: 'frame-1', loaderId: 'loader-1', timestamp: 1, wallTime: 100,
  initiator: { type: 'script', stack: { callFrames: [{ functionName: 'loadBody', url: 'http://127.0.0.1/src/scene/body/skinned.ts', lineNumber: 10 }] } }, ...extra,
});

test('GLB lifecycle retains initiator, response, finish timing and encoded bytes', () => {
  let now = 10;
  const trace = createGlbRequestLifecycle(() => now++);
  trace.onRequest(request('body-1', 'http://127.0.0.1/assets/man.glb'));
  trace.onResponse({ requestId: 'body-1', timestamp: 2, response: { url: 'http://127.0.0.1/assets/man.glb', status: 200, mimeType: 'model/gltf-binary', encodedDataLength: 8192 } });
  trace.onFinished({ requestId: 'body-1', timestamp: 3, encodedDataLength: 8192 });
  const [row] = trace.snapshot();
  assert.equal(row.initiator.stack.callFrames[0].functionName, 'loadBody');
  assert.equal(row.response.status, 200);
  assert.equal(row.finished.encodedDataLength, 8192);
  assert.deepEqual(trace.pending(), []);
});

test('redirect chain is retained and a canceled GLB remains failed, never pending or waived', () => {
  let now = 20;
  const trace = createGlbRequestLifecycle(() => now++);
  trace.onRequest(request('clip-1', 'http://127.0.0.1/clip-pack.glb'));
  trace.onRequest(request('clip-1', 'http://127.0.0.1/assets/clip-pack.glb', { redirectResponse: { status: 302, headers: { location: '/assets/clip-pack.glb' } }, timestamp: 2 }));
  trace.onResponse({ requestId: 'clip-1', timestamp: 3, response: { url: 'http://127.0.0.1/assets/clip-pack.glb', status: 200, mimeType: 'model/gltf-binary', encodedDataLength: 4096 } });
  trace.onData({ requestId: 'clip-1', timestamp: 3.5, dataLength: 2048, encodedDataLength: 2048 });
  trace.onFailed({ requestId: 'clip-1', timestamp: 4, errorText: 'net::ERR_ABORTED', canceled: true });
  const [row] = trace.snapshot();
  assert.equal(row.redirects.length, 1);
  assert.equal(row.failed.canceled, true);
  assert.equal(row.failed.errorText, 'net::ERR_ABORTED');
  assert.equal(row.dataReceived.reduce((sum, chunk) => sum + chunk.dataLength, 0), 2048);
  assert.equal(row.finished, null);
  assert.deepEqual(trace.pending(), []);
});

test('in-flight GLB is explicitly reported pending and non-GLB requests are excluded', () => {
  const trace = createGlbRequestLifecycle(() => 30);
  trace.onRequest(request('body-2', 'http://127.0.0.1/assets/woman.glb'));
  trace.onRequest(request('script-1', 'http://127.0.0.1/viewer.js'));
  assert.deepEqual(trace.pending(), ['body-2']);
  assert.equal(trace.snapshot().length, 1);
});

test('strict browser gate blocks canceled GLBs and pending requests but accepts a completed clean trace', () => {
  const empty = { runtimeExceptions: [], consoleErrors: [], httpErrors: [], failedRequests: [] };
  assert.deepEqual(strictNetworkGateFailure(empty, []), []);
  assert.deepEqual(strictNetworkGateFailure({ ...empty, failedRequests: [{ canceled: true, errorText: 'net::ERR_ABORTED' }] }, []), ['failed-requests']);
  assert.deepEqual(strictNetworkGateFailure(empty, ['woman-body-request']), ['pending-glb-requests']);
  assert.deepEqual(strictNetworkGateFailure({ ...empty, consoleErrors: ['shader fail'] }, ['clip-request']), ['console-errors', 'pending-glb-requests']);
});
