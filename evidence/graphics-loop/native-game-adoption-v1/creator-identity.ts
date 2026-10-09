import * as THREE from 'three';
import { createAvatarPreview, type AvatarPreview } from '../../../src/scene/avatar-preview.ts';
import { normalizeLook } from '../../../src/scene/characters.ts';
import { createKit, type Kit } from '../../../src/scene/kit.ts';
import { bodyTint } from '../../../src/scene/body/tint.ts';
import { loadGameBody, PLAYER_BODY_POSES } from '../../../src/scene/body/provider.ts';
import type { SkinnedBody } from '../../../src/scene/body/skinned.ts';
import { GAME_PLAYER_LOOK, GAME_PLAYER_SEED } from './creator-identity.game-input.ts';

interface IdentityCall {
  seed: string;
  lookFingerprint: string;
  tintFingerprint: string;
  accepted: boolean;
}
interface BodyEvidence {
  key: string;
  seedCall: IdentityCall | null;
  meshNames: string[];
  skeletonNames: string[];
  geometrySignature: string;
  preparedNative: boolean;
  preparedMetrics: unknown;
}
interface IdentityReport {
  ready: boolean;
  errors: string[];
  identity: { expectedSeed: string; expectedLookFingerprint: string; expectedTintFingerprint: string; previewInputCarriesSameSeed: boolean };
  creator: BodyEvidence | null;
  venue: BodyEvidence | null;
  comparisons: Record<string, boolean>;
  preview: { renderCount: number; frames: number; animating: boolean; triangles: number; focus: string; yaw: number } | null;
  captures: Array<{ name: string; width: number; height: number; alphaPixels: number; visiblePixels: number; preserveDrawingBuffer: boolean }>;
  disposal: { preview: boolean; creatorKit: boolean; venueBody: boolean; venueKit: boolean };
  limitations: string[];
}

declare global { interface Window { nativeCreatorIdentity: ReturnType<typeof createFixture> } }

const CREATOR_POSES = PLAYER_BODY_POSES;
const VENUE_POSES = PLAYER_BODY_POSES;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing identity fixture element ${selector}`);
  return element;
}

function fingerprintBody(body: SkinnedBody, wearCall: IdentityCall | null): BodyEvidence {
  const meshNames: string[] = [];
  const skeletonNames = new Set<string>();
  const geometry: string[] = [];
  body.object.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!(mesh as THREE.SkinnedMesh).isMesh) return;
    meshNames.push(mesh.name || '(unnamed)');
    if (mesh.isSkinnedMesh && mesh.skeleton) {
      mesh.skeleton.bones.forEach((bone) => skeletonNames.add(bone.name));
      geometry.push(`${mesh.name}:${mesh.geometry.attributes.position?.count ?? 0}:${mesh.geometry.index?.count ?? 0}`);
    }
  });
  return {
    key: body.key,
    seedCall: wearCall,
    meshNames: meshNames.sort(),
    skeletonNames: [...skeletonNames].sort(),
    geometrySignature: geometry.sort().join('|'),
    preparedNative: 'preparedMetrics' in body,
    preparedMetrics: 'preparedMetrics' in body ? body.preparedMetrics : null,
  };
}

function observeWear(body: SkinnedBody, onWear: (call: IdentityCall) => void): void {
  const wear = body.wear.bind(body);
  body.wear = (look: unknown, seed?: unknown) => {
    const accepted = wear(look, seed);
    const value = normalizeLook(look, seed);
    const tint = bodyTint(look, seed);
    onWear({ seed: String(seed ?? ''), lookFingerprint: JSON.stringify(value),
      tintFingerprint: JSON.stringify(tint), accepted });
    return accepted;
  };
}

function createFixture() {
  const host = required<HTMLElement>('#preview-host');
  const status = required<HTMLElement>('#status');
  const audit = required<HTMLElement>('#audit');
  const creatorKit: Kit = createKit();
  const venueKit: Kit = createKit();
  const errors: string[] = [];
  const captures: IdentityReport['captures'] = [];
  const capturePngs = new Map<string, string>();
  const expectedLook = normalizeLook(GAME_PLAYER_LOOK, GAME_PLAYER_SEED);
  const expectedFingerprint = JSON.stringify(expectedLook);
  const expectedTintFingerprint = JSON.stringify(bodyTint(GAME_PLAYER_LOOK, GAME_PLAYER_SEED));
  const previewLook = Object.freeze({ ...GAME_PLAYER_LOOK, seed: GAME_PLAYER_SEED });
  let preview: AvatarPreview | null = null;
  let creatorBody: SkinnedBody | null = null;
  let venueBody: SkinnedBody | null = null;
  let creatorWear: IdentityCall | null = null;
  let venueWear: IdentityCall | null = null;
  let ready = false;
  let disposed = false;
  const limitations = [
    'This is source-only identity evidence, not production adoption or a visual acceptance decision.',
    'Both contexts use the all-player-pose provider contract. Native provider eligibility is observed from returned bodies and is never forced.',
    'Creator preview body is the object returned by createAvatarPreview’s production bodyLoader seam; the venue object is returned by loadGameBody.',
  ];

  function setStatus(text: string): void {
    status.textContent = text;
    audit.textContent = JSON.stringify(snapshot(), null, 2);
  }
  function evidence(body: SkinnedBody | null, call: IdentityCall | null): BodyEvidence | null {
    return body ? fingerprintBody(body, call) : null;
  }
  function snapshot(): IdentityReport {
    const creator = evidence(creatorBody, creatorWear), venue = evidence(venueBody, venueWear);
    const previewDiagnostics = preview?.diagnostics();
    const sameSeed = creatorWear?.seed === GAME_PLAYER_SEED && venueWear?.seed === GAME_PLAYER_SEED
      && creatorWear?.tintFingerprint === expectedTintFingerprint && venueWear?.tintFingerprint === expectedTintFingerprint;
    const sameLook = creatorWear?.lookFingerprint === expectedFingerprint && venueWear?.lookFingerprint === expectedFingerprint;
    const sameFamily = creator?.key === venue?.key && creator !== null && venue !== null;
    const sameRig = creator?.skeletonNames.join('|') === venue?.skeletonNames.join('|')
      && Boolean(creator?.skeletonNames.length && venue?.skeletonNames.length);
    const sameGeometry = creator?.geometrySignature === venue?.geometrySignature
      && Boolean(creator?.geometrySignature && venue?.geometrySignature);
    const bothWearAccepted = creatorWear?.accepted === true && venueWear?.accepted === true;
    return {
      ready, errors: [...errors],
      identity: { expectedSeed: GAME_PLAYER_SEED, expectedLookFingerprint: expectedFingerprint, expectedTintFingerprint,
        previewInputCarriesSameSeed: previewLook.seed === GAME_PLAYER_SEED },
      creator, venue,
      comparisons: {
        sameSeedReachedAndWasAcceptedByBothBodies: sameSeed && bothWearAccepted,
        sameNormalizedLookReachedBothBodies: sameLook,
        sameReturnedBodyFamily: sameFamily,
        sameReturnedSkeleton: sameRig,
        sameReturnedSkinnedGeometry: sameGeometry,
        preparedNativeBodyReturnedForBothContexts: creator?.preparedNative === true && venue?.preparedNative === true,
        previewHasStoppedFiniteRendering: previewDiagnostics?.animating === false,
      },
      preview: previewDiagnostics ? { renderCount: previewDiagnostics.renderCount, frames: previewDiagnostics.frames,
        animating: previewDiagnostics.animating, triangles: previewDiagnostics.triangles,
        focus: previewDiagnostics.focus, yaw: previewDiagnostics.yaw } : null,
      captures: captures.map((capture) => ({ ...capture })),
      disposal: { preview: disposed, creatorKit: disposed, venueBody: venueBody === null, venueKit: disposed },
      limitations: [...limitations],
    };
  }

  async function capture(name: string): Promise<void> {
    if (!preview) throw new Error('Creator preview is not ready');
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const canvas = preview.canvas;
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('Injected creator preview renderer lost its WebGL2 context');
    const width = canvas.width, height = canvas.height;
    if (width < 1 || height < 1) throw new Error(`Creator preview canvas has invalid dimensions ${width}x${height}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let alphaPixels = 0, visiblePixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]! > 8) {
        alphaPixels += 1;
        if (pixels[i]! > 12 || pixels[i + 1]! > 12 || pixels[i + 2]! > 12) visiblePixels += 1;
      }
    }
    const preserveDrawingBuffer = gl.getContextAttributes()?.preserveDrawingBuffer === true;
    if (!preserveDrawingBuffer) throw new Error('Creator preview WebGL2 context does not preserve its drawing buffer');
    const dataUrl = canvas.toDataURL('image/png');
    if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('Direct WebGL canvas did not produce a PNG data URL');
    capturePngs.set(name, dataUrl);
    const existing = captures.find((item) => item.name === name);
    const record = { name, width, height, alphaPixels, visiblePixels, preserveDrawingBuffer };
    if (existing) Object.assign(existing, record); else captures.push(record);
  }

  async function initialize(): Promise<void> {
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
      if (!context) throw new Error('Could not create the injected WebGL2 identity evidence context');
      const renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true,
        preserveDrawingBuffer: true, powerPreference: 'low-power' });
      try { preview = createAvatarPreview(host, {
        renderer,
        look: previewLook, focus: 'body', label: 'Saved game identity, creator preview', reducedMotion: true,
        bodyLoader: async (look, seed, scale) => {
          const body = await loadGameBody(creatorKit, look, seed, scale,
            { scene: 'creator', role: 'player', poses: CREATOR_POSES });
          creatorBody = body;
          observeWear(body, (call) => { creatorWear = call; });
          return body;
        },
      }); } catch (error) { renderer.dispose(); renderer.forceContextLoss(); throw error; }
      const until = performance.now() + 90_000;
      while (!creatorWear && performance.now() < until) await new Promise<void>((resolve) => setTimeout(resolve, 100));
      if (!creatorBody || !creatorWear) throw new Error('Production creator preview did not return and wear its skinned body before the deadline');

      venueBody = await loadGameBody(venueKit, GAME_PLAYER_LOOK, GAME_PLAYER_SEED, 1,
        { scene: 'venue', role: 'player', poses: VENUE_POSES });
      observeWear(venueBody, (call) => { venueWear = call; });
      venueBody.wear(GAME_PLAYER_LOOK, GAME_PLAYER_SEED);
      ready = true;
      setStatus('Creator preview and venue provider returned bodies for the same saved game identity. Select a body, head or profile capture.');
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      ready = true;
      setStatus(`Identity fixture stopped: ${errors.at(-1)}`);
    }
  }

  function dispose() {
    if (disposed) return { disposed: true, repeated: true };
    disposed = true;
    preview?.dispose(); preview = null;
    venueBody?.dispose(); venueBody = null;
    creatorKit.dispose(); venueKit.dispose();
    setStatus('Creator and venue identity fixture disposed.');
    return { disposed: true, repeated: false };
  }

  void initialize();
  async function setView(name: 'body-front' | 'head-front' | 'body-profile'): Promise<IdentityReport> {
    if (!ready || !preview) throw new Error('Creator identity preview is not ready');
    if (name === 'body-front') {
      preview.setFocus('body');
      preview.rotate(-preview.diagnostics().yaw);
    } else if (name === 'head-front') {
      preview.setFocus('head');
      preview.rotate(-preview.diagnostics().yaw);
    } else {
      preview.setFocus('body');
      const yaw = preview.diagnostics().yaw;
      preview.rotate(Math.PI / 2 - yaw);
    }
    await capture(name);
    return snapshot();
  }

  function exportCaptures() {
    return captures.map((capture) => ({ ...capture, dataUrl: capturePngs.get(capture.name) ?? null }));
  }
  return { sample: snapshot, setView, exportCaptures, dispose };
}

window.nativeCreatorIdentity = createFixture();
