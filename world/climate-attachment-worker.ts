import { parentPort, workerData } from 'node:worker_threads';
import { compileClimateAttachment } from './climate-attachment-compile.ts';
import type { ClimateAttachmentBuildInput, CompiledClimateAttachment } from './climate-attachment-types.ts';

interface Input {
  binding: ClimateAttachmentBuildInput['binding'];
  base: ArrayBuffer; environment: ArrayBuffer; rawSource: ArrayBuffer;
  tiles: Array<{ relative: string; body: ArrayBuffer }>;
}
function transferBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer;
  const copy = new ArrayBuffer(bytes.byteLength); new Uint8Array(copy).set(bytes); return copy;
}
try {
  if (!parentPort) throw new Error('Climate attachment compiler requires a supervised worker');
  const input = workerData as Input;
  const compiled = compileClimateAttachment({
    binding: input.binding,
    baseBytes: new Uint8Array(input.base), environmentBytes: new Uint8Array(input.environment),
    rawSourceBytes: new Uint8Array(input.rawSource),
    tiles: input.tiles.map((tile) => ({ relative: tile.relative, body: new Uint8Array(tile.body) })),
  });
  const output = structuredClone(compiled) as CompiledClimateAttachment;
  const transfer: ArrayBuffer[] = [];
  for (const asset of output.assets) {
    const body = transferBuffer(asset.body);
    (asset as { body: Uint8Array }).body = new Uint8Array(body);
    transfer.push(body);
  }
  parentPort.postMessage({ ok: true, output }, transfer);
} catch (error) {
  parentPort?.postMessage({ ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) });
  process.exitCode = 1;
} finally { parentPort?.close(); }
