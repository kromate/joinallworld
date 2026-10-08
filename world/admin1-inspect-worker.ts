import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { inspectAdmin1Document } from './admin1-partition.ts';
import type { Admin1BuildInput, Admin1InspectionReport } from './admin1-types.ts';
import type { SourceRecord } from './types.ts';

interface WorkerInput { source: SourceRecord; raw: ArrayBuffer; parent: { manifestHash: string; source: SourceRecord; raw: ArrayBuffer; nodes: Admin1BuildInput['parent']['nodes'] } }
function sourceBytes(buffer: ArrayBuffer, source: SourceRecord): Uint8Array {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength !== source.bytes || createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error('Admin1 inspection bytes differ from their source pin');
  return bytes;
}
try {
  if (!parentPort) throw new Error('Admin1 inspection requires its supervised worker');
  const input = workerData as WorkerInput;
  const raw = sourceBytes(input.raw, input.source);
  const parentRaw = sourceBytes(input.parent.raw, input.parent.source);
  const report: Admin1InspectionReport = inspectAdmin1Document({
    source: input.source,
    raw,
    parent: { manifestHash: input.parent.manifestHash, source: input.parent.source, raw: parentRaw, nodes: input.parent.nodes },
  });
  parentPort.postMessage({ ok: true, report });
} catch (error) {
  parentPort?.postMessage({ ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 2_000) });
  process.exitCode = 1;
} finally {
  parentPort?.close();
}
