/** Preserve the complete Runtime.evaluate exception payload in a JSON-safe form. */
export function serializeCdpExceptionDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    throw new TypeError('CDP exceptionDetails must be an object');
  }
  const raw = JSON.parse(JSON.stringify(details));
  return {
    text: typeof details.text === 'string' ? details.text : null,
    exceptionDescription: typeof details.exception?.description === 'string' ? details.exception.description : null,
    exceptionValue: details.exception && Object.hasOwn(details.exception, 'value') ? details.exception.value : null,
    exceptionClassName: typeof details.exception?.className === 'string' ? details.exception.className : null,
    exceptionSubtype: typeof details.exception?.subtype === 'string' ? details.exception.subtype : null,
    lineNumber: Number.isInteger(details.lineNumber) ? details.lineNumber : null,
    columnNumber: Number.isInteger(details.columnNumber) ? details.columnNumber : null,
    url: typeof details.url === 'string' ? details.url : null,
    stackTrace: details.stackTrace ?? null,
    raw,
  };
}

export function pageEvaluationError(details) {
  const cdpException = serializeCdpExceptionDetails(details);
  const message = cdpException.exceptionDescription || cdpException.text || 'Uncaught page evaluation exception';
  return Object.assign(new Error(`Page evaluation failed: ${message}`), { cdpException });
}
