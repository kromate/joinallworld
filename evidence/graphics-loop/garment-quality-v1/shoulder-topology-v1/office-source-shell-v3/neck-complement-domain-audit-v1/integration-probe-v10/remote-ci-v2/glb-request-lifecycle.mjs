const isGlb = (url) => typeof url === 'string' && /\.glb(?:[?#]|$)/i.test(url);

/** Records full CDP request lifecycles without changing the browser's failure policy. */
export function createGlbRequestLifecycle(now = () => Date.now()) {
  const requests = new Map();
  const record = (id) => requests.get(id);
  return Object.freeze({
    onRequest(params) {
      const previous = record(params.requestId);
      const request = {
        requestId: params.requestId,
        url: params.request.url,
        method: params.request.method,
        resourceType: params.type ?? null,
        frameId: params.frameId ?? null,
        loaderId: params.loaderId ?? null,
        initiator: params.initiator ?? null,
        startedAt: now(),
        cdpStartedAt: params.timestamp ?? null,
        wallTime: params.wallTime ?? null,
        redirects: previous?.redirects ?? [],
        response: null,
        dataReceived: [],
        finished: null,
        failed: null,
      };
      if (params.redirectResponse && previous) {
        previous.redirects.push({
          url: previous.url,
          status: params.redirectResponse.status,
          headers: params.redirectResponse.headers ?? {},
          receivedAt: now(),
          cdpTimestamp: params.timestamp ?? null,
        });
      }
      if (isGlb(request.url) || previous) requests.set(params.requestId, request);
    },
    onResponse(params) {
      const item = record(params.requestId);
      if (!item) return;
      item.response = {
        url: params.response.url,
        status: params.response.status,
        mimeType: params.response.mimeType ?? null,
        protocol: params.response.protocol ?? null,
        fromDiskCache: params.response.fromDiskCache ?? false,
        fromServiceWorker: params.response.fromServiceWorker ?? false,
        encodedDataLength: params.response.encodedDataLength ?? null,
        receivedAt: now(),
        cdpTimestamp: params.timestamp ?? null,
      };
    },
    onFinished(params) {
      const item = record(params.requestId);
      if (!item) return;
      item.finished = {
        encodedDataLength: params.encodedDataLength ?? null,
        finishedAt: now(),
        cdpTimestamp: params.timestamp ?? null,
      };
    },
    onData(params) {
      const item = record(params.requestId);
      if (!item) return;
      item.dataReceived.push({
        dataLength: params.dataLength ?? null,
        encodedDataLength: params.encodedDataLength ?? null,
        receivedAt: now(),
        cdpTimestamp: params.timestamp ?? null,
      });
    },
    onFailed(params) {
      const item = record(params.requestId);
      if (!item) return;
      item.failed = {
        errorText: params.errorText,
        canceled: params.canceled ?? false,
        blockedReason: params.blockedReason ?? null,
        corsErrorStatus: params.corsErrorStatus ?? null,
        failedAt: now(),
        cdpTimestamp: params.timestamp ?? null,
      };
    },
    snapshot() {
      return [...requests.values()].map((item) => ({ ...item, redirects: [...item.redirects], dataReceived: [...item.dataReceived] }));
    },
    pending() {
      return [...requests.values()].filter((item) => !item.finished && !item.failed).map((item) => item.requestId);
    },
  });
}

/** Strict diagnostic gate: a failed request or unfinished GLB always blocks. */
export function strictNetworkGateFailure(events, pendingGlbRequestIds) {
  const failures = [];
  if (events.runtimeExceptions.length) failures.push('runtime-exceptions');
  if (events.consoleErrors.length) failures.push('console-errors');
  if (events.httpErrors.length) failures.push('http-errors');
  if (events.failedRequests.length) failures.push('failed-requests');
  if (pendingGlbRequestIds.length) failures.push('pending-glb-requests');
  return failures;
}
