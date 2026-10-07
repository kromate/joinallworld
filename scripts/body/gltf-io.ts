// Small, dependency-free glTF 2.0 reading and writing for the body pipeline (scripts/body/build-body.ts).
// Reads .gltf (+ external .bin) and .glb; writes a .gltf with one external .bin. Only what the pipeline needs:
// no sparse accessors, no embedded data URIs, no extensions.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Accessor { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean; min?: number[]; max?: number[] }
export interface BufferView { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; target?: number }
export interface Node { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; mesh?: number; skin?: number }
export interface Primitive { attributes: Record<string, number>; indices?: number; material?: number }
export interface Channel { sampler: number; target: { node: number; path: string } }
export interface Sampler { input: number; output: number; interpolation?: string }
export interface Gltf {
  asset: { version: string; generator?: string };
  scene?: number; scenes?: { name?: string; nodes: number[] }[];
  nodes: Node[]; meshes?: { name?: string; primitives: Primitive[] }[];
  skins?: { name?: string; joints: number[]; inverseBindMatrices?: number; skeleton?: number }[];
  animations?: { name: string; channels: Channel[]; samplers: Sampler[] }[];
  accessors: Accessor[]; bufferViews: BufferView[]; buffers: { byteLength: number; uri?: string }[];
  materials?: unknown[]; textures?: unknown[]; images?: unknown[]; samplers?: unknown[];
}
export interface Loaded { json: Gltf; buffers: Buffer[] }

const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
export const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Load a .gltf (with its .bin files beside it) or a .glb. */
export function loadGltf(path: string): Loaded {
  const file = readFileSync(path);
  if (file.readUInt32LE(0) === 0x46546c67) {
    const jsonLength = file.readUInt32LE(12);
    const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString('utf8')) as Gltf;
    const binStart = 20 + jsonLength;
    const bin = binStart < file.length ? file.subarray(binStart + 8, binStart + 8 + file.readUInt32LE(binStart)) : Buffer.alloc(0);
    return { json, buffers: [bin] };
  }
  const json = JSON.parse(file.toString('utf8')) as Gltf;
  return { json, buffers: json.buffers.map((buffer) => readFileSync(join(dirname(path), decodeURIComponent(buffer.uri ?? '')))) };
}

/** Every element of an accessor as plain numbers (count × components), normalised integers turned into 0..1. */
export function readAccessor(doc: Loaded, index: number): Float64Array {
  const accessor = doc.json.accessors[index]!;
  const size = TYPE_SIZE[accessor.type]!, bytes = COMPONENT_BYTES[accessor.componentType]!;
  const out = new Float64Array(accessor.count * size);
  if (accessor.bufferView === undefined) return out;
  const view = doc.json.bufferViews[accessor.bufferView]!;
  const buffer = doc.buffers[view.buffer]!;
  const data = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const stride = view.byteStride || size * bytes, start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const scale = accessor.normalized ? ({ 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 } as Record<number, number>)[accessor.componentType] ?? 1 : 1;
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < size; c++) {
      const at = start + i * stride + c * bytes;
      let value: number;
      switch (accessor.componentType) {
        case 5120: value = data.getInt8(at); break;
        case 5121: value = data.getUint8(at); break;
        case 5122: value = data.getInt16(at, true); break;
        case 5123: value = data.getUint16(at, true); break;
        case 5125: value = data.getUint32(at, true); break;
        default: value = data.getFloat32(at, true);
      }
      out[i * size + c] = scale === 1 ? value : Math.max(value / scale, -1);
    }
  }
  return out;
}

type Typed = Float32Array | Uint8Array | Uint16Array | Uint32Array;
const COMPONENT_OF = (data: Typed): number => data instanceof Float32Array ? 5126 : data instanceof Uint8Array ? 5121 : data instanceof Uint16Array ? 5123 : 5125;

/** Builds one glTF with a single external buffer. */
export class GltfWriter {
  json: Gltf;
  private parts: Buffer[] = [];
  private length = 0;
  constructor() {
    this.json = { asset: { version: '2.0', generator: 'allworld scripts/body' }, nodes: [], accessors: [], bufferViews: [], buffers: [] };
  }
  /** A raw byte range (an image, say) as a buffer view. */
  view(bytes: Buffer, target?: number): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.parts.push(Buffer.alloc(pad)); this.length += pad; }
    const view: BufferView = { buffer: 0, byteOffset: this.length, byteLength: bytes.length };
    if (target) view.target = target;
    this.json.bufferViews.push(view);
    this.parts.push(bytes); this.length += bytes.length;
    return this.json.bufferViews.length - 1;
  }
  /** An accessor over its own buffer view. */
  accessor(data: Typed, type: string, { normalized = false, target, bounds = false }: { normalized?: boolean; target?: number; bounds?: boolean } = {}): number {
    const size = TYPE_SIZE[type]!;
    const accessor: Accessor = { bufferView: this.view(Buffer.from(data.buffer, data.byteOffset, data.byteLength), target), componentType: COMPONENT_OF(data), count: data.length / size, type };
    if (normalized) accessor.normalized = true;
    if (bounds) {
      const min = new Array<number>(size).fill(Infinity), max = new Array<number>(size).fill(-Infinity);
      for (let i = 0; i < data.length; i++) { const c = i % size; min[c] = Math.min(min[c]!, data[i]!); max[c] = Math.max(max[c]!, data[i]!); }
      accessor.min = min; accessor.max = max;
    }
    this.json.accessors.push(accessor);
    return this.json.accessors.length - 1;
  }
  /** Write name.gltf and name.bin into dir; returns the .gltf path. */
  save(dir: string, name: string): string {
    const bin = Buffer.concat(this.parts);
    this.json.buffers = [{ byteLength: bin.length, uri: `${name}.bin` }];
    writeFileSync(join(dir, `${name}.bin`), bin);
    const path = join(dir, `${name}.gltf`);
    writeFileSync(path, JSON.stringify(this.json));
    return path;
  }
}

/** The JSON chunk of a .glb (for counting what was shipped without decoding meshopt data). */
export function glbJson(file: Buffer): Gltf {
  if (file.readUInt32LE(0) !== 0x46546c67) throw new Error('not a .glb');
  return JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString('utf8')) as Gltf;
}
