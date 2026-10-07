// npm run body:build -- [--raw /tmp/aw-assets] [--verbose] [--keep]
//   --raw      where the two unzipped Quaternius downloads are (default /tmp/aw-assets; layout in docs/ASSETS.md)
//   --verbose  print gltfpack's report for each output
//   --keep     keep the intermediate work folder in the system temp dir
//
// Turns the raw CC0 Quaternius downloads (docs/ASSETS.md) into what the game ships from src/scene/body/assets/ (imported
// with `?url`, so the build copies each to dist/assets/ under a content hash and the server caches it for a year):
//   base-body-male.glb, base-body-female.glb   one skinned mesh each: one primitive, one material, 23 bones, ≤ 4 weights a vertex
//   clip-pack.glb          the clip pack (no mesh): rotation tracks on the same 23 bones + the pelvis translation, the
//                          UAL clips below plus the ones scripts/body/author-clips.ts makes (door, sleep, bathe, stairs)
// and writes src/scene/body/manifest.ts (sizes, counts, colour references the runtime tints with).
//
// WHAT IT DOES TO THE SOURCE
//   Bones      the 40 finger bones and both ball_leaf bones are dropped; their weights go to the nearest kept
//              ancestor (hand_l/r, ball_l/r), the four largest weights a vertex are kept and renormalised. Every
//              dropped bone is a leaf subtree, so the kept joints' bind matrices are the source's own.
//   Mesh       body + a buzzed hair cap (rigged to Head), merged into one primitive. Eyes and eyebrows (alpha cards,
//              two more materials) are left out: the face texture already paints eyes and brows.
//   Regions    COLOR_0 carries where clothes go, per vertex, from the bone weights: r skin (head, neck, forearms,
//              hands), g top (spine, clavicles, upper arms), b bottoms (pelvis, legs), a hair; shoes are what is
//              left (feet). The runtime material (src/scene/body/skinned.ts) colours each from the saved look.
//   Texture    base colour only, 1024 px JPEG (normal and roughness maps are dropped for size).
//   Clips      Idle, Walk, Jog, Sitting enter/loop/exit, Interact and Dance from UAL1_Standard (root motion off),
//              resampled and quantised by gltfpack. Scale tracks and every translation track but the pelvis's are
//              dropped, so the clips keep each body's own proportions.
//
// Needs: npx (gltfpack 1.3, fetched on first use) and macOS `sips` (texture resize and JPEG).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';
import { authoredClips } from './author-clips.ts';
import { GltfWriter, glbJson, loadGltf, readAccessor } from './gltf-io.ts';
import { BODY_MANIFEST } from '../../src/scene/body/manifest.ts';
import type { Loaded, Node } from './gltf-io.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const at = args.indexOf(name); return at >= 0 && args[at + 1] ? args[at + 1]! : fallback; };
const RAW = resolve(option('--raw', '/tmp/aw-assets'));
const OUT = join(repo, 'src', 'scene', 'body', 'assets');
const MANIFEST = join(repo, 'src', 'scene', 'body', 'manifest.ts');
const GLTFPACK = ['-y', 'gltfpack@1.3.0'];

const UBC = join(RAW, 'ubc', 'Universal Base Characters[Standard]');
const BODY_DIR = join(UBC, 'Base Characters', 'Godot - UE');
const HAIR_DIR = join(UBC, 'Hairstyles', 'Rigged to Head Bone', 'glTF (Godot -Unreal)');
const UAL = join(RAW, 'ual', 'Universal Animation Library[Standard]', 'Unreal-Godot', 'UAL1_Standard.glb');

/** The bones the game keeps (23), in skin order. Everything else in the source rig is a finger or a toe tip. */
export const KEPT_BONES = Object.freeze(['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r'] as const);
/** Which clothing region each kept bone's weight paints: 0 skin, 1 top, 2 bottoms, 3 hair, 4 shoes. */
const REGION_OF: Record<string, number> = {
  root: 2, pelvis: 2, spine_01: 1, spine_02: 1, spine_03: 1, neck_01: 0, Head: 0,
  clavicle_l: 1, upperarm_l: 1, lowerarm_l: 0, hand_l: 0, clavicle_r: 1, upperarm_r: 1, lowerarm_r: 0, hand_r: 0,
  thigh_l: 2, calf_l: 2, foot_l: 4, ball_l: 4, thigh_r: 2, calf_r: 2, foot_r: 4, ball_r: 4,
};
/** The core clip pack: source clip name → the name the game plays. */
export const CLIPS: Readonly<Record<string, string>> = Object.freeze({
  Idle_Loop: 'idle', Walk_Loop: 'walk', Jog_Fwd_Loop: 'jog',
  Sitting_Enter: 'sit-enter', Sitting_Idle_Loop: 'sit', Sitting_Exit: 'sit-exit',
  Interact: 'interact', Dance_Loop: 'dance',
});
/** Activities the game has that no clip in the pack covers (the body holds its nearest still pose for them). */
export const MISSING_CLIPS = Object.freeze([] as string[]);
const HERO_TRIANGLES = 9000;
const TEXTURE_PX = 1024, JPEG_QUALITY = 78;

interface BodySource { key: 'male' | 'female'; gltf: string; texture: string; hair: string }
const BODIES: BodySource[] = [
  { key: 'male', gltf: 'Superhero_Male_FullBody.gltf', texture: 'T_Superhero_Male_Dark.png', hair: 'Hair_Buzzed.gltf' },
  { key: 'female', gltf: 'Superhero_Female_FullBody.gltf', texture: 'T_Superhero_Female_Dark_BaseColor.png', hair: 'Hair_BuzzedFemale.gltf' },
];

// ---- helpers -------------------------------------------------------------------------------------------
const brotli = (bytes: Buffer): number => brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
const toLinear = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const round = (value: number, places = 4): number => Number(value.toFixed(places));
function parents(nodes: Node[]): Map<number, number> {
  const map = new Map<number, number>();
  nodes.forEach((node, index) => node.children?.forEach((child) => map.set(child, index)));
  return map;
}
function gltfpack(input: string, output: string, extra: string[]): string {
  const cached = option('--gltfpack', '');
  return execFileSync(cached ? process.execPath : 'npx', [...(cached ? [cached] : GLTFPACK), '-i', input, '-o', output, ...extra, '-v'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, npm_config_offline: 'true' } });
}
function need(path: string): void { if (!existsSync(path)) throw new Error(`missing raw asset: ${path}\nDownload the packs listed in docs/ASSETS.md into ${RAW} (see the README there).`); }

/** A 24-bit top-down or bottom-up BMP (what `sips -s format bmp` writes) → RGB rows, top first. */
function readBmp(path: string): { width: number; height: number; rgb: Uint8Array } {
  const file = readFileSync(path);
  const offset = file.readUInt32LE(10), width = file.readInt32LE(18), rawHeight = file.readInt32LE(22), bpp = file.readUInt16LE(28);
  if (bpp !== 24 && bpp !== 32) throw new Error(`unexpected BMP depth ${bpp}`);
  const height = Math.abs(rawHeight), stride = Math.ceil((width * bpp) / 32) * 4, rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const row = offset + (rawHeight < 0 ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const at = row + x * (bpp / 8), out = (y * width + x) * 3;
      rgb[out] = file[at + 2]!; rgb[out + 1] = file[at + 1]!; rgb[out + 2] = file[at]!;
    }
  }
  return { width, height, rgb };
}
/** The same skin/cloth split the runtime shader makes (src/scene/body/skinned.ts), on linear colour. */
export function isSkin(r: number, g: number, b: number): boolean {
  const high = Math.max(r, g, b), low = Math.min(r, g, b);
  return high > 0.01 && (high - low) / high > 0.35;
}

/** Average linear colour of skin texels, mean luminance of skin and of cloth, and one skin texel's UV. */
function textureReference(png: string, work: string) {
  const bmp = join(work, 'probe.bmp');
  execFileSync('sips', ['-s', 'format', 'bmp', '-Z', '256', png, '--out', bmp], { stdio: 'ignore' });
  const { width, height, rgb } = readBmp(bmp);
  const skin: [number, number, number] = [0, 0, 0], lum = { skin: 0, cloth: 0 }, count = { skin: 0, cloth: 0 };
  let skinUv: [number, number] | null = null;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 3, r = toLinear(rgb[at]!), g = toLinear(rgb[at + 1]!), b = toLinear(rgb[at + 2]!);
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (isSkin(r, g, b)) { skin[0] += r; skin[1] += g; skin[2] += b; lum.skin += l; count.skin++; if (!skinUv && x > width * 0.6 && y > height * 0.6) skinUv = [(x + 0.5) / width, (y + 0.5) / height]; }
    else if (l > 0.002) { lum.cloth += l; count.cloth++; }
  }
  return {
    skinRef: skin.map((value) => round(value / count.skin)) as [number, number, number],
    skinLum: round(lum.skin / count.skin), clothLum: round(lum.cloth / Math.max(count.cloth, 1)),
    skinUv: skinUv ?? [0.9, 0.9],
  };
}

// ---- one body ------------------------------------------------------------------------------------------
interface Part { position: Float64Array; normal: Float64Array; uv: Float64Array; joints: Float64Array; weights: Float64Array; indices: Float64Array; jointNames: string[]; hair: boolean }

function meshPart(doc: Loaded, nodeName: (mesh: number) => boolean, hair: boolean): Part {
  const json = doc.json, skin = json.skins![0]!;
  const node = json.nodes.find((entry) => entry.mesh !== undefined && nodeName(entry.mesh))!;
  const primitive = json.meshes![node.mesh!]!.primitives[0]!;
  const a = primitive.attributes;
  return {
    position: readAccessor(doc, a.POSITION!), normal: readAccessor(doc, a.NORMAL!), uv: readAccessor(doc, a.TEXCOORD_0!),
    joints: readAccessor(doc, a.JOINTS_0!), weights: readAccessor(doc, a.WEIGHTS_0!), indices: readAccessor(doc, primitive.indices!),
    jointNames: skin.joints.map((joint) => json.nodes[joint]!.name ?? ''), hair,
  };
}

function buildBody(source: BodySource, work: string) {
  const gltfPath = join(BODY_DIR, source.gltf), texturePath = join(BODY_DIR, source.texture), hairPath = join(HAIR_DIR, source.hair);
  [gltfPath, texturePath, hairPath].forEach(need);
  const doc = loadGltf(gltfPath), hairDoc = loadGltf(hairPath), json = doc.json;
  const skin = json.skins![0]!, up = parents(json.nodes);
  const byName = new Map(json.nodes.map((node, index) => [node.name ?? '', index]));
  // The body is the mesh whose material is the character's (not the hair-card eyebrows, not the eyes).
  const bodyMesh = json.meshes!.findIndex((mesh) => mesh.primitives[0]!.attributes.TEXCOORD_0 !== undefined && (json.accessors[mesh.primitives[0]!.attributes.POSITION!]!.count > 3000));
  const parts = [meshPart(doc, (mesh) => mesh === bodyMesh, false), meshPart(hairDoc, () => true, true)];
  const reference = textureReference(texturePath, work);

  // A dropped joint's weight goes to its nearest kept ancestor.
  const keptIndex = new Map<string, number>(KEPT_BONES.map((name, index) => [name, index]));
  const keptFor = (name: string): number => {
    for (let node = byName.get(name); node !== undefined; node = up.get(node)) {
      const kept = keptIndex.get(json.nodes[node]!.name ?? '');
      if (kept !== undefined) return kept;
    }
    throw new Error(`joint ${name} has no kept ancestor`);
  };
  const vertexCount = parts.reduce((sum, part) => sum + part.position.length / 3, 0);
  const indexCount = parts.reduce((sum, part) => sum + part.indices.length, 0);
  const position = new Float32Array(vertexCount * 3), normal = new Float32Array(vertexCount * 3), uv = new Float32Array(vertexCount * 2);
  const joints = new Uint8Array(vertexCount * 4), weights = new Float32Array(vertexCount * 4), colour = new Uint8Array(vertexCount * 4);
  const indices = new Uint32Array(indexCount);
  let base = 0, cursor = 0;
  for (const part of parts) {
    const count = part.position.length / 3, jointMap = part.jointNames.map(keptFor);
    for (let v = 0; v < count; v++) {
      const out = base + v;
      position.set(part.position.subarray(v * 3, v * 3 + 3), out * 3);
      normal.set(part.normal.subarray(v * 3, v * 3 + 3), out * 3);
      if (part.hair) uv.set(reference.skinUv, out * 2); else uv.set(part.uv.subarray(v * 2, v * 2 + 2), out * 2);
      const merged = new Map<number, number>();
      for (let k = 0; k < 4; k++) {
        const w = part.weights[v * 4 + k]!;
        if (w > 0) { const j = jointMap[part.joints[v * 4 + k]!]!; merged.set(j, (merged.get(j) ?? 0) + w); }
      }
      const top = [...merged.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4);
      const total = top.reduce((sum, [, w]) => sum + w, 0) || 1;
      const region = [0, 0, 0, 0, 0];
      top.forEach(([j, w], k) => { joints[out * 4 + k] = j; weights[out * 4 + k] = w / total; region[REGION_OF[KEPT_BONES[j]!]!]! += w / total; });
      if (part.hair) region.splice(0, 5, 0, 0, 0, 1, 0);
      for (let k = 0; k < 4; k++) colour[out * 4 + k] = Math.round(region[k]! * 255);
    }
    for (let i = 0; i < part.indices.length; i++) indices[cursor + i] = part.indices[i]! + base;
    base += count; cursor += part.indices.length;
  }

  // The texture: 1024 px JPEG of the base colour.
  const jpeg = join(work, `${source.key}.jpg`);
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(JPEG_QUALITY), '-Z', String(TEXTURE_PX), texturePath, '--out', jpeg], { stdio: 'ignore' });

  const out = new GltfWriter(), g = out.json;
  // Kept joints keep their source transforms; parents are the nearest kept ancestors (which are their real parents).
  KEPT_BONES.forEach((name) => { const node = json.nodes[byName.get(name)!]!; const copy: Node = { name }; for (const key of ['translation', 'rotation', 'scale'] as const) if (node[key]) copy[key] = node[key]; g.nodes.push(copy); });
  KEPT_BONES.forEach((name, index) => {
    if (index === 0) return;
    let parent = up.get(byName.get(name)!);
    while (parent !== undefined && !keptIndex.has(json.nodes[parent]!.name ?? '')) parent = up.get(parent);
    const at = keptIndex.get(json.nodes[parent!]!.name ?? '')!;
    (g.nodes[at]!.children ??= []).push(index);
  });
  const sourceIbm = readAccessor(doc, skin.inverseBindMatrices!);
  const ibm = new Float32Array(KEPT_BONES.length * 16);
  KEPT_BONES.forEach((name, index) => { const at = skin.joints.indexOf(byName.get(name)!); ibm.set(sourceIbm.subarray(at * 16, at * 16 + 16), index * 16); });
  const image = out.view(readFileSync(jpeg));
  g.images = [{ bufferView: image, mimeType: 'image/jpeg', name: `${source.key}-base` }];
  g.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
  g.textures = [{ sampler: 0, source: 0 }];
  g.materials = [{ name: `body-${source.key}`, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.82 } }];
  g.meshes = [{ name: `body-${source.key}`, primitives: [{
    attributes: {
      POSITION: out.accessor(position, 'VEC3', { target: 34962, bounds: true }), NORMAL: out.accessor(normal, 'VEC3', { target: 34962 }),
      TEXCOORD_0: out.accessor(uv, 'VEC2', { target: 34962 }), COLOR_0: out.accessor(colour, 'VEC4', { target: 34962, normalized: true }),
      JOINTS_0: out.accessor(joints, 'VEC4', { target: 34962 }), WEIGHTS_0: out.accessor(weights, 'VEC4', { target: 34962 }),
    },
    indices: out.accessor(indices, 'SCALAR', { target: 34963 }), material: 0,
  }] }];
  g.skins = [{ name: 'body', joints: KEPT_BONES.map((_, index) => index), inverseBindMatrices: out.accessor(ibm, 'MAT4'), skeleton: 0 }];
  g.nodes.push({ name: 'body', mesh: 0, skin: 0 });
  g.nodes.push({ name: 'Armature', children: [g.nodes.length - 1, 0] });
  g.scenes = [{ name: source.key, nodes: [g.nodes.length - 1] }]; g.scene = 0;
  const merged = out.save(work, `${source.key}-merged`);
  const sourceTriangles = indexCount / 3;
  const target = join(OUT, `base-body-${source.key}.glb`);
  // -si: the share of triangles to keep; -kn keeps the bone names the clips bind to; no texture recompression.
  const log = gltfpack(merged, target, ['-cc', '-kn', '-si', (HERO_TRIANGLES / sourceTriangles).toFixed(3)]);
  const pelvis = json.nodes[byName.get('pelvis')!]!.translation!;
  const head = parts[0]!.position.reduce((top, value, index) => (index % 3 === 1 ? Math.max(top, value) : top), 0);
  return { source, target, log, reference, sourceTriangles, pelvis, height: head };
}

// ---- clips ---------------------------------------------------------------------------------------------
function buildClips(work: string) {
  need(UAL);
  const doc = loadGltf(UAL), json = doc.json, up = parents(json.nodes);
  const byName = new Map(json.nodes.map((node, index) => [node.name ?? '', index]));
  const out = new GltfWriter(), g = out.json;
  const keptIndex = new Map<string, number>(KEPT_BONES.map((name, index) => [name, index]));
  KEPT_BONES.forEach((name) => { const node = json.nodes[byName.get(name)!]!; const copy: Node = { name }; for (const key of ['translation', 'rotation', 'scale'] as const) if (node[key]) copy[key] = node[key]; g.nodes.push(copy); });
  KEPT_BONES.forEach((name, index) => {
    if (index === 0) return;
    let parent = up.get(byName.get(name)!);
    while (parent !== undefined && !keptIndex.has(json.nodes[parent]!.name ?? '')) parent = up.get(parent);
    (g.nodes[keptIndex.get(json.nodes[parent!]!.name ?? '')!]!.children ??= []).push(index);
  });
  g.scenes = [{ name: 'clips', nodes: [0] }]; g.scene = 0;
  g.animations = [];
  const present: string[] = [];
  for (const [from, to] of Object.entries(CLIPS)) {
    const clip = json.animations!.find((animation) => animation.name === from);
    if (!clip) continue;
    present.push(to);
    const channels: { sampler: number; target: { node: number; path: string } }[] = [], samplers: { input: number; output: number; interpolation: string }[] = [];
    for (const channel of clip.channels) {
      const name = json.nodes[channel.target.node]!.name ?? '', kept = keptIndex.get(name);
      if (kept === undefined || name === 'root') continue;
      if (channel.target.path === 'scale' || (channel.target.path === 'translation' && name !== 'pelvis')) continue;
      const sampler = clip.samplers[channel.sampler]!;
      const input = Float32Array.from(readAccessor(doc, sampler.input));
      const output = Float32Array.from(readAccessor(doc, sampler.output));
      samplers.push({ input: out.accessor(input, 'SCALAR', { bounds: true }), output: out.accessor(output, channel.target.path === 'rotation' ? 'VEC4' : 'VEC3'), interpolation: sampler.interpolation ?? 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: kept, path: channel.target.path } });
    }
    g.animations.push({ name: to, channels, samplers });
  }
  // The authored clips: keyframed rotations on the same bones, built from the UAL rest pose and source clips.
  const authored = [...authoredClips(doc, KEPT_BONES, loadGltf(join(OUT, 'base-body-male.glb'))),
    ...authoredClips(doc, KEPT_BONES, loadGltf(join(OUT, 'base-body-female.glb')), '-female').filter((clip) => clip.name.endsWith('-female'))];
  for (const clip of authored) {
    present.push(clip.name);
    const channels: { sampler: number; target: { node: number; path: string } }[] = [], samplers: { input: number; output: number; interpolation: string }[] = [];
    for (const track of clip.tracks) {
      const kept = keptIndex.get(track.bone);
      if (kept === undefined || track.bone === 'root') continue;
      samplers.push({ input: out.accessor(track.times, 'SCALAR', { bounds: true }), output: out.accessor(track.values, track.path === 'rotation' ? 'VEC4' : 'VEC3'), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: kept, path: track.path } });
    }
    g.animations.push({ name: clip.name, channels, samplers });
  }
  const merged = out.save(work, 'clips-merged');
  const target = join(OUT, 'clip-pack.glb');
  // -af 20: resample at 20 Hz; -ar 12: 12-bit rotations; -ac keeps constant tracks so every clip poses every bone.
  const log = gltfpack(merged, target, ['-cc', '-kn', '-ac', '-af', '20', '-ar', '12']);
  return { target, log, present, pelvis: json.nodes[byName.get('pelvis')!]!.translation! };
}

// ---- run -----------------------------------------------------------------------------------------------
function summary(path: string) {
  const bytes = readFileSync(path), shipped = glbJson(bytes);
  const primitive = shipped.meshes?.[0]?.primitives[0];
  return {
    bytes: bytes.length, brotli: brotli(bytes),
    triangles: primitive?.indices !== undefined ? shipped.accessors[primitive.indices]!.count / 3 : 0,
    bones: shipped.skins?.[0]?.joints.length ?? 0,
    hash: createHash('sha256').update(bytes).digest('hex').slice(0, 10),
  };
}

function main(): void {
  mkdirSync(OUT, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'aw-body-'));
  try {
    const clipsOnly = args.includes('--clips-only'), bodies = clipsOnly ? [] : BODIES.map((source) => buildBody(source, work));
    const clips = buildClips(work);
    if (args.includes('--verbose')) for (const entry of [...bodies, clips]) console.log(entry.log);
    const lines: string[] = [];
    const record: Record<string, unknown> = clipsOnly ? { ...BODY_MANIFEST.bodies } : {};
    for (const body of bodies) {
      const facts = summary(body.target);
      lines.push(`base-body-${body.source.key}.glb  ${facts.bytes} B raw, ${facts.brotli} B brotli, ${facts.triangles} triangles (from ${body.sourceTriangles}), ${facts.bones} bones`);
      record[body.source.key] = {
        sha: facts.hash, bytes: facts.bytes, brotli: facts.brotli, triangles: facts.triangles, bones: facts.bones,
        height: round(body.height, 3), pelvis: body.pelvis.map((value) => round(value)), ...body.reference,
      };
    }
    const clipFacts = summary(clips.target);
    lines.push(`clip-pack.glb  ${clipFacts.bytes} B raw, ${clipFacts.brotli} B brotli, clips: ${clips.present.join(', ')}`);
    const manifest = {
      bodies: record,
      clips: { sha: clipFacts.hash, bytes: clipFacts.bytes, brotli: clipFacts.brotli, names: clips.present, pelvis: clips.pelvis.map((value) => round(value)) },
      bones: KEPT_BONES, missing: MISSING_CLIPS,
    };
    const text = `// GENERATED by scripts/body/build-body.ts (npm run body:build). Do not edit by hand.\n`
      + `// What src/scene/body/assets/ holds, and the texture colour references the body material tints from (linear RGB).\n`
      + `export const BODY_MANIFEST = ${JSON.stringify(manifest, null, 2)} as const;\n`
      + `export type BodyKey = keyof typeof BODY_MANIFEST.bodies;\n`;
    writeFileSync(MANIFEST, text);
    console.log(lines.join('\n'));
  } finally {
    if (!args.includes('--keep')) rmSync(work, { recursive: true, force: true });
    else console.log(`kept intermediate files in ${work}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
