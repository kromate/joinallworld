export function validateCaptureViewport(rect, layoutViewport, visualViewport, pageCoordinates, documentViewport, epsilon = 0.5) {
  const rectFields = ['x', 'y', 'width', 'height'];
  const layoutFields = ['width', 'height'];
  const visualFields = ['offsetLeft', 'offsetTop', 'pageLeft', 'pageTop', 'width', 'height'];
  const finite = (value, fields) => value && fields.every(field => Number.isFinite(value[field]));
  if (!finite(rect, rectFields) || rect.width <= 0 || rect.height <= 0) {
    return { valid: false, reason: 'invalid-capture-rect' };
  }
  if (!finite(layoutViewport, layoutFields) || layoutViewport.width <= 0 || layoutViewport.height <= 0) {
    return { valid: false, reason: 'invalid-layout-viewport' };
  }
  if (!finite(visualViewport, visualFields) || visualViewport.width <= 0 || visualViewport.height <= 0) {
    return { valid: false, reason: 'invalid-visual-viewport' };
  }
  const pageFields = ['scrollX', 'scrollY', 'layoutPageX', 'layoutPageY', 'pageX', 'pageY'];
  if (!finite(pageCoordinates, pageFields)) return { valid: false, reason: 'invalid-page-coordinates' };
  const documentFields = ['clientWidth', 'clientHeight', 'innerWidth', 'innerHeight', 'scrollbarWidth', 'scrollbarHeight'];
  if (!finite(documentViewport, documentFields) || documentViewport.clientWidth <= 0 || documentViewport.clientHeight <= 0
    || documentViewport.innerWidth <= 0 || documentViewport.innerHeight <= 0) {
    return { valid: false, reason: 'invalid-document-viewport' };
  }
  if (!Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1) {
    return { valid: false, reason: 'invalid-boundary-epsilon' };
  }
  const pageCoordinatesAgree = Math.abs(visualViewport.pageLeft - pageCoordinates.scrollX) <= epsilon
    && Math.abs(visualViewport.pageTop - pageCoordinates.scrollY) <= epsilon
    && Math.abs(visualViewport.pageLeft - pageCoordinates.pageX) <= epsilon
    && Math.abs(visualViewport.pageTop - pageCoordinates.pageY) <= epsilon
    && Math.abs(visualViewport.pageLeft - pageCoordinates.layoutPageX) <= epsilon
    && Math.abs(visualViewport.pageTop - pageCoordinates.layoutPageY) <= epsilon;
  if (!pageCoordinatesAgree) return { valid: false, reason: 'page-coordinate-disagreement', pageCoordinatesAgree };
  const layoutViewportMatchesDocument = Math.abs(layoutViewport.width - documentViewport.clientWidth) <= epsilon
    && Math.abs(layoutViewport.height - documentViewport.clientHeight) <= epsilon;
  if (!layoutViewportMatchesDocument) return { valid: false, reason: 'document-layout-disagreement', layoutViewportMatchesDocument };
  const measuredScrollbarWidth = documentViewport.innerWidth - documentViewport.clientWidth;
  const measuredScrollbarHeight = documentViewport.innerHeight - documentViewport.clientHeight;
  const scrollbarMetricsAgree = measuredScrollbarWidth >= 0 && measuredScrollbarHeight >= 0
    && measuredScrollbarWidth <= 64 && measuredScrollbarHeight <= 64
    && documentViewport.scrollbarWidth >= 0 && documentViewport.scrollbarWidth <= 64
    && documentViewport.scrollbarHeight >= 0 && documentViewport.scrollbarHeight <= 64
    && Math.abs(measuredScrollbarWidth - documentViewport.scrollbarWidth) <= epsilon
    && Math.abs(measuredScrollbarHeight - documentViewport.scrollbarHeight) <= epsilon;
  if (!scrollbarMetricsAgree) return { valid: false, reason: 'inconsistent-scrollbar-metrics', scrollbarMetricsAgree };

  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const layoutContained = rect.x >= -epsilon && rect.y >= -epsilon
    && right <= layoutViewport.width + epsilon && bottom <= layoutViewport.height + epsilon;
  const visualContained = rect.x >= visualViewport.offsetLeft - epsilon
    && rect.y >= visualViewport.offsetTop - epsilon
    && right <= visualViewport.offsetLeft + visualViewport.width + epsilon
    && bottom <= visualViewport.offsetTop + visualViewport.height + epsilon;
  const valid = layoutContained && visualContained;
  return {
    valid,
    reason: valid ? null : (layoutContained ? 'outside-visual-viewport' : 'outside-layout-viewport'),
    layoutContained,
    visualContained,
    pageCoordinatesAgree,
    layoutViewportMatchesDocument,
    scrollbarMetricsAgree,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    layoutViewport: { width: layoutViewport.width, height: layoutViewport.height },
    visualViewport: { offsetLeft: visualViewport.offsetLeft, offsetTop: visualViewport.offsetTop,
      pageLeft: visualViewport.pageLeft, pageTop: visualViewport.pageTop,
      width: visualViewport.width, height: visualViewport.height },
    pageCoordinates: { scrollX: pageCoordinates.scrollX, scrollY: pageCoordinates.scrollY,
      layoutPageX: pageCoordinates.layoutPageX, layoutPageY: pageCoordinates.layoutPageY,
      pageX: pageCoordinates.pageX, pageY: pageCoordinates.pageY },
    documentViewport: { ...documentViewport, measuredScrollbarWidth, measuredScrollbarHeight },
    clip: { x: rect.x + visualViewport.pageLeft, y: rect.y + visualViewport.pageTop,
      width: rect.width, height: rect.height, scale: 1 },
  };
}
