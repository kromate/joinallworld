import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { BODY_FILES } from '/src/scene/body/files.ts';

type AssetName = 'male' | 'female' | 'clips';
type Mode = 'fetch-parse' | 'fileloader' | 'fileloader-parallel';
type Result = { mode: Mode; asset: AssetName; url: string; ok: boolean; startedAt: number; finishedAt: number; bytes?: number; sha256?: string; status?: number; sceneCount?: number; meshCount?: number; animations?: number; error?: string };
const EXPECTED: Record<AssetName, string> = {
  male: 'b0078206da9f7de0bf346be8133522cf514009f03f262f716613dd196d180686',
  female: '977ca5e73ba7b19af2627dab1ba0f0ef3e3d8548bf7b4d54f45faf22cd56001c',
  clips: '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47',
};
const URLS: Record<AssetName, string> = { male: BODY_FILES.male, female: BODY_FILES.female, clips: BODY_FILES.clips };
const abortCalls: Array<{ at: number; label: string; reason: string | null; stack: string }> = [];
const xhrAbortCalls: Array<{ at: number; label: string; url: string; readyState: number; status: number; stack: string }> = [];
let activeLabel = 'initialization';
const originalAbort = AbortController.prototype.abort;
AbortController.prototype.abort = function(reason?: unknown) {
  abortCalls.push({ at: performance.now(), label: activeLabel, reason: reason === undefined ? null : String(reason), stack: new Error('AbortController.abort observed').stack ?? '' });
  return originalAbort.call(this, reason);
};
const xhrPrototype = XMLHttpRequest.prototype as XMLHttpRequest & { __diagnosticOpen?: (...args: any[]) => void; __diagnosticAbort?: () => void };
const originalXhrOpen = xhrPrototype.open, originalXhrAbort = xhrPrototype.abort;
xhrPrototype.open = function(...args: any[]) {
  const diagnostic = this as XMLHttpRequest & { __diagnosticUrl?: string; __diagnosticLabel?: string };
  diagnostic.__diagnosticUrl = String(args[1] ?? ''); diagnostic.__diagnosticLabel = activeLabel;
  return originalXhrOpen.apply(this, args as any);
};
xhrPrototype.abort = function() {
  const diagnostic = this as XMLHttpRequest & { __diagnosticUrl?: string; __diagnosticLabel?: string };
  xhrAbortCalls.push({ at: performance.now(), label: diagnostic.__diagnosticLabel ?? activeLabel, url: diagnostic.__diagnosticUrl ?? this.responseURL, readyState: this.readyState, status: this.status, stack: new Error('XMLHttpRequest.abort observed').stack ?? '' });
  return originalXhrAbort.call(this);
};
const sha256 = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
function loader() { return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); }
function dispose(gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>) {
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
function counts(gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>) {
  let meshCount = 0;
  for (const scene of gltf.scenes) scene.traverse(object => { if ((object as THREE.Mesh).isMesh) meshCount++; });
  return { sceneCount: gltf.scenes.length, meshCount, animations: gltf.animations.length };
}
async function bytesFor(asset: AssetName, label: string) {
  activeLabel = `${label}:${asset}`;
  const response = await fetch(URLS[asset], { cache: 'no-store' });
  if (!response.ok) throw new Error(`${label} ${asset} fetch returned HTTP ${response.status}`);
  const bytes = await response.arrayBuffer(), hash = await sha256(bytes);
  if (hash !== EXPECTED[asset]) throw new Error(`${asset} asset hash mismatch: ${hash}`);
  return { bytes, status: response.status, hash };
}
async function runFetchParse(asset: AssetName): Promise<Result> {
  const startedAt = performance.now();
  try {
    const data = await bytesFor(asset, 'fetch-parse');
    await MeshoptDecoder.ready;
    const gltf = await loader().parseAsync(data.bytes.slice(0), '');
    const summary = counts(gltf); dispose(gltf);
    return { mode: 'fetch-parse', asset, url: URLS[asset], ok: true, startedAt, finishedAt: performance.now(), bytes: data.bytes.byteLength, sha256: data.hash, status: data.status, ...summary };
  } catch (error) {
    return { mode: 'fetch-parse', asset, url: URLS[asset], ok: false, startedAt, finishedAt: performance.now(), error: error instanceof Error ? error.message : String(error) };
  }
}
async function runFileLoader(asset: AssetName, mode: 'fileloader' | 'fileloader-parallel'): Promise<Result> {
  const startedAt = performance.now();
  try {
    // Hash the exact server asset before invoking FileLoader; this reference request is separately
    // visible in CDP and avoids a post-load request obscuring the FileLoader terminal event.
    const data = await bytesFor(asset, `${mode}-asset-reference`);
    activeLabel = `${mode}:${asset}`;
    await MeshoptDecoder.ready;
    const gltf = await loader().loadAsync(URLS[asset]);
    const summary = counts(gltf); dispose(gltf);
    return { mode, asset, url: URLS[asset], ok: true, startedAt, finishedAt: performance.now(), bytes: data.bytes.byteLength, sha256: data.hash, status: data.status, ...summary };
  } catch (error) {
    return { mode, asset, url: URLS[asset], ok: false, startedAt, finishedAt: performance.now(), error: error instanceof Error ? error.message : String(error) };
  }
}
async function run() {
  const status = document.getElementById('status')!, output = document.getElementById('result')!;
  status.textContent = 'Running exact-asset fetch/parse and Three FileLoader cases…';
  const cases: Result[] = [];
  for (const asset of ['male', 'female', 'clips'] as const) cases.push(await runFetchParse(asset));
  for (const asset of ['male', 'female', 'clips'] as const) cases.push(await runFileLoader(asset, 'fileloader'));
  const parallel = await Promise.all([runFileLoader('male', 'fileloader-parallel'), runFileLoader('male', 'fileloader-parallel')]);
  cases.push(...parallel);
  activeLabel = 'completed';
  const report = { status: 'measured', cases, abortControllerCalls: [...abortCalls], xhrAbortCalls: [...xhrAbortCalls], expectedSha256: EXPECTED, assetUrls: URLS, userAgent: navigator.userAgent,
    limitations: ['This compares direct fetch/parse and Three GLTFLoader/FileLoader for the exact shipped GLBs. It does not reproduce production template-cache ownership or avatar disposal.', 'Duplicate loads are intentionally concurrent; they test whether this standalone loader path cancels either request.', 'Any failed or canceled GLB is diagnostic failure. This probe never waives network errors.', 'No renderer pixels, production avatar lifecycle, or phone performance are measured.'] };
  (window as typeof window & { __GLB_ABORT_DIAGNOSTIC__?: unknown }).__GLB_ABORT_DIAGNOSTIC__ = report;
  output.textContent = JSON.stringify(report, null, 2);
  status.textContent = 'Cases complete; the remote controller applies strict request lifecycle checks.';
  return report;
}
(window as typeof window & { __GLB_ABORT_DIAGNOSTIC__?: unknown }).__GLB_ABORT_DIAGNOSTIC__ = Object.freeze({ run });
