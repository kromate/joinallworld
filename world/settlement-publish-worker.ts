import { parentPort, workerData } from 'node:worker_threads';
import { compileSettlementProduct } from './settlement-compile.ts';
import type { CompiledSettlementProduct, SettlementBuildInput } from './settlement-product-types.ts';

interface WorkerInput { source: SettlementBuildInput['source']; raw: ArrayBuffer; parent: { manifestHash: string; source: SettlementBuildInput['parent']['source']; raw: ArrayBuffer; nodes: SettlementBuildInput['parent']['nodes'] } }
function buffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer;
  const copy = new ArrayBuffer(bytes.byteLength); new Uint8Array(copy).set(bytes); return copy;
}
try {
  if (!parentPort) throw new Error('Settlement compiler requires its supervised worker');
  const input = workerData as WorkerInput;
  const built = compileSettlementProduct({
    source: input.source, raw: new Uint8Array(input.raw),
    parent: { manifestHash: input.parent.manifestHash, source: input.parent.source, raw: new Uint8Array(input.parent.raw), nodes: input.parent.nodes },
  });
  const output = structuredClone(built) as CompiledSettlementProduct;
  const transfer: ArrayBuffer[] = [];
  for (const asset of output.assets) {
    const bytes = buffer(asset.body);
    (asset as { body: Uint8Array }).body = new Uint8Array(bytes);
    transfer.push(bytes);
  }
  parentPort.postMessage({ ok: true, output }, transfer);
} catch (error) {
  parentPort?.postMessage({ ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) });
  process.exitCode = 1;
} finally { parentPort?.close(); }
