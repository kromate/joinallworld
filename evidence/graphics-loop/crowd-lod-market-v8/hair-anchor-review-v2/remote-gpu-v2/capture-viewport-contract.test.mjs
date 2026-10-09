import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCaptureViewport } from './capture-viewport-contract.mjs';

const layout = { width: 1280, height: 800 };
const visual = { offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, width: 1280, height: 800 };
const page = { scrollX: 0, scrollY: 0, layoutPageX: 0, layoutPageY: 0, pageX: 0, pageY: 0 };
const documentViewport = { clientWidth: 1280, clientHeight: 800, innerWidth: 1280, innerHeight: 800, scrollbarWidth: 0, scrollbarHeight: 0 };

test('accepts a fully visible canvas with overlay scrollbars', () => {
  const result = validateCaptureViewport({ x: 16, y: 96.36, width: 888, height: 608 }, layout, visual, page, documentViewport);
  assert.equal(result.valid, true);
  assert.deepEqual(result.clip, { x: 16, y: 96.36, width: 888, height: 608, scale: 1 });
  assert.equal(result.documentViewport.measuredScrollbarWidth, 0);
});

test('accepts the observed 15px vertical scrollbar while containing the canvas in the narrower CSS viewport', () => {
  const scrolledLayout = { width: 1265, height: 800 };
  const scrolledVisual = { offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 233, width: 1265, height: 800 };
  const scrolledPage = { scrollX: 0, scrollY: 233, layoutPageX: 0, layoutPageY: 233, pageX: 0, pageY: 233 };
  const doc = { clientWidth: 1265, clientHeight: 800, innerWidth: 1280, innerHeight: 800, scrollbarWidth: 15, scrollbarHeight: 0 };
  const result = validateCaptureViewport({ x: 29, y: 163.359375, width: 671, height: 608 },
    scrolledLayout, scrolledVisual, scrolledPage, doc);
  assert.equal(result.valid, true);
  assert.deepEqual(result.clip, { x: 29, y: 396.359375, width: 671, height: 608, scale: 1 });
  assert.equal(result.documentViewport.measuredScrollbarWidth, 15);
  assert.equal(result.layoutViewportMatchesDocument, true);
  assert.equal(result.visualContained, true);
});

test('rejects the observed uncaptured canvas bottom instead of producing a truncated image', () => {
  const result = validateCaptureViewport({ x: 16, y: 396.359375, width: 888, height: 608 }, layout, visual, page, documentViewport);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'outside-layout-viewport');
});

test('rejects each clipped edge and a visual viewport smaller than layout', () => {
  assert.equal(validateCaptureViewport({ x: -1, y: 0, width: 10, height: 10 }, layout, visual, page, documentViewport).valid, false);
  assert.equal(validateCaptureViewport({ x: 0, y: -1, width: 10, height: 10 }, layout, visual, page, documentViewport).valid, false);
  assert.equal(validateCaptureViewport({ x: 1275, y: 0, width: 10, height: 10 }, layout, visual, page, documentViewport).valid, false);
  assert.equal(validateCaptureViewport({ x: 0, y: 785, width: 10, height: 10 }, layout,
    { ...visual, height: 790 }, page, documentViewport).reason, 'outside-visual-viewport');
});

test('converts a visible viewport rectangle to document coordinates after nonzero scroll', () => {
  const scrolledVisual = { ...visual, pageLeft: 320, pageTop: 640 };
  const scrolledPage = { scrollX: 320, scrollY: 640, layoutPageX: 320, layoutPageY: 640, pageX: 320, pageY: 640 };
  const result = validateCaptureViewport({ x: 16, y: 96, width: 888, height: 608 }, layout, scrolledVisual, scrolledPage, documentViewport);
  assert.equal(result.valid, true);
  assert.deepEqual(result.clip, { x: 336, y: 736, width: 888, height: 608, scale: 1 });
});

test('rejects disagreement in viewport page-coordinate sources', () => {
  const scrolledVisual = { ...visual, pageLeft: 320, pageTop: 640 };
  const rect = { x: 16, y: 96, width: 888, height: 608 };
  assert.equal(validateCaptureViewport(rect, layout, scrolledVisual,
    { ...page, scrollX: 0, scrollY: 640, layoutPageX: 320, layoutPageY: 640, pageX: 320, pageY: 640 }, documentViewport).reason,
  'page-coordinate-disagreement');
  assert.equal(validateCaptureViewport(rect, layout, scrolledVisual,
    { ...page, scrollX: 320, scrollY: 640, layoutPageX: 320, layoutPageY: 640, pageX: 320, pageY: 639 }, documentViewport).reason,
  'page-coordinate-disagreement');
});

test('rejects inconsistent document/layout client dimensions and scrollbar measurements', () => {
  const rect = { x: 10, y: 10, width: 20, height: 20 };
  assert.equal(validateCaptureViewport(rect, layout, visual, page,
    { ...documentViewport, clientWidth: 1265, innerWidth: 1280, scrollbarWidth: 15 }).reason,
  'document-layout-disagreement');
  assert.equal(validateCaptureViewport(rect, { ...layout, width: 1265 }, visual, page,
    { ...documentViewport, clientWidth: 1265, innerWidth: 1280, scrollbarWidth: 0 }).reason,
  'inconsistent-scrollbar-metrics');
});

test('rejects negative/oversized scrollbar extent and invalid viewport dimensions', () => {
  const rect = { x: 10, y: 10, width: 20, height: 20 };
  assert.equal(validateCaptureViewport(rect, layout, visual, page,
    { ...documentViewport, innerWidth: 1279, clientWidth: 1280, scrollbarWidth: -1 }).reason,
  'inconsistent-scrollbar-metrics');
  assert.equal(validateCaptureViewport(rect, { ...layout, width: 1215 }, visual, page,
    { ...documentViewport, clientWidth: 1215, innerWidth: 1280, scrollbarWidth: 65 }).reason,
  'inconsistent-scrollbar-metrics');
  assert.equal(validateCaptureViewport(rect, layout, visual, page,
    { ...documentViewport, innerWidth: 0 }).reason, 'invalid-document-viewport');
  assert.equal(validateCaptureViewport({ x: 0, y: 0, width: Infinity, height: 10 }, layout, visual, page, documentViewport).valid, false);
  assert.equal(validateCaptureViewport(rect, layout, visual, page, documentViewport, 4).reason, 'invalid-boundary-epsilon');
});
