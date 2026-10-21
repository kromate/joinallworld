// OWNER: scenes (unique places)
// Fetching one place model and checking it before anything decodes it. The same discipline as checkedGlb in src/scene/recipe/prepare.ts: the
// bytes must be exactly as long as the manifest says, hash to the address they came from, and be a plain static glTF 2.0 binary with one
// material named "trim", the attributes the atlas needs and no picture of its own. Anything else is refused, and the venue keeps what it had.
import { PLACE_MODEL_LIMITS } from './limits.ts';
import { placeModelPath } from './paths.ts';
import type { PlaceLod, PlaceLodKey } from './manifest.ts';
import { rememberPlaces } from './persist.ts';

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}
function refuse(message: string): never { throw new Error(`Place model: ${message}`); }

interface GlbDocument {
  asset?: { version?: string }; scene?: number; scenes?: unknown[]; animations?: unknown[]; skins?: unknown[]; cameras?: unknown[]
  extensions?: Record<string, unknown>; extensionsUsed?: string[]; extensionsRequired?: string[]
  buffers?: { uri?: string; byteLength: number; extensions?: { EXT_meshopt_compression?: { fallback?: boolean } } }[]
  bufferViews?: { buffer?: number; byteOffset?: number; byteLength: number; extensions?: { EXT_meshopt_compression?: { count: number; byteStride: number; buffer: number; byteOffset?: number; byteLength: number } } }[]
  images?: unknown[]; textures?: unknown[]; samplers?: unknown[]
  materials?: { name?: string; alphaMode?: string; doubleSided?: boolean; normalTexture?: unknown; emissiveTexture?: unknown; occlusionTexture?: unknown; pbrMetallicRoughness?: { baseColorTexture?: unknown; metallicRoughnessTexture?: unknown } }[]
  meshes?: { primitives: { mode?: number; material?: number; targets?: unknown; attributes?: Record<string, number> }[] }[]
  nodes?: { camera?: unknown; skin?: unknown; extensions?: Record<string, unknown> }[]
}
const SUPPORTED = new Set(['EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_materials_specular', 'KHR_texture_transform']);

/** Structure checks on already hash-verified bytes. Throws on anything outside the place-model contract. */
export function checkPlaceGlbStructure(bytes: Uint8Array<ArrayBuffer>, lod: PlaceLodKey): GlbDocument {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!(bytes.length >= 28 && view.getUint32(0, true) === 0x46546c67 && view.getUint32(4, true) === 2 && view.getUint32(8, true) === bytes.length && view.getUint32(16, true) === 0x4e4f534a)) refuse('invalid GLB header');
  const length = view.getUint32(12, true), binHeader = 20 + length;
  if (!(length % 4 === 0 && binHeader + 8 <= bytes.length && view.getUint32(binHeader + 4, true) === 0x004e4942 && binHeader + 8 + view.getUint32(binHeader, true) === bytes.length)) refuse('invalid GLB chunks');
  const doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(20, binHeader))) as GlbDocument;
  if (!(doc.asset?.version === '2.0' && doc.scenes?.length === 1 && (doc.scene ?? 0) === 0 && !doc.animations?.length && !doc.skins?.length && !doc.cameras?.length && !doc.extensions?.KHR_lights_punctual)) refuse('requires one static scene');
  if (!doc.nodes?.every(n => n.skin === undefined && n.camera === undefined && !n.extensions?.KHR_lights_punctual)) refuse('unsupported node');
  if (![...(doc.extensionsUsed ?? []), ...(doc.extensionsRequired ?? [])].every(x => SUPPORTED.has(x))) refuse('unsupported extension');
  if (!doc.extensionsUsed?.includes('EXT_meshopt_compression')) refuse('meshopt compression required');
  if (!(doc.buffers && doc.buffers.length >= 1 && doc.buffers.length <= 2 && doc.buffers.every((b, i) => !b.uri && Number.isSafeInteger(b.byteLength) && b.byteLength > 0 && b.byteLength <= 16 * 1024 * 1024 && (i === 0 || b.extensions?.EXT_meshopt_compression?.fallback === true)))) refuse('requires one embedded buffer');
  let decoded = 0;
  for (const v of doc.bufferViews ?? []) {
    const buffer = doc.buffers[v.buffer ?? 0];
    if (!(buffer && Number.isSafeInteger(v.byteLength) && v.byteLength > 0 && (v.byteOffset ?? 0) >= 0 && (v.byteOffset ?? 0) + v.byteLength <= buffer.byteLength)) refuse('invalid buffer view');
    const compressed = v.extensions?.EXT_meshopt_compression;
    if (compressed) {
      if (!(Number.isSafeInteger(compressed.count) && compressed.count > 0 && Number.isSafeInteger(compressed.byteStride) && compressed.byteStride > 0 && compressed.buffer === 0 && (compressed.byteOffset ?? 0) + compressed.byteLength <= doc.buffers[0]!.byteLength)) refuse('invalid compressed range');
      decoded += compressed.count * compressed.byteStride;
    } else decoded += v.byteLength;
  }
  if (decoded > 16 * 1024 * 1024) refuse('decoded allocation exceeds the limit');
  if (doc.images?.length || doc.textures?.length || doc.samplers?.length) refuse('a place model carries no picture: the shared atlas is bound by the game');
  if (!(doc.meshes?.length && doc.meshes.length <= 8 && doc.meshes.every(m => m.primitives.length === 1 && m.primitives.every(p => (p.mode ?? 4) === 4 && p.material === 0 && !p.targets
    // The map icon (lod2) is drawn from vertex colour alone; the two venue levels sample the atlas too.
    && (lod === 'lod2' ? ['POSITION', 'NORMAL', 'COLOR_0'] : ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0']).every(a => p.attributes?.[a] !== undefined))))) refuse('invalid primitives');
  const material = doc.materials?.[0];
  if (!(doc.materials?.length === 1 && material?.name === 'trim' && (material.alphaMode ?? 'OPAQUE') === 'OPAQUE' && !material.normalTexture && !material.emissiveTexture && !material.occlusionTexture
    && !material.pbrMetallicRoughness?.baseColorTexture && !material.pbrMetallicRoughness?.metallicRoughnessTexture)) refuse('requires the one material "trim" without textures');
  return doc;
}

export interface FetchPlaceOptions { fetcher?: typeof globalThis.fetch; signal?: AbortSignal }

/** Reads a response body, refusing more than `limit` bytes. */
async function readLimited(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok || !response.body) refuse(`HTTP ${response.status}`);
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > limit)) refuse('content length exceeds the manifest');
  const reader = response.body!.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) refuse('model exceeds its declared bytes');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}

/** One level of detail of one model: fetched from its content-addressed address and verified against the manifest. */
export async function fetchPlaceGlb(entry: PlaceLod, lod: PlaceLodKey, options: FetchPlaceOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const response = await fetcher(placeModelPath(entry.sha256), { method: 'GET', credentials: 'same-origin', redirect: 'error', ...(options.signal ? { signal: options.signal } : {}) });
  const bytes = await readLimited(response, Math.min(entry.bytes, PLACE_MODEL_LIMITS[lod].bytes));
  if (bytes.length !== entry.bytes) refuse('byte length differs from the manifest');
  if (await sha256Hex(bytes) !== entry.sha256) refuse('hash differs from its address');
  checkPlaceGlbStructure(bytes, lod);
  // The first verified model: keep the service worker's place cache and ask the browser not to evict it (persist.ts).
  rememberPlaces();
  return bytes;
}
