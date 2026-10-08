import { parentPort, workerData } from 'node:worker_threads';
import { compileCountryGrid } from './country-grid.ts';
import type { CountryGridBoundary, CountryGridRequest } from './country-grid-types.ts';

if (!parentPort) throw new Error('country-grid worker requires a parent port');

try {
  const data = workerData as { request: CountryGridRequest; boundary: CountryGridBoundary };
  const product = compileCountryGrid(data.request, data.boundary);
  const transfer = product.bytes.byteOffset === 0 && product.bytes.byteLength === product.bytes.buffer.byteLength ? [product.bytes.buffer as ArrayBuffer] : [];
  parentPort.postMessage({ ok: true, product }, transfer);
} catch (error) {
  parentPort.postMessage({ ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) });
}
