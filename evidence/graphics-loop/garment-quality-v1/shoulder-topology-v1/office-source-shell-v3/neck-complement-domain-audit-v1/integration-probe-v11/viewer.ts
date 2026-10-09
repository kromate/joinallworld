import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { cloneSkinnedBodyScene, createSharedResourceCache } from '/src/scene/body/shared-resource-cache.ts';
import { BODY_FILES } from '/src/scene/body/files.ts';

type Asset = 'male' | 'female' | 'clips';
type BodyAsset = Exclude<Asset, 'clips'>;
type Case = Readonly<{ name: string; asset: Asset; ok: boolean; startedAt: number; finishedAt: number; bytes?: number; sha256?: string; factoryCalls?: number; clones?: number; retained?: boolean; error?: string }>;
type Trace = { at: number; label: string; event: string; url: string; status?: number; readyState?: number; responseType?: string; loaded?: number; total?: number; bodyUsed?: boolean; bytes?: number; error?: string };
const EXPECTED: Record<Asset, string> = {
  male: 'b0078206da9f7de0bf346be8133522cf514009f03f262f716613dd196d180686',
  female: '977ca5e73ba7b19af2627dab1ba0f0ef3e3d8548bf7b4d54f45faf22cd56001c',
  clips: '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47',
};
const URLS: Record<Asset, string> = { male: BODY_FILES.male, female: BODY_FILES.female, clips: BODY_FILES.clips };
const trace: Trace[] = [];
const retained: unknown[] = [];
const abortCalls: unknown[] = [];
const xhrAbortCalls: unknown[] = [];
const releaseAfterReport: Array<() => void> = [];
let activeLabel = 'initialization';
const isGlb = (value: string) => /\.glb(?:[?#]|$)/i.test(value);
const originalAbort = AbortController.prototype.abort;
AbortController.prototype.abort = function(reason?: unknown) {
  abortCalls.push({ at: performance.now(), label: activeLabel, reason: reason === undefined ? null : String(reason), stack: new Error('AbortController.abort observed').stack ?? '' });
  return originalAbort.call(this, reason);
};

const xhr = XMLHttpRequest.prototype as XMLHttpRequest & { __v11Open?: typeof XMLHttpRequest.prototype.open; __v11Send?: typeof XMLHttpRequest.prototype.send; __v11Abort?: typeof XMLHttpRequest.prototype.abort; __v11Url?: string; __v11Label?: string };
xhr.__v11Open ??= xhr.open;
xhr.__v11Send ??= xhr.send;
xhr.__v11Abort ??= xhr.abort;
xhr.open = function(method: string, url: string | URL, ...rest: unknown[]) {
  const target = String(url), label = activeLabel;
  if (isGlb(target)) {
    this.__v11Url = target; this.__v11Label = label;
    trace.push({ at: performance.now(), label, event: 'xhr-open', url: target });
    for (const event of ['readystatechange', 'progress', 'load', 'loadend', 'abort', 'error', 'timeout'] as const) {
      this.addEventListener(event, (value) => {
        const progress = value as ProgressEvent;
        trace.push({ at: performance.now(), label, event: `xhr-${event}`, url: target, status: this.status, readyState: this.readyState, responseType: this.responseType, loaded: Number.isFinite(progress.loaded) ? progress.loaded : undefined, total: Number.isFinite(progress.total) ? progress.total : undefined });
      });
    }
  }
  return xhr.__v11Open!.call(this, method, url, ...(rest as [boolean?, string?, string?]));
};
xhr.send = function(...args: Parameters<XMLHttpRequest['send']>) {
  const target = this.__v11Url ?? '';
  if (isGlb(target)) trace.push({ at: performance.now(), label: this.__v11Label ?? activeLabel, event: 'xhr-send', url: target, responseType: this.responseType });
  return xhr.__v11Send!.apply(this, args);
};
xhr.abort = function() {
  if (this.__v11Url && isGlb(this.__v11Url)) xhrAbortCalls.push({ at: performance.now(), label: this.__v11Label ?? activeLabel, url: this.__v11Url, readyState: this.readyState, status: this.status, stack: new Error('XMLHttpRequest.abort observed').stack ?? '' });
  return xhr.__v11Abort!.call(this);
};

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const label = activeLabel;
  if (isGlb(url)) trace.push({ at: performance.now(), label, event: 'fetch-start', url });
  const response = await originalFetch(input, init);
  if (isGlb(url)) {
    // Retain the exact Response returned to the consumer, including FileLoader's fetch response.
    // The same object is returned unchanged; this observer never clones or reads its stream.
    retained.push({ kind: 'actual-fetch-response', label, url, response });
    trace.push({ at: performance.now(), label, event: 'fetch-response-retained', url, status: response.status, bodyUsed: response.bodyUsed });
  }
  return response;
};
const originalArrayBuffer = Response.prototype.arrayBuffer;
Response.prototype.arrayBuffer = async function() {
  const response = this as Response, url = response.url;
  const track = isGlb(url), label = activeLabel, startedAt = performance.now();
  if (track) trace.push({ at: startedAt, label, event: 'response-arraybuffer-start', url, status: response.status, bodyUsed: response.bodyUsed });
  try {
    const bytes = await originalArrayBuffer.call(response);
    if (track) trace.push({ at: performance.now(), label, event: 'response-arraybuffer-complete', url, status: response.status, bodyUsed: response.bodyUsed, bytes: bytes.byteLength });
    return bytes;
  } catch (error) {
    if (track) trace.push({ at: performance.now(), label, event: 'response-arraybuffer-error', url, status: response.status, bodyUsed: response.bodyUsed, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
};

const sha256 = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
function loader() { return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); }
function disposeGltf(gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  for (const scene of gltf.scenes) scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry?.isBufferGeometry) geometries.add(mesh.geometry);
    for (const material of (Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [])) {
      materials.add(material);
      for (const value of Object.values(material)) if ((value as THREE.Texture | null)?.isTexture) textures.add(value as THREE.Texture);
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}
function disposeClone(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), skeletons = new Set<THREE.Skeleton>();
  scene.traverse(object => { const mesh = object as THREE.SkinnedMesh; if (mesh.geometry?.isBufferGeometry) geometries.add(mesh.geometry); if (mesh.isSkinnedMesh) skeletons.add(mesh.skeleton); });
  for (const skeleton of skeletons) skeleton.dispose();
  for (const geometry of geometries) geometry.dispose();
}
function createTemplateCache<T>(release: (value: T) => void) {
  return createSharedResourceCache<T>(() => () => true, release);
}
async function fetchTemplate(asset: Asset) {
  activeLabel = `fetch-cache:${asset}`;
  const response = await window.fetch(URLS[asset], { cache: 'no-store' });
  if (!response.ok) throw new Error(`fetch-cache ${asset} returned HTTP ${response.status}`);
  const bytes = await response.arrayBuffer(), hash = await sha256(bytes);
  if (hash !== EXPECTED[asset]) throw new Error(`${asset} byte hash mismatch: ${hash}`);
  trace.push({ at: performance.now(), label: activeLabel, event: 'fetch-arraybuffer-complete', url: URLS[asset], status: response.status, bodyUsed: response.bodyUsed, bytes: bytes.byteLength });
  retained.push({ asset, response, bytes });
  await MeshoptDecoder.ready;
  const gltf = await loader().parseAsync(bytes.slice(0), '');
  return { gltf, bytes: bytes.byteLength, hash, response };
}
type Template = Awaited<ReturnType<typeof fetchTemplate>> & { asset: Asset };
async function runFetchCache(asset: Asset): Promise<Case> {
  const startedAt = performance.now();
  let factoryCalls = 0;
  const cache = createTemplateCache<Template>((template) => disposeGltf(template.gltf));
  try {
    const make = async () => { factoryCalls++; return { ...await fetchTemplate(asset), asset }; };
    activeLabel = `fetch-cache:${asset}:first`;
    const [first, concurrent] = await Promise.all([cache.load(asset, make), cache.load(asset, make)]);
    if (first !== concurrent) throw new Error('shared cache did not deduplicate concurrent fetch/parse loads');
    const clones: THREE.Object3D[] = [];
    if (asset !== 'clips') for (let i = 0; i < 2; i++) { const clone = cloneSkinnedBodyScene(first.gltf.scene); clones.push(clone.scene); }
    for (const clone of clones) disposeClone(clone);
    retained.push(first);
    cache.assertOpen(); releaseAfterReport.push(() => { trace.push({ at: performance.now(), label: `fetch-cache:${asset}`, event: 'shared-cache-dispose', url: URLS[asset] }); cache.dispose(); });
    return { name: 'fetch-parse-shared-cache-retained-response', asset, ok: true, startedAt, finishedAt: performance.now(), bytes: first.bytes, sha256: first.hash, factoryCalls, clones: clones.length, retained: true };
  } catch (error) {
    releaseAfterReport.push(() => { trace.push({ at: performance.now(), label: `fetch-cache:${asset}`, event: 'shared-cache-dispose-after-error', url: URLS[asset] }); cache.dispose(); });
    return { name: 'fetch-parse-shared-cache-retained-response', asset, ok: false, startedAt, finishedAt: performance.now(), factoryCalls, error: error instanceof Error ? error.message : String(error) };
  }
}
async function runFileLoaderCache(asset: Asset): Promise<Case> {
  const startedAt = performance.now();
  let factoryCalls = 0;
  const cache = createTemplateCache<Awaited<ReturnType<GLTFLoader['loadAsync']>>>((gltf) => disposeGltf(gltf));
  try {
    // This reference fetch pins expected bytes; the following loadAsync call is the FileLoader request under test.
    activeLabel = `fileloader-cache-reference:${asset}`;
    const refResponse = await window.fetch(URLS[asset], { cache: 'no-store' });
    if (!refResponse.ok) throw new Error(`${asset} reference returned HTTP ${refResponse.status}`);
    const refBytes = await refResponse.arrayBuffer(), hash = await sha256(refBytes);
    if (hash !== EXPECTED[asset]) throw new Error(`${asset} reference hash mismatch: ${hash}`);
    trace.push({ at: performance.now(), label: activeLabel, event: 'reference-arraybuffer-complete', url: URLS[asset], status: refResponse.status, bodyUsed: refResponse.bodyUsed, bytes: refBytes.byteLength });
    retained.push({ asset, response: refResponse, bytes: refBytes });
    await MeshoptDecoder.ready;
    const make = () => { factoryCalls++; activeLabel = `fileloader-cache:${asset}`; return loader().loadAsync(URLS[asset]); };
    const [first, concurrent] = await Promise.all([cache.load(asset, make), cache.load(asset, make)]);
    if (first !== concurrent) throw new Error('shared cache did not deduplicate concurrent FileLoader loads');
    const clones: THREE.Object3D[] = [];
    if (asset !== 'clips') for (let i = 0; i < 2; i++) { const clone = cloneSkinnedBodyScene(first.scene); clones.push(clone.scene); }
    for (const clone of clones) disposeClone(clone);
    retained.push(first);
    cache.assertOpen(); releaseAfterReport.push(() => { trace.push({ at: performance.now(), label: `fileloader-cache:${asset}`, event: 'shared-cache-dispose', url: URLS[asset] }); cache.dispose(); });
    return { name: 'fileloader-shared-cache-retained-template', asset, ok: true, startedAt, finishedAt: performance.now(), bytes: refBytes.byteLength, sha256: hash, factoryCalls, clones: clones.length, retained: true };
  } catch (error) {
    releaseAfterReport.push(() => { trace.push({ at: performance.now(), label: `fileloader-cache:${asset}`, event: 'shared-cache-dispose-after-error', url: URLS[asset] }); cache.dispose(); });
    return { name: 'fileloader-shared-cache-retained-template', asset, ok: false, startedAt, finishedAt: performance.now(), factoryCalls, error: error instanceof Error ? error.message : String(error) };
  }
}

async function run() {
  const status = document.getElementById('status')!, output = document.getElementById('result')!;
  status.textContent = 'Comparing direct fetch/parse retention with production shared-cache/FileLoader behavior…';
  const cases: Case[] = [];
  for (const asset of ['male', 'female', 'clips'] as const) cases.push(await runFetchCache(asset));
  for (const asset of ['male', 'female', 'clips'] as const) cases.push(await runFileLoaderCache(asset));
  activeLabel = 'completed';
  const report = {
    status: 'measured', cases, trace: [...trace], abortControllerCalls: [...abortCalls], xhrAbortCalls: [...xhrAbortCalls], expectedSha256: EXPECTED, assetUrls: URLS,
    userAgent: navigator.userAgent,
    retainedReferenceCounts: { strongRetentionRecords: retained.length, actualGlbResponseRecords: retained.filter(value => (value as { kind?: string }).kind === 'actual-fetch-response').length, note: 'The fetch wrapper strongly retains the exact Response returned to each GLB consumer, including FileLoader, plus explicit ArrayBuffer/parsed-template/cache records until after report serialization. This does not prove or disprove garbage-collection cancellation.' },
    strictGate: 'Any failed, canceled, or pending GLB request remains a failure; no waiver or filtering is applied.',
    limitations: [
      'The fetch path uses the exact production shared-resource cache implementation and production SkinnedUtils scene-clone helper; the FileLoader path uses the same cache and clone helper.',
      'This reproduces cache, clone, retention, and disposal ownership at the asset layer, not the full loadBody appearance/renderer lifecycle.',
      'Fetch response retention and XHR/fetch lifecycle traces are passive instrumentation; no request is canceled, cloned, or retried by the diagnostic. The CDP evidence in the prior run showed the current FileLoader path uses fetch, so XHR tracing is supplemental.',
      'Strong references are held deliberately to test whether cancellation persists without response/template collection. WeakRef/FinalizationRegistry timing is nondeterministic and is not used as proof.',
      'No avatar pixels, mobile performance, or gameplay acceptance are measured.',
    ],
  };
  (window as typeof window & { __GLB_ABORT_DIAGNOSTIC__?: unknown }).__GLB_ABORT_DIAGNOSTIC__ = report;
  output.textContent = JSON.stringify(report, null, 2);
  for (const release of releaseAfterReport.splice(0)) release();
  status.textContent = 'Cases complete; controller enforces strict network failure gate.';
  return report;
}
(window as typeof window & { __GLB_ABORT_DIAGNOSTIC__?: unknown }).__GLB_ABORT_DIAGNOSTIC__ = Object.freeze({ run });
