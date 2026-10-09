import * as THREE from 'three';
import type { Look } from '/src/scene/characters.ts';
import type { ResolvedAvatarWearableId } from '/src/types/avatar.ts';
import type { AvatarBodyRegion } from '/src/game/wardrobe/catalogue.ts';
import { AVATAR_WEARABLE_CATALOGUE } from '/src/game/wardrobe/catalogue.ts';

export interface ResolvedWardrobeLook {
  readonly look: Pick<Look, 'body' | 'hair' | 'hairColor' | 'outfit' | 'outfitColor' | 'bottomsColor' | 'skin' | 'fabric'>;
  readonly ids: readonly ResolvedAvatarWearableId[];
}
export type WardrobePresentation = 'everyday' | 'bathing' | 'sleeping';
export interface WardrobeGeometry {
  readonly geometry: THREE.BufferGeometry;
  readonly hides: ReadonlySet<AvatarBodyRegion>;
  readonly coverage: readonly { readonly region: AvatarBodyRegion; readonly minY: number; readonly maxY: number }[];
  readonly triangles: number;
  readonly itemTriangles: Readonly<Record<string, number>>;
  readonly bytes: number;
}
/** Rest positions are captured from inverse bind matrices, never from currently posed bones. */
export interface WardrobeRestFrame {
  readonly meshFromMetres: THREE.Matrix4;
  readonly metresFromMesh: THREE.Matrix4;
  readonly bones: ReadonlyMap<string, { readonly index: number; readonly point: THREE.Vector3 }>;
  readonly bounds: ReadonlyMap<string, THREE.Box3>;
  readonly points: readonly THREE.Vector3[];
  readonly sourceWeightsAt: (point: THREE.Vector3) => readonly (readonly [number, number])[];
}
const TAU = Math.PI * 2;
const CLOTH_ITEMS = new Set(Object.entries(AVATAR_WEARABLE_CATALOGUE).filter(([id, definition]) =>
  ['head', 'full', 'carry'].includes(definition.slot) || id === 'neck-scarf' || id === 'shoulder-wrap',
).map(([id]) => id));
const SIDES = ['l', 'r'] as const;
type Weight = readonly [number, number];
type Weights = readonly Weight[];
type Point = readonly [number, number, number];
type ArmholeLoop = { readonly points: readonly THREE.Vector3[]; readonly indices: readonly number[] };

export function captureWardrobeRestFrame(base: THREE.SkinnedMesh): WardrobeRestFrame {
  // The body's mesh-node matrix decodes its quantized GLB positions. Parent placement is deliberately excluded.
  base.updateMatrix();
  const metresFromMesh = base.matrix.clone(), meshFromMetres = metresFromMesh.clone().invert();
  const bones = new Map<string, { index: number; point: THREE.Vector3 }>();
  const inverseBind = base.bindMatrix.clone().invert();
  base.skeleton.bones.forEach((bone, index) => {
    const inverse = base.skeleton.boneInverses[index];
    if (!inverse) throw new Error(`Wardrobe has no inverse bind for ${bone.name}`);
    const point = new THREE.Vector3().setFromMatrixPosition(inverse.clone().invert()).applyMatrix4(inverseBind).applyMatrix4(metresFromMesh);
    bones.set(bone.name, { index, point });
  });
  for (const name of ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', ...SIDES.flatMap(side => [`upperarm_${side}`, `lowerarm_${side}`, `hand_${side}`, `thigh_${side}`, `calf_${side}`, `foot_${side}`, `ball_${side}`])]) {
    if (!bones.has(name)) throw new Error(`Wardrobe requires bone ${name}`);
  }
  const positions = base.geometry.getAttribute('position'), skinIndices = base.geometry.getAttribute('skinIndex'), skinWeights = base.geometry.getAttribute('skinWeight'), colours = base.geometry.getAttribute('color');
  if (!positions || !skinIndices || !skinWeights) throw new Error('Wardrobe requires skinned base attributes');
  const points: THREE.Vector3[] = [], bounds = new Map<string, THREE.Box3>();
  for (let i = 0; i < positions.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(metresFromMesh);
    points.push(point);
    let dominant = 0;
    for (let j = 1; j < 4; j++) if (skinWeights.getComponent(i, j) > skinWeights.getComponent(i, dominant)) dominant = j;
    const bone = base.skeleton.bones[skinIndices.getComponent(i, dominant)];
    const name = colours && colours.itemSize === 4 && colours.getW(i) > 0.5 ? 'hair' : bone?.name;
    if (name) {
      let box = bounds.get(name);
      if (!box) { box = new THREE.Box3(); bounds.set(name, box); }
      box.expandByPoint(point);
    }
  }
  const sourceWeightsAt = (target: THREE.Vector3): readonly (readonly [number, number])[] => {
    const nearest: { index: number; distance: number }[] = [];
    for (let i = 0; i < points.length; i++) {
      const distance = points[i]!.distanceToSquared(target);
      if (nearest.length < 4 || distance < nearest[nearest.length - 1]!.distance) {
        nearest.push({ index: i, distance }); nearest.sort((a, b) => a.distance - b.distance);
        if (nearest.length > 4) nearest.pop();
      }
    }
    const combined = new Map<number, number>();
    for (const candidate of nearest) {
      const spatial = 1 / Math.max(0.004, Math.sqrt(candidate.distance));
      for (let channel = 0; channel < 4; channel++) {
        const weight = skinWeights.getComponent(candidate.index, channel) * spatial;
        const bone = skinIndices.getComponent(candidate.index, channel);
        if (weight > 0) combined.set(bone, (combined.get(bone) ?? 0) + weight);
      }
    }
    const sorted = [...combined].sort((a, b) => b[1] - a[1]).slice(0, 4), total = sorted.reduce((sum, entry) => sum + entry[1], 0);
    return sorted.map(([bone, weight]) => [bone, weight / total] as const);
  };
  return { meshFromMetres, metresFromMesh, bones, bounds, points, sourceWeightsAt };
}

class ClothBuilder {
  private readonly positions: number[] = [];
  private readonly colours: number[] = [];
  private readonly skinIndices: number[] = [];
  private readonly skinWeights: number[] = [];
  private readonly indices: number[] = [];
  private readonly fabricUvs: number[] = [];
  private readonly fabricMasks: number[] = [];
  private cloth = false;
  private agbadaTorsoPattern = false;
  private agbadaHipY = 0;
  private readonly counts: Record<string, number> = {};
  readonly hides = new Set<AvatarBodyRegion>();
  readonly coverage: { region: AvatarBodyRegion; minY: number; maxY: number }[] = [];
  readonly clothProfiles: (readonly { y: number; rx: number; rz: number; z?: number }[])[] = [];
  withAgbadaTorsoPattern<T>(hipY: number, build: () => T): T {
    const previous = this.agbadaTorsoPattern, previousHip = this.agbadaHipY;
    this.agbadaTorsoPattern = true; this.agbadaHipY = hipY;
    try { return build(); } finally { this.agbadaTorsoPattern = previous; this.agbadaHipY = previousHip; }
  }
  clothFront(y: number, x: number): number {
    let front = -Infinity;
    for (const profile of this.clothProfiles) {
      const sorted = [...profile].sort((a, b) => a.y - b.y);
      if (y < sorted[0]!.y || y > sorted[sorted.length - 1]!.y) continue;
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i]!, next = sorted[i + 1]!;
        if (y < a.y || y > next.y) continue;
        const t = (y - a.y) / Math.max(0.001, next.y - a.y), rx = THREE.MathUtils.lerp(a.rx, next.rx, t), rz = THREE.MathUtils.lerp(a.rz, next.rz, t), z = THREE.MathUtils.lerp(a.z ?? 0, next.z ?? 0, t);
        if (Math.abs(x) < rx) front = Math.max(front, z + rz * Math.sqrt(1 - (x / rx) ** 2));
      }
    }
    return front;
  }
  cover(region: AvatarBodyRegion, minY: number, maxY: number): void {
    this.hides.add(region); this.coverage.push({ region, minY, maxY });
  }
  readonly rest: WardrobeRestFrame;
  constructor(rest: WardrobeRestFrame) { this.rest = rest; }
  anchor(name: string): THREE.Vector3 {
    const bone = this.rest.bones.get(name);
    if (!bone) throw new Error(`Unknown wardrobe bone ${name}`);
    return bone.point.clone();
  }
  rigid(name: string): Weights {
    const bone = this.rest.bones.get(name);
    if (!bone) throw new Error(`Unknown wardrobe bone ${name}`);
    return [[bone.index, 1]];
  }
  blend(a: string, b: string, t: number): Weights {
    const ratio = THREE.MathUtils.clamp(t, 0, 1);
    const first = this.rest.bones.get(a), second = this.rest.bones.get(b);
    if (!first || !second) throw new Error(`Unknown wardrobe bones ${a}/${b}`);
    return [[first.index, 1 - ratio], [second.index, ratio]];
  }
  bodyWeights(point: THREE.Vector3): Weights {
    const hip = this.anchor('pelvis'), knee = this.anchor('calf_l'), spine = this.anchor('spine_01'), chest = this.anchor('spine_03');
    if (point.y >= hip.y) {
      if (point.y > chest.y) return this.rigid('spine_03');
      if (point.y > spine.y) return this.blend('spine_01', 'spine_03', (point.y - spine.y) / (chest.y - spine.y));
      return this.blend('pelvis', 'spine_01', (point.y - hip.y) / (spine.y - hip.y));
    }
    const side = point.x >= hip.x ? 'l' : 'r';
    if (point.y > knee.y) return this.blend('pelvis', `thigh_${side}`, (hip.y - point.y) / Math.max(0.1, hip.y - knee.y));
    return this.blend(`thigh_${side}`, `calf_${side}`, (knee.y - point.y) / 0.18);
  }
  item(id: string, build: () => void): void {
    const before = this.indices.length;
    this.cloth = CLOTH_ITEMS.has(id) || id.startsWith('outfit:') || id === 'hair:gele';
    build();
    const triangles = (this.indices.length - before) / 3;
    if (triangles > 4000) throw new Error(`${id} exceeds the wardrobe item budget`);
    this.counts[id] = triangles;
  }
  vertex(point: THREE.Vector3, colour: THREE.Color, weights: Weights): number {
    const index = this.positions.length / 3;
    const local = point.clone().applyMatrix4(this.rest.meshFromMetres);
    this.positions.push(local.x, local.y, local.z);
    this.colours.push(colour.r, colour.g, colour.b);
    const agbadaTorso = this.cloth && this.agbadaTorsoPattern;
    this.fabricUvs.push(agbadaTorso ? point.x : point.x + point.z * 0.35, agbadaTorso ? point.y - this.agbadaHipY : point.y);
    this.fabricMasks.push(this.cloth ? agbadaTorso && point.z > 0.025 ? 2 : 1 : 0);
    for (let j = 0; j < 4; j++) { this.skinIndices.push(weights[j]?.[0] ?? 0); this.skinWeights.push(weights[j]?.[1] ?? 0); }
    return index;
  }
  triangle(a: number, b: number, c: number): void { this.indices.push(a, b, c); }
  surface(rows: readonly (readonly THREE.Vector3[])[], colour: THREE.Color, weights: (p: THREE.Vector3, station: number) => Weights, closed = true, firstIndices?: readonly number[], reverse = false): void {
    const grid = rows.map((row, station) => station === 0 && firstIndices
      ? [...firstIndices]
      : row.map(p => this.vertex(p, colour, weights(p, station - (firstIndices ? 1 : 0)))));
    for (let y = 0; y < grid.length - 1; y++) {
      const row = grid[y]!, next = grid[y + 1]!;
      for (let x = 0; x < row.length - (closed ? 0 : 1); x++) {
        const n = (x + 1) % row.length;
        if (reverse) { this.triangle(row[x]!, next[n]!, next[x]!); this.triangle(row[x]!, row[n]!, next[n]!); }
        else { this.triangle(row[x]!, next[x]!, next[n]!); this.triangle(row[x]!, next[n]!, row[n]!); }
      }
    }
  }
  loft(levels: readonly { y: number; rx: number; rz: number; z?: number; x?: number }[], colour: THREE.Color, weights: (p: THREE.Vector3) => Weights = p => this.bodyWeights(p), segments = 12, start = 0, end = TAU): void {
    const closed = end - start >= TAU - 0.001;
    const rows = levels.map(level => Array.from({ length: segments + (closed ? 0 : 1) }, (_, i) => {
      const angle = start + (end - start) * i / segments;
      return new THREE.Vector3((level.x ?? 0) + Math.cos(angle) * level.rx, level.y, (level.z ?? 0) + Math.sin(angle) * level.rz);
    }));
    this.surface(rows, colour, weights, closed);
  }
  loftWithArmholes(levels: readonly { y: number; rx: number; rz: number; z?: number; x?: number }[], colour: THREE.Color, weights: (p: THREE.Vector3) => Weights, segments = 14, holeRow = 3, holeCells = 4): ReadonlyMap<typeof SIDES[number], ArmholeLoop> {
    const rows = levels.map(level => Array.from({ length: segments }, (_, i) => {
      const angle = TAU * i / segments;
      return new THREE.Vector3((level.x ?? 0) + Math.cos(angle) * level.rx, level.y, (level.z ?? 0) + Math.sin(angle) * level.rz);
    }));
    // Carry actual shoulder/neck skin weights all the way over the roof. Returning to
    // synthetic spine-only weights on the next row makes the roof shear when the arm raises.
    const grid = rows.map((row, station) => row.map(p => this.vertex(p, colour, station >= holeRow ? this.rest.sourceWeightsAt(p) : weights(p))));
    const starts = new Map<typeof SIDES[number], number>();
    for (const side of SIDES) starts.set(side, (side === 'l' ? 0 : segments / 2) - Math.floor(holeCells / 2));
    for (let y = 0; y < grid.length - 1; y++) for (let x = 0; x < segments; x++) {
      const inHole = y === holeRow && [...starts.values()].some(start => Array.from({ length: holeCells }, (_, i) => (start + i + segments) % segments).includes(x));
      if (inHole) continue;
      const next = grid[y + 1]!, row = grid[y]!, n = (x + 1) % segments;
      if (y >= holeRow + 1) {
        const a = rows[y]![x]!, b = rows[y + 1]![x]!, c = rows[y + 1]![n]!, d = rows[y]![n]!;
        const faceDot = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) => q.clone().sub(p).cross(r.clone().sub(p)).normalize();
        const fixed = faceDot(a, b, c).dot(faceDot(a, c, d));
        const alternate = faceDot(a, b, d).dot(faceDot(b, c, d));
        if (alternate > fixed) { this.triangle(row[x]!, next[x]!, row[n]!); this.triangle(next[x]!, next[n]!, row[n]!); continue; }
      }
      this.triangle(row[x]!, next[x]!, next[n]!); this.triangle(row[x]!, next[n]!, row[n]!);
    }
    const loops = new Map<typeof SIDES[number], ArmholeLoop>();
    for (const side of SIDES) {
      const start = starts.get(side)!;
      const columns = Array.from({ length: holeCells + 1 }, (_, i) => (start + i + segments) % segments);
      const indices = [...columns.map(x => grid[holeRow]![x]!), ...columns.slice().reverse().map(x => grid[holeRow + 1]![x]!)];
      const points = [...columns.map(x => rows[holeRow]![x]!), ...columns.slice().reverse().map(x => rows[holeRow + 1]![x]!)];
      // Keep the grid perimeter's cyclic order. Re-sorting in a projected plane can swap
      // front/back corners when the torso section is asymmetric.
      loops.set(side, { points, indices });
    }
    return loops;
  }
  tube(points: readonly THREE.Vector3[], radii: readonly number[], colour: THREE.Color, weights: (p: THREE.Vector3, station: number) => Weights, segments = 6, aspect = 1, root?: ArmholeLoop): void {
    const firstAxis = root ? points[Math.min(1, points.length - 1)]!.clone().sub(points[0]!).normalize() : null;
    const reference = firstAxis && Math.abs(firstAxis.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const rootA = firstAxis ? new THREE.Vector3().crossVectors(firstAxis, reference).normalize() : null;
    const rootB = firstAxis && rootA ? new THREE.Vector3().crossVectors(firstAxis, rootA).normalize() : null;
    const rootCentre = root ? root.points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / root.points.length) : null;
    // Keep every sleeve column aligned to the corresponding vertex in the torso's
    // cyclic armhole boundary. That loop is intentionally nonuniform; resampling it
    // as an even circle twists the bridge when the arm is raised.
    const rootAngles = root && rootA && rootB && rootCentre
      ? root.points.map(point => Math.atan2(point.clone().sub(rootCentre).dot(rootB), point.clone().sub(rootCentre).dot(rootA)))
      : [];
    const rows = points.map((p, i) => {
      const next = points[Math.min(i + 1, points.length - 1)]!, prior = points[Math.max(0, i - 1)]!;
      const axis = next.clone().sub(prior).normalize();
      const reference = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      const a = new THREE.Vector3().crossVectors(axis, reference).normalize(), b = new THREE.Vector3().crossVectors(axis, a).normalize();
      return Array.from({ length: segments }, (_, j) => {
        const angle = root ? rootAngles[j]! : j * TAU / segments;
        return p.clone().addScaledVector(a, Math.cos(angle) * radii[i]!).addScaledVector(b, Math.sin(angle) * radii[i]! * aspect);
      });
    });
    this.surface(root ? [root.points, ...rows] : rows, colour, weights, true, root?.indices);
  }
  ball(centre: THREE.Vector3, radius: Point, colour: THREE.Color, weights: Weights, segments = 8, bands = 4): void {
    const rows = Array.from({ length: bands + 1 }, (_, j) => Array.from({ length: segments }, (_, i) => {
      const phi = Math.PI * j / bands, theta = TAU * i / segments;
      return new THREE.Vector3(centre.x + Math.sin(phi) * Math.cos(theta) * radius[0], centre.y + Math.cos(phi) * radius[1], centre.z + Math.sin(phi) * Math.sin(theta) * radius[2]);
    }));
    this.surface(rows, colour, () => weights);
  }
  box(centre: THREE.Vector3, size: Point, colour: THREE.Color, weights: Weights): void {
    const geometry = new THREE.BoxGeometry(...size);
    const positions = geometry.getAttribute('position'), indices = geometry.getIndex();
    const start = this.positions.length / 3;
    for (let i = 0; i < positions.count; i++) this.vertex(new THREE.Vector3().fromBufferAttribute(positions, i).add(centre), colour, weights);
    if (indices) for (let i = 0; i < indices.count; i += 3) this.triangle(start + indices.getX(i), start + indices.getX(i + 1), start + indices.getX(i + 2));
    geometry.dispose();
  }
  ring(centre: THREE.Vector3, rx: number, ry: number, rz: number, thickness: number, colour: THREE.Color, weights: Weights, segments = 16): void {
    const points = Array.from({ length: segments + 1 }, (_, i) => {
      const a = TAU * i / segments;
      return new THREE.Vector3(centre.x + Math.cos(a) * rx, centre.y + Math.sin(a) * ry, centre.z + Math.sin(a) * rz);
    });
    this.tube(points, points.map(() => thickness), colour, () => weights, 4);
  }
  finish(): WardrobeGeometry {
    const triangles = this.indices.length / 3;
    if (triangles > 3000) throw new Error(`Wardrobe combination has ${triangles} triangles, maximum 3000`);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colours, 3));
    geometry.setAttribute('wardrobeUv', new THREE.Float32BufferAttribute(this.fabricUvs, 2));
    geometry.setAttribute('wardrobeCloth', new THREE.Float32BufferAttribute(this.fabricMasks, 1));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinWeights, 4));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    const bytes = Object.values(geometry.attributes).reduce((n, attribute) => n + attribute.array.byteLength, 0) + (geometry.index?.array.byteLength ?? 0);
    return { geometry, hides: this.hides, coverage: this.coverage, triangles, itemTriangles: this.counts, bytes };
  }
}

function colour(hex: string): THREE.Color { return new THREE.Color(hex); }
const GOLD = colour('#d5aa45'), SILVER = colour('#c4c9d0'), BLACK = colour('#20252d'), WHITE = colour('#eeeae0');
function fitTorso(b: ClothBuilder, y: number, padding = 0.018): { rx: number; rz: number; z: number } {
  const shoulder = Math.abs(b.anchor('upperarm_l').x);
  const points = b.rest.points.filter(p => Math.abs(p.y - y) < 0.035 && Math.abs(p.x) < shoulder + 0.012);
  const box = new THREE.Box3().setFromPoints(points);
  if (box.isEmpty()) return { rx: shoulder + padding, rz: 0.14 + padding, z: 0 };
  return { rx: Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) + padding, rz: (box.max.z - box.min.z) / 2 + padding, z: (box.max.z + box.min.z) / 2 };
}
function torso(b: ClothBuilder, fabric: THREE.Color, hem: number, bulk = 0.018, armholes = false): ReadonlyMap<typeof SIDES[number], ArmholeLoop> | null {
  const hip = b.anchor('pelvis'), neck = b.anchor('neck_01'), shoulder = b.anchor('upperarm_l');
  const headBox = b.rest.bounds.get('Head');
  const neckRadius = Math.min(0.058, (headBox ? headBox.max.x - headBox.min.x : 0.18) * 0.29);
  const levels = [
    { y: hem, ...fitTorso(b, hem, bulk) },
    { y: hip.y + 0.1, ...fitTorso(b, hip.y + 0.1, bulk) },
    { y: b.anchor('spine_02').y, ...fitTorso(b, b.anchor('spine_02').y, bulk) },
    { y: b.anchor('spine_03').y + 0.065, ...fitTorso(b, b.anchor('spine_03').y + 0.065, bulk) },
    { y: shoulder.y + 0.028, rx: shoulder.x + 0.028 + bulk, rz: 0.108 + bulk, z: shoulder.z + 0.012 },
    { y: neck.y - 0.016, rx: neckRadius + 0.036, rz: 0.075, z: neck.z + 0.008 },
    { y: neck.y + 0.012, rx: neckRadius + 0.006, rz: 0.06, z: neck.z },
  ];
  b.clothProfiles.push(levels);
  const shortHem = hem >= hip.y - 0.2;
  const weights = (p: THREE.Vector3) => shortHem && p.y < hip.y ? b.rigid('pelvis') : b.bodyWeights(p);
  const holes = armholes ? b.loftWithArmholes(levels, fabric, weights, 14, 3, 4) : (b.loft(levels, fabric, weights, 16), null);
  b.cover('torso', hem, neck.y + 0.013); b.cover('hips', hem, neck.y + 0.013);
  return holes;
}
function sleeves(b: ClothBuilder, fabric: THREE.Color, length: 'short' | 'long' | 'wide', bulk = 0, armholes?: ReadonlyMap<typeof SIDES[number], ArmholeLoop> | null): void {
  for (const side of SIDES) {
    const shoulder = b.anchor(`upperarm_${side}`), elbow = b.anchor(`lowerarm_${side}`), wrist = b.anchor(`hand_${side}`);
    const upperBox = b.rest.bounds.get(`upperarm_${side}`), lowerBox = b.rest.bounds.get(`lowerarm_${side}`);
    const radius = upperBox
      ? length === 'wide'
        // Size a wide sleeve from the arm's cross-section; the old additive/fixed
        // profile grew beyond this scale and made Agbada inflate into a hollow ring.
        ? Math.max(upperBox.max.y - upperBox.min.y, upperBox.max.z - upperBox.min.z) / 2 + 0.015 + bulk * 0.5
        : (upperBox.max.y - upperBox.min.y) / 2 + 0.025 + bulk
      : 0.095;
    const end = length === 'short' ? shoulder.clone().lerp(elbow, 0.84) : wrist.clone().lerp(elbow, 0.04);
    const lower = (lowerBox ? (lowerBox.max.y - lowerBox.min.y) / 2 : 0.055) + 0.016 + bulk;
    const armDirection = elbow.clone().sub(shoulder).normalize();
    const first = shoulder.clone().addScaledVector(armDirection, 0.025);
    const armStations = length === 'short'
      ? [first, shoulder.clone().lerp(end, 0.3), shoulder.clone().lerp(end, 0.7), end]
      : [first, shoulder.clone().lerp(elbow, 0.45), elbow, elbow.clone().lerp(end, 0.55), end];
    const radii = length === 'wide' ? [radius * 1.02, radius * 1.1, radius * 1.18, radius * 1.25, radius * 1.2]
      : length === 'short' ? [radius * 1.015, radius, radius * 0.94, radius * 0.9]
      : [radius * 1.015, radius, radius * 0.92, lower * 1.07, lower];
    // Join the sleeve to an armhole cut from the torso grid so both surfaces share the same
    // seam vertices. The old independent tube left a free boundary at the shoulder joint.
    const root = armholes?.get(side);
    const stations = armStations;
    const stationRadii = radii;
    const arm = elbow.clone().sub(shoulder), forearm = wrist.clone().sub(elbow);
    const armLengthSq = arm.lengthSq(), forearmLengthSq = forearm.lengthSq();
    b.tube(stations, stationRadii, fabric, (_p, station) => {
      // At the torso seam, carry the body's local shoulder field into the first two
      // sleeve rings. A single rigid arm-station weight there twists the welded loop
      // when the clavicle and upper arm swing in opposite directions.
      if (root && station <= 1) return b.rest.sourceWeightsAt(_p);
      // Use each tube station's center so all vertices around its circumference get the same
      // weights; world X varies around the circumference and is not a useful joint coordinate.
      const centre = stations[station]!;
      const alongArm = THREE.MathUtils.clamp(centre.clone().sub(shoulder).dot(arm) / armLengthSq, 0, 1);
      if (alongArm < 1) return b.blend(`upperarm_${side}`, `lowerarm_${side}`, alongArm);
      const alongForearm = THREE.MathUtils.clamp(centre.clone().sub(elbow).dot(forearm) / forearmLengthSq, 0, 1);
      return b.blend(`lowerarm_${side}`, `hand_${side}`, alongForearm);
    }, root ? 10 : 12, length === 'wide' ? 1.16 : 1, root);
  }
  // Short sleeves keep all underlying arm triangles. Their exposed cuffs remain clothed by the original base.
  if (length !== 'short') { b.hides.add('upperarms'); b.hides.add('forearms'); }
}
function trousers(b: ClothBuilder, fabric: THREE.Color, shorts = false, shirtHem?: number): void {
  const pelvis = b.anchor('pelvis');
  for (const side of SIDES) {
    const thigh = b.anchor(`thigh_${side}`), knee = b.anchor(`calf_${side}`), foot = b.anchor(`foot_${side}`);
    const box = b.rest.bounds.get(`thigh_${side}`), width = box ? (box.max.x - box.min.x) / 2 + 0.018 : 0.12;
    const waist = fitTorso(b, thigh.y + 0.075, 0);
    // The 8-point trouser ring is coarser than the 14-point office torso. Insetting
    // the hidden waistband by a little extra keeps its chord faces under the shirt shell.
    const waistRx = Math.max(0.028, Math.min(width * 0.48, waist.rx - Math.abs(thigh.x) - 0.02));
    const waistRz = Math.max(0.035, Math.min(0.07, waist.rz - Math.abs(thigh.z - waist.z) - 0.016));
    // The trouser taper can leave the shirt silhouette well above its waistband. Add a
    // tucked hip station at the shirt hem so the first exposed trouser ring stays inside
    // the shirt in the rest pose; the next station resumes the normal thigh width.
    const hemProfile = shirtHem === undefined ? null : fitTorso(b, shirtHem, 0.018);
    const hemRx = hemProfile ? Math.max(0.035, Math.min(width * 0.62, hemProfile.rx - Math.abs(thigh.x) - 0.018)) : 0;
    const hemRz = hemProfile ? Math.max(0.04, Math.min(0.09, hemProfile.rz * Math.sqrt(Math.max(0, 1 - (thigh.x / hemProfile.rx) ** 2)) - Math.abs(thigh.z - hemProfile.z) - 0.012)) : 0;
    b.loft([
      // Keep the trouser opening inside the shirt at the waist; the larger thigh section starts below it.
      { y: thigh.y + 0.075, x: thigh.x, z: thigh.z, rx: waistRx, rz: waistRz },
      ...(hemProfile ? [{ y: shirtHem! - 0.005, x: thigh.x, z: thigh.z, rx: hemRx, rz: hemRz }] : []),
      { y: knee.y + (shorts ? 0.08 : 0), x: knee.x, z: knee.z, rx: width * 0.86, rz: 0.108 },
      ...(shorts ? [] : [{ y: foot.y + 0.04, x: foot.x, z: foot.z, rx: 0.079, rz: 0.09 }]),
    ], fabric, p => {
      // Match the shirt's tucked hem to its rigid pelvis weights. Below the hem, ease
      // from pelvis to thigh as the trouser leaves the shirt instead of letting the
      // generic leg weights pull the shared silhouette away during a hip pose.
      // Above the pelvis, the shirt follows the torso's normal spine weights. Match
      // those exactly; only the tucked section below the pelvis is rigidly pelvis-bound.
      if (p.y >= pelvis.y) return b.bodyWeights(p);
      if (shirtHem !== undefined && p.y >= shirtHem - 0.006) return b.rigid('pelvis');
      if (p.y > knee.y) {
        const t = shirtHem === undefined
          ? (thigh.y - p.y) / Math.max(0.1, thigh.y - knee.y)
          : (shirtHem - p.y) / Math.max(0.1, shirtHem - knee.y);
        return b.blend('pelvis', `thigh_${side}`, t);
      }
      if (shirtHem === undefined) return b.rigid(`calf_${side}`);
      return b.blend(`thigh_${side}`, `calf_${side}`, (knee.y - p.y) / Math.max(0.12, knee.y - foot.y));
    }, 8);
  }
  if (!shorts) b.cover('legs', b.anchor('foot_l').y + 0.04, b.anchor('thigh_l').y + 0.075);
}
function skirt(b: ClothBuilder, fabric: THREE.Color, hem: number, flare: number, wrapper = false): void {
  const hip = b.anchor('pelvis'), upper = fitTorso(b, hip.y, 0.027);
  b.loft([
    { y: hip.y + 0.105, rx: upper.rx, rz: upper.rz, z: upper.z },
    { y: hip.y - 0.1, rx: upper.rx + 0.015, rz: upper.rz + 0.02, z: upper.z },
    { y: (hip.y + hem) / 2, rx: upper.rx + flare * 0.55, rz: upper.rz + flare * 0.3, z: upper.z },
    { y: hem, rx: upper.rx + flare, rz: upper.rz + flare * 0.55, z: upper.z },
  ], fabric, p => b.bodyWeights(p), 14);
  if (wrapper) {
    const strip = colour('#e0bc70');
    b.loft([{ y: hip.y + 0.11, rx: upper.rx + 0.008, rz: upper.rz + 0.008, z: upper.z }, { y: hip.y + 0.065, rx: upper.rx + 0.009, rz: upper.rz + 0.009, z: upper.z }], strip, () => b.rigid('pelvis'), 14);
    b.box(new THREE.Vector3(upper.rx * 0.72, hip.y + 0.025, upper.z + upper.rz + 0.02), [0.07, 0.16, 0.032], fabric, b.rigid('pelvis'));
  }
  b.cover('hips', hem, hip.y + 0.105); b.cover('legs', hem, hip.y + 0.105);
}
function collar(b: ClothBuilder, fabric: THREE.Color, tie = false): void {
  const neck = b.anchor('neck_01'), chest = b.anchor('spine_03'), weights = b.rigid('spine_03');
  for (const sign of [-1, 1]) b.box(new THREE.Vector3(sign * 0.065, neck.y - 0.016, 0.087), [0.075, 0.065, 0.012], fabric, weights);
  if (tie) {
    b.tube([new THREE.Vector3(0, neck.y - 0.026, 0.092), new THREE.Vector3(0, chest.y + 0.03, 0.165)], [0.012, 0.027], BLACK, () => weights, 4, 0.25);
    b.ball(new THREE.Vector3(0, neck.y - 0.031, 0.095), [0.021, 0.026, 0.012], BLACK, weights, 4, 2);
  }
}
function garment(b: ClothBuilder, id: string, read: ResolvedWardrobeLook['look']): void {
  const top = colour(read.outfitColor), bottom = colour(read.bottomsColor), hip = b.anchor('pelvis'), knee = b.anchor('calf_l'), ankle = b.anchor('foot_l');
  switch (id) {
    case 'agbada':
      trousers(b, bottom); b.withAgbadaTorsoPattern(hip.y, () => torso(b, top, knee.y + 0.13, 0.07)); sleeves(b, top, 'wide', 0.025);
      break;
    case 'kaftan':
      trousers(b, bottom); torso(b, top, knee.y + 0.025, 0.027); sleeves(b, top, 'long'); collar(b, top);
      b.box(new THREE.Vector3(0, hip.y + 0.23, 0.171), [0.022, 0.42, 0.012], GOLD, b.rigid('spine_01')); break;
    case 'abaya':
      skirt(b, top, ankle.y + 0.055, 0.18); torso(b, top, hip.y - 0.1, 0.035); sleeves(b, top, 'long', 0.02);
      b.loft([{ y: ankle.y + 0.075, rx: 0.36, rz: 0.24 }, { y: ankle.y + 0.095, rx: 0.355, rz: 0.237 }], GOLD, p => b.bodyWeights(p)); break;
    case 'buba-iro':
      skirt(b, bottom, ankle.y + 0.09, 0.055, true); torso(b, top, hip.y - 0.085, 0.047); sleeves(b, top, 'short', 0.036); break;
    case 'school-uniform':
      if (read.body === 'woman') skirt(b, bottom, knee.y - 0.045, 0.075); else trousers(b, bottom);
      torso(b, WHITE, hip.y - 0.03); sleeves(b, WHITE, 'short'); collar(b, WHITE, true);
      b.box(new THREE.Vector3(0.072, b.anchor('spine_03').y + 0.024, 0.166), [0.064, 0.082, 0.009], WHITE.clone().multiplyScalar(0.88), b.rigid('spine_03')); break;
    case 'work-uniform':
      trousers(b, bottom); torso(b, top, hip.y - 0.045, 0.032); sleeves(b, top, 'long'); collar(b, top);
      for (const x of [-0.09, 0.09]) {
        b.box(new THREE.Vector3(x, b.anchor('spine_03').y + 0.015, 0.178), [0.073, 0.078, 0.014], bottom, b.rigid('spine_03'));
        b.box(new THREE.Vector3(x, hip.y + 0.09, 0.174), [0.077, 0.025, 0.012], WHITE, b.rigid('spine_01'));
      }
      break;
    case 'gown': torso(b, top, hip.y - 0.08, 0.02); sleeves(b, top, 'short'); skirt(b, top, ankle.y + 0.08, 0.2); break;
    case 'owambe': garment(b, 'buba-iro', read); break;
    case 'hoodie': {
      trousers(b, bottom); torso(b, top, hip.y - 0.125, 0.045); sleeves(b, top, 'long', 0.015);
      const neck = b.anchor('neck_01');
      b.loft([{ y: neck.y - 0.06, rx: 0.145, rz: 0.13, z: -0.04 }, { y: neck.y + 0.045, rx: 0.125, rz: 0.1, z: -0.06 }], top, () => b.rigid('spine_03'), 12, 2.65, TAU + 0.49);
      b.box(new THREE.Vector3(0, hip.y + 0.12, 0.19), [0.18, 0.09, 0.012], top.clone().multiplyScalar(0.86), b.rigid('spine_01')); break;
    }
    case 'office': {
      trousers(b, bottom, false, hip.y - 0.085);
      const armholes = torso(b, top, hip.y - 0.085, 0.018, true);
      sleeves(b, top, 'long', 0, armholes); collar(b, WHITE, true); break;
    }
    case 'sitework':
      trousers(b, bottom); torso(b, top, hip.y - 0.1); sleeves(b, top, 'short');
      for (const x of [-0.09, 0.09]) b.box(new THREE.Vector3(x, hip.y + 0.3, 0.175), [0.035, 0.34, 0.014], colour('#e6cd51'), b.rigid('spine_02'));
      break;
    case 'chill': case 'jersey': trousers(b, bottom, true); torso(b, top, hip.y - 0.085); sleeves(b, top, 'short'); break;
    default: trousers(b, bottom); torso(b, top, hip.y - 0.085); sleeves(b, top, 'short');
  }
}

function headCover(b: ClothBuilder, id: string, fabric: THREE.Color): void {
  const head = b.anchor('Head'), neck = b.anchor('neck_01'), hair = b.rest.bounds.get('hair');
  const top = hair?.max.y ?? head.y + 0.23, weights = b.rigid('Head');
  b.hides.add('hair');
  if (id === 'hijab-drape' || id === 'hijab-wrap') {
    // The open arc spans back and sides. No triangle crosses the front face aperture.
    b.loft([{ y: neck.y + 0.025, rx: 0.112, rz: 0.115, z: -0.026 }, { y: head.y + 0.09, rx: 0.12, rz: 0.13, z: -0.01 }, { y: top - 0.055, rx: 0.102, rz: 0.114, z: -0.015 }], fabric, () => weights, 12, 2.5, TAU + 0.64);
    b.loft([{ y: top - 0.054, rx: 0.104, rz: 0.116, z: -0.015 }, { y: top + 0.004, rx: 0.063, rz: 0.072, z: -0.014 }, { y: top + 0.018, rx: 0.001, rz: 0.001, z: -0.01 }], fabric, () => weights, 12);
    const long = id === 'hijab-drape', low = long ? b.anchor('spine_03').y + 0.01 : neck.y - 0.09;
    const width = Math.abs(b.anchor('upperarm_l').x) + 0.038;
    const mantle = [{ y: neck.y + 0.055, rx: 0.111, rz: 0.118, z: -0.02 }, { y: neck.y - 0.025, rx: 0.123, rz: 0.133, z: -0.015 }, { y: neck.y - (long ? 0.075 : 0.045), rx: width * 0.9, rz: 0.167, z: -0.015 }, { y: low + (long ? 0.04 : 0.024), rx: width, rz: 0.192, z: -0.015 }, { y: low, rx: width * 0.96, rz: 0.187, z: -0.015 }];
    b.clothProfiles.push(mantle);
    const rows = mantle.map((level, row) => Array.from({ length: 16 }, (_, i) => {
      const angle = TAU * i / 16;
      return new THREE.Vector3(Math.cos(angle) * level.rx, level.y + (row === mantle.length - 1 ? Math.abs(Math.cos(angle)) * Math.min(0.04, (neck.y - low) * 0.22) : 0), level.z + Math.sin(angle) * level.rz);
    }));
    b.surface(rows, fabric, p => b.blend('spine_03', 'Head', Math.max(0, (p.y - low - 0.06) / (head.y - low - 0.06))));
    if (!long) b.box(new THREE.Vector3(-0.11, neck.y - 0.14, 0.157), [0.08, 0.25, 0.035], fabric.clone().multiplyScalar(0.9), b.rigid('spine_03'));
    b.hides.add('neck'); return;
  }
  const centre = new THREE.Vector3(0, top - 0.07, -0.012);
  if (id === 'legacy-cap') {
    b.loft([{ y: centre.y - 0.05, rx: 0.108, rz: 0.12, z: -0.01 }, { y: top + 0.01, rx: 0.095, rz: 0.102, z: -0.01 }, { y: top + 0.024, rx: 0.001, rz: 0.001 }], fabric, () => weights);
    b.box(new THREE.Vector3(0, centre.y - 0.027, 0.13), [0.19, 0.017, 0.15], fabric, weights); return;
  }
  if (id === 'legacy-fila') {
    b.loft([{ y: centre.y - 0.03, rx: 0.104, rz: 0.116 }, { y: top + 0.09, rx: 0.093, rz: 0.1, x: 0.026 }, { y: top + 0.095, rx: 0.001, rz: 0.001, x: 0.026 }], fabric, () => weights, 8); return;
  }
  b.ball(centre.clone().add(new THREE.Vector3(0, 0.02, -0.004)), [0.116, 0.105, 0.133], fabric, weights, 12, 4);
  for (let i = 0; i < 3; i++) b.ring(new THREE.Vector3(0, centre.y - 0.018 + i * 0.033, -0.01), 0.116 - i * 0.005, 0, 0.128 - i * 0.007, 0.012, fabric.clone().multiplyScalar(0.86 + i * 0.07), weights, 12);
  if (id === 'turban' || id === 'legacy-headwrap') {
    b.ball(new THREE.Vector3(0, centre.y + 0.035, 0.122), [0.037, 0.043, 0.026], fabric, weights, 6, 3);
    if (id === 'legacy-headwrap') b.box(new THREE.Vector3(-0.098, head.y - 0.045, -0.11), [0.065, 0.22, 0.028], fabric, weights);
  } else if (id === 'gele-fan') {
    const rows = Array.from({ length: 3 }, (_, j) => Array.from({ length: 13 }, (_, i) => {
      const angle = Math.PI * i / 12;
      return new THREE.Vector3(Math.cos(angle) * (0.12 + j * 0.073), top - 0.025 + Math.sin(angle) * (0.06 + j * 0.085), -0.08 - j * 0.008 + Math.cos(i * Math.PI) * 0.019);
    }));
    b.surface(rows, fabric, () => weights, false);
  } else {
    for (let j = 0; j < 4; j++) b.ring(new THREE.Vector3(0.063, top + 0.022 + j * 0.016, 0.033), 0.086 - j * 0.018, 0.076 - j * 0.015, 0, 0.021, fabric.clone().multiplyScalar(0.9 + j * 0.045), weights, 12);
  }
}
function hairStyle(b: ClothBuilder, style: string, tint: THREE.Color): void {
  if (style === 'bald') { b.hides.add('hair'); return; }
  if (style === 'lowcut' || style === 'fade') return;
  if (style === 'gele') { headCover(b, 'gele-fan', tint); return; }
  b.hides.add('hair');
  const head = b.anchor('Head'), top = b.rest.bounds.get('hair')?.max.y ?? head.y + 0.22, weights = b.rigid('Head');
  b.ball(new THREE.Vector3(0, top - 0.064, -0.024), [0.102, 0.082, 0.103], tint, weights, 10, 3);
  switch (style) {
    case 'curls': b.ball(new THREE.Vector3(0, top - 0.056, -0.025), [0.123, 0.1, 0.12], tint, weights, 12, 4); break;
    case 'afro': b.ball(new THREE.Vector3(0, top - 0.05, -0.025), [0.162, 0.157, 0.155], tint, weights, 12, 5); break;
    case 'bun': b.ball(new THREE.Vector3(0, top + 0.07, -0.058), [0.086, 0.09, 0.084], tint, weights); break;
    case 'ponytail':
      b.tube([new THREE.Vector3(0, top - 0.03, -0.1), new THREE.Vector3(0, head.y + 0.035, -0.18), new THREE.Vector3(0, head.y - 0.15, -0.2)], [0.045, 0.053, 0.032], tint, () => weights, 8); break;
    case 'long':
      b.loft([{ y: top - 0.01, rx: 0.097, rz: 0.1, z: -0.02 }, { y: head.y - 0.12, rx: 0.12, rz: 0.13, z: -0.05 }, { y: head.y - 0.29, rx: 0.15, rz: 0.13, z: -0.05 }], tint, () => weights, 12, 2.55, TAU + 0.59); break;
    case 'bantuknots':
      for (let i = 0; i < 7; i++) { const angle = TAU * i / 7; b.ball(new THREE.Vector3(Math.cos(angle) * 0.093, top + (i % 2 ? 0.01 : 0.035), -0.025 + Math.sin(angle) * 0.072), [0.037, 0.043, 0.037], tint, weights, 6, 3); } break;
    case 'cornrows':
      for (let i = -2; i <= 2; i++) b.tube([new THREE.Vector3(i * 0.031, top - 0.033, 0.067), new THREE.Vector3(i * 0.031, top + 0.01, -0.025), new THREE.Vector3(i * 0.031, head.y + 0.06, -0.105)], [0.014, 0.015, 0.013], tint, () => weights, 5); break;
    case 'classic': b.ball(new THREE.Vector3(0.028, top - 0.015, -0.005), [0.105, 0.067, 0.095], tint, weights, 10, 3); break;
    default: {
      const count = style === 'braids' ? 10 : 8, radius = style === 'twists' ? 0.018 : 0.024;
      for (let i = 0; i < count; i++) {
        const a = 2.5 + i * 4.3 / (count - 1), x = Math.cos(a) * 0.103, z = -0.025 + Math.sin(a) * 0.102;
        b.tube([new THREE.Vector3(x, top - 0.035, z), new THREE.Vector3(x * 1.08, head.y + 0.025, z), new THREE.Vector3(x * 1.28, head.y - (style === 'braids' ? 0.23 : 0.18), z - 0.015)], [radius, radius, radius * 0.75], tint, () => weights, 5);
      }
    }
  }
}
function necklace(b: ClothBuilder, id: string): void {
  const neck = b.anchor('neck_01'), weights = b.rigid('spine_03'), centre = new THREE.Vector3(0, neck.y - 0.038, -0.015);
  const beads = id === 'beads' || id === 'coral', thick = id === 'chain-cuban';
  const points = Array.from({ length: 17 }, (_, i) => {
    const a = TAU * i / 16, front = Math.sin(a), p = new THREE.Vector3(Math.cos(a) * 0.109, centre.y - Math.max(0, front) * 0.115, centre.z + front * 0.154);
    if (front > 0.05) p.z = Math.max(p.z, b.clothFront(p.y, p.x) + (beads ? 0.026 : 0.016));
    return p;
  });
  if (beads) {
    const coral = id === 'coral', tint = colour(coral ? '#d45033' : '#a77732');
    for (let i = 0; i < 16; i++) b.ball(points[i]!, coral ? [0.018, 0.025, 0.018] : [0.017, 0.017, 0.017], tint, weights, 5, 2);
    if (coral) for (let i = 3; i <= 5; i++) b.ball(points[i]!.clone().add(new THREE.Vector3(0, -0.045, 0.016)), [0.017, 0.028, 0.017], tint, weights, 5, 2);
  } else {
    b.tube(points, points.map(() => thick ? 0.008 : 0.0035), GOLD, () => weights, thick ? 5 : 3);
    if (thick) for (let i = 1; i < 16; i += 2) b.ball(points[i]!, [0.011, 0.007, 0.011], GOLD, weights, 4, 2);
    if (id === 'chain-pendant' || id === 'legacy-chain') b.box(points[4]!.clone().add(new THREE.Vector3(0, -0.043, 0.016)), [0.041, 0.06, 0.008], GOLD, weights);
  }
}
function scarf(b: ClothBuilder, id: string, fabric: THREE.Color): void {
  const neck = b.anchor('neck_01'), weights = b.rigid('spine_03');
  b.loft([{ y: neck.y + 0.022, rx: 0.111, rz: 0.112, z: neck.z }, { y: neck.y - 0.052, rx: 0.114, rz: 0.115, z: neck.z }], fabric, () => weights, 12);
  if (id === 'neck-scarf') {
    b.box(new THREE.Vector3(0.027, neck.y - 0.17, 0.11), [0.073, 0.25, 0.026], fabric, weights);
    b.box(new THREE.Vector3(-0.04, neck.y - 0.126, 0.128), [0.065, 0.18, 0.018], fabric.clone().multiplyScalar(0.88), weights);
  } else {
    const shoulder = b.anchor('upperarm_l');
    b.loft([{ y: neck.y - 0.025, rx: 0.118, rz: 0.12, z: -0.025 }, { y: shoulder.y - 0.055, rx: shoulder.x + 0.08, rz: 0.22, z: -0.025 }, { y: b.anchor('spine_03').y - 0.09, rx: shoulder.x + 0.065, rz: 0.205, z: -0.025 }], fabric, p => b.blend('spine_02', 'spine_03', (p.y - b.anchor('spine_03').y + 0.09) / 0.2), 14);
  }
  b.cover('neck', neck.y - 0.052, neck.y + 0.022);
}
function wrist(b: ClothBuilder, id: string): void {
  const hand = b.anchor('hand_l'), weights = b.rigid('hand_l');
  const centre = hand.clone().add(new THREE.Vector3(-0.018, 0, 0));
  const count = id === 'bangles' ? 3 : id === 'legacy-beads' ? 2 : 1;
  for (let j = 0; j < count; j++) {
    const points = Array.from({ length: 13 }, (_, i) => { const a = TAU * i / 12; return new THREE.Vector3(centre.x - j * 0.018, centre.y + Math.cos(a) * 0.056, centre.z + Math.sin(a) * 0.047); });
    b.tube(points, points.map(() => id === 'bangles' ? 0.008 : 0.01), id === 'legacy-beads' ? colour('#c96239') : GOLD, () => weights, 4);
  }
  if (id === 'wristwatch' || id === 'legacy-watch') {
    b.box(centre.clone().add(new THREE.Vector3(0, 0.06, 0)), [0.047, 0.018, 0.053], SILVER, weights);
    b.box(centre.clone().add(new THREE.Vector3(0, 0.071, 0)), [0.033, 0.005, 0.039], BLACK, weights);
  }
}
function footwear(b: ClothBuilder, id: string, skin: THREE.Color): void {
  for (const side of SIDES) {
    const foot = b.anchor(`foot_${side}`), ball = b.anchor(`ball_${side}`), box = b.rest.bounds.get(`foot_${side}`), toeBox = b.rest.bounds.get(`ball_${side}`);
    if (!box || !toeBox) throw new Error('Wardrobe needs foot bounds');
    const minZ = box.min.z - 0.005, maxZ = toeBox.max.z + 0.017, width = Math.max(box.max.x, toeBox.max.x) - Math.min(box.min.x, toeBox.min.x) + 0.015;
    const centre = new THREE.Vector3((Math.max(box.max.x, toeBox.max.x) + Math.min(box.min.x, toeBox.min.x)) / 2, 0.013, (minZ + maxZ) / 2), weights = b.rigid(`foot_${side}`);
    b.box(centre.clone().setY(0.009), [width, 0.027, maxZ - minZ], id === 'sneakers' ? WHITE : BLACK, weights);
    if (id === 'sneakers') {
      b.ball(centre.clone().setY(0.055), [width * 0.55, 0.068, (maxZ - minZ) * 0.51], BLACK, weights, 8, 4);
      b.box(new THREE.Vector3(centre.x, 0.077, ball.z - 0.014), [width * 0.63, 0.013, 0.091], WHITE.clone().multiplyScalar(0.7), weights);
      for (let j = 0; j < 3; j++) b.box(new THREE.Vector3(centre.x, 0.087 - j * 0.007, ball.z - 0.026 + j * 0.025), [width * 0.68, 0.005, 0.005], WHITE, weights);
    } else {
      // A replacement skin-coloured foot gives open footwear real toes after the original shoe triangles are hidden.
      b.ball(centre.clone().setY(0.045), [width * 0.46, 0.045, (maxZ - minZ) * 0.43], skin, weights, 8, 3);
      for (let i = 0; i < 5; i++) b.ball(new THREE.Vector3(centre.x + (i - 2) * width * 0.16, 0.037, maxZ - 0.024 - Math.abs(i - 1) * 0.006), [width * 0.091, 0.019, 0.026], skin, b.rigid(`ball_${side}`), 4, 2);
      if (id === 'slippers') b.box(new THREE.Vector3(centre.x, 0.077, ball.z - 0.021), [width * 1.02, 0.025, 0.061], BLACK, weights);
      else {
        for (const z of [ball.z - 0.02, foot.z + 0.029]) b.box(new THREE.Vector3(centre.x, 0.077, z), [width, 0.014, 0.022], colour('#795739'), weights);
        for (const sign of [-1, 1]) b.box(new THREE.Vector3(centre.x + sign * width * 0.48, 0.058, foot.z + 0.045), [0.012, 0.056, 0.12], colour('#795739'), weights);
      }
    }
  }
  b.hides.add('feet');
}
function accessory(b: ClothBuilder, id: ResolvedAvatarWearableId, read: ResolvedWardrobeLook['look']): void {
  const fabric = colour(read.outfitColor);
  switch (id) {
    case 'hijab-drape': case 'hijab-wrap': case 'turban': case 'gele-fan': case 'gele-rose': case 'legacy-cap': case 'legacy-headwrap': case 'legacy-fila': headCover(b, id, fabric); break;
    case 'neck-scarf': case 'shoulder-wrap': scarf(b, id, fabric); break;
    case 'chain-thin': case 'chain-cuban': case 'chain-pendant': case 'beads': case 'coral': case 'legacy-chain': necklace(b, id); break;
    case 'wristwatch': case 'bangles': case 'legacy-watch': case 'legacy-beads': wrist(b, id); break;
    case 'agbada': case 'kaftan': case 'abaya': case 'buba-iro': case 'school-uniform': case 'work-uniform': garment(b, id, read); break;
    case 'slippers': case 'sandals': case 'sneakers': footwear(b, id, colour(read.skin)); break;
    case 'legacy-glasses': case 'legacy-sunglasses': {
      const head = b.anchor('Head'), weights = b.rigid('Head'), y = head.y + 0.105, tint = id === 'legacy-sunglasses' ? BLACK : GOLD;
      for (const sign of [-1, 1]) {
        const centre = new THREE.Vector3(sign * 0.044, y, 0.101);
        if (id === 'legacy-sunglasses') b.box(centre, [0.072, 0.042, 0.012], BLACK, weights);
        else b.ring(centre, 0.034, 0.023, 0, 0.004, tint, weights, 8);
        b.box(new THREE.Vector3(sign * 0.087, y, 0.033), [0.006, 0.006, 0.128], tint, weights);
      }
      b.box(new THREE.Vector3(0, y, 0.104), [0.026, 0.005, 0.008], tint, weights); break;
    }
    case 'legacy-earrings': {
      const head = b.anchor('Head');
      for (const sign of [-1, 1]) b.ring(new THREE.Vector3(sign * 0.097, head.y + 0.032, 0.014), 0.017, 0.028, 0, 0.004, GOLD, b.rigid('Head'), 8); break;
    }
    case 'legacy-backpack': {
      const chest = b.anchor('spine_03'), weights = b.rigid('spine_03');
      b.box(new THREE.Vector3(0, chest.y - 0.055, -0.207), [0.24, 0.34, 0.14], BLACK, weights);
      b.box(new THREE.Vector3(0, chest.y - 0.12, -0.285), [0.2, 0.15, 0.036], fabric, weights);
      for (const sign of [-1, 1]) b.tube([new THREE.Vector3(sign * 0.093, chest.y - 0.18, 0.15), new THREE.Vector3(sign * 0.12, chest.y + 0.15, -0.03), new THREE.Vector3(sign * 0.093, chest.y - 0.18, -0.22)], [0.012, 0.014, 0.012], BLACK, () => weights, 4); break;
    }
    case 'legacy-handbag': {
      const hand = b.anchor('hand_l'), weights = b.rigid('hand_l');
      b.box(hand.clone().add(new THREE.Vector3(0.03, -0.2, 0.025)), [0.18, 0.22, 0.073], fabric, weights);
      b.ring(hand.clone().add(new THREE.Vector3(0.03, -0.045, 0.025)), 0.063, 0.06, 0, 0.008, BLACK, weights, 10); break;
    }
    default: { const exhaustive: never = id; throw new Error(`Unsupported wardrobe item ${exhaustive}`); }
  }
}

/** One generated geometry, one colour material, the original skeleton. No new textures or animation clips. */
export function buildWardrobeGeometry(rest: WardrobeRestFrame, resolved: ResolvedWardrobeLook, presentation: WardrobePresentation = 'everyday'): WardrobeGeometry {
  const b = new ClothBuilder(rest), { look, ids } = resolved;
  const full = ids.find(id => AVATAR_WEARABLE_CATALOGUE[id].slot === 'full');
  if (presentation === 'bathing') {
    // A closed opaque wrap goes over the still-clothed base. The arms, upper chest and legs keep their base clothing.
    b.item('presentation:towel', () => {
      const hip = b.anchor('pelvis'), neck = b.anchor('neck_01'), knee = b.anchor('calf_l');
      const upper = fitTorso(b, b.anchor('spine_03').y + 0.05, 0.036);
      b.loft([{ y: neck.y - 0.07, rx: upper.rx + 0.025, rz: upper.rz + 0.025, z: upper.z }, { y: hip.y + 0.04, rx: 0.235, rz: 0.185, z: -0.025 }, { y: knee.y - 0.025, rx: 0.27, rz: 0.2, z: -0.025 }], WHITE, p => b.bodyWeights(p), 14);
      b.box(new THREE.Vector3(upper.rx * 0.6, hip.y + 0.26, upper.z + upper.rz + 0.038), [0.065, 0.34, 0.018], WHITE.clone().multiplyScalar(0.9), b.rigid('spine_01'));
      b.hides.add('hips');
    });
  } else if (!full) b.item(`outfit:${look.outfit}`, () => garment(b, look.outfit, look));
  else b.item(full, () => garment(b, full, look));
  const coversHair = ids.some(id => AVATAR_WEARABLE_CATALOGUE[id].hides.includes('hair')) || ids.some(id => AVATAR_WEARABLE_CATALOGUE[id].slot === 'head');
  if (!coversHair) b.item(`hair:${look.hair}`, () => hairStyle(b, look.hair, colour(look.hair === 'gele' ? look.outfitColor : look.hairColor)));
  for (const id of ids) {
    if (id === full) continue;
    if (presentation === 'bathing' && ['full', 'neck', 'wrist', 'carry'].includes(AVATAR_WEARABLE_CATALOGUE[id].slot)) continue;
    b.item(id, () => accessory(b, id, look));
  }
  if (!ids.some(id => AVATAR_WEARABLE_CATALOGUE[id].slot === 'shoes')) b.item('shoes:legacy', () => footwear(b, look.outfit === 'chill' ? 'slippers' : 'sneakers', colour(look.skin)));
  return b.finish();
}
