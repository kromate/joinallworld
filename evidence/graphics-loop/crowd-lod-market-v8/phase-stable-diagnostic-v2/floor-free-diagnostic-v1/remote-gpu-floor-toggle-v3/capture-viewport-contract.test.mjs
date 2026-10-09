import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCaptureViewport } from './capture-viewport-contract.mjs';

const layout = { width: 1280, height: 800 };
const visual = { offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, width: 1280, height: 800 };
const page = { scrollX: 0, scrollY: 0, layoutPageX: 0, layoutPageY: 0, pageX: 0, pageY: 0 };

test('accepts the canvas after scrolling fully into the 1280x800 viewport', () => {
  const result = validateCaptureViewport({ x: 16, y: 96.36, width: 888, height: 608 }, layout, visual, page);
  assert.equal(result.valid, true);
  assert.deepEqual(result.clip, { x: 16, y: 96.36, width: 888, height: 608, scale: 1 });
});

test('rejects the observed uncaptured canvas bottom instead of producing a truncated image', () => {
  const result = validateCaptureViewport({ x: 16, y: 396.359375, width: 888, height: 608 }, layout, visual, page);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'outside-layout-viewport');
});

test('rejects each clipped edge and the visual viewport when smaller than layout', () => {
  assert.equal(validateCaptureViewport({ x: -1, y: 0, width: 10, height: 10 }, layout, visual, page).valid, false);
  assert.equal(validateCaptureViewport({ x: 0, y: -1, width: 10, height: 10 }, layout, visual, page).valid, false);
  assert.equal(validateCaptureViewport({ x: 1275, y: 0, width: 10, height: 10 }, layout, visual, page).valid, false);
  assert.equal(validateCaptureViewport({ x: 0, y: 785, width: 10, height: 10 }, layout,
    { offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, width: 1280, height: 790 }, page).reason,
  'outside-visual-viewport');
});

test('converts a fully visible viewport rect to document coordinates after a nonzero scroll', () => {
  const scrolledVisual = { offsetLeft: 0, offsetTop: 0, pageLeft: 320, pageTop: 640, width: 1280, height: 800 };
  const scrolledPage = { scrollX: 320, scrollY: 640, layoutPageX: 320, layoutPageY: 640, pageX: 320, pageY: 640 };
  const result = validateCaptureViewport({ x: 16, y: 96, width: 888, height: 608 }, layout, scrolledVisual, scrolledPage);
  assert.equal(result.valid, true);
  assert.deepEqual(result.clip, { x: 336, y: 736, width: 888, height: 608, scale: 1 });
  assert.deepEqual(result.pageCoordinates, scrolledPage);
});

test('rejects disagreement between visual page origin, window scroll, and CDP page origin', () => {
  const rect = { x: 16, y: 96, width: 888, height: 608 };
  const scrolledVisual = { offsetLeft: 0, offsetTop: 0, pageLeft: 320, pageTop: 640, width: 1280, height: 800 };
  assert.equal(validateCaptureViewport(rect, layout, scrolledVisual,
    { scrollX: 0, scrollY: 640, layoutPageX: 320, layoutPageY: 640, pageX: 320, pageY: 640 }).reason,
  'page-coordinate-disagreement');
  assert.equal(validateCaptureViewport(rect, layout, scrolledVisual,
    { scrollX: 320, scrollY: 640, layoutPageX: 320, layoutPageY: 640, pageX: 320, pageY: 639 }).reason,
  'page-coordinate-disagreement');
});

test('rejects malformed dimensions rather than returning a screenshot clip', () => {
  assert.equal(validateCaptureViewport({ x: 0, y: 0, width: 0, height: 10 }, layout, visual, page).reason, 'invalid-capture-rect');
  assert.equal(validateCaptureViewport({ x: 0, y: 0, width: Infinity, height: 10 }, layout, visual, page).valid, false);
  assert.equal(validateCaptureViewport({ x: 0, y: 0, width: 10, height: 10 }, { width: NaN, height: 800 }, visual, page).reason,
    'invalid-layout-viewport');
  assert.equal(validateCaptureViewport({ x: 0, y: 0, width: 10, height: 10 }, layout, visual, page, 4).reason,
    'invalid-boundary-epsilon');
  assert.equal(validateCaptureViewport({ x: 0, y: 0, width: 10, height: 10 }, layout, visual).reason,
    'invalid-page-coordinates');
});
