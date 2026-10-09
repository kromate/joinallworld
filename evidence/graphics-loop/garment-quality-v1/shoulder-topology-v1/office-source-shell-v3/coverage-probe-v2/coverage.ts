import * as THREE from 'three';
import type { AvatarBodyRegion } from '/src/game/wardrobe/catalogue.ts';
import type { WardrobeGeometry, WardrobeRestFrame } from '/src/scene/wardrobe/geometry.ts';

export interface CoverageFragmentInput {
  readonly fullSource: THREE.BufferGeometry;
  readonly displayedBody: THREE.BufferGeometry;
  readonly shell: THREE.BufferGeometry;
  /** One original full-source triangle ordinal per emitted shell triangle. */
  readonly shellSourceFaceIds: readonly number[];
  readonly rest: WardrobeRestFrame;
  readonly skeleton: THREE.Skeleton;
  readonly maskSpec: Pick<WardrobeGeometry, 'hides' | 'coverage'>;
  readonly hemY: number;
  readonly neckTopY: number;
}

export interface SourceMaskCoverageReport {
  readonly fullSourceTriangles: number;
  readonly displayedTriangles: number;
  readonly maskedTriangles: number;
  readonly maskReplayMatchesDisplayed: boolean;
  readonly maskedResidualFaces: number;
  readonly maskedResidualAreaSquareMetres: number;
  readonly maskedResidualFaceIds: readonly number[];
  readonly maskedResidualByCut: Readonly<Record<'neck' | 'hem' | 'left-cuff' | 'right-cuff', { readonly faces: number; readonly areaSquareMetres: number; readonly sourceFaceIds: readonly number[] }>>;
  readonly shellOverlapOnRetainedBodyAreaSquareMetres: number;
  readonly fragmentCoverageMaximumOverrun: number;
  readonly fragmentPairwiseMaximumOverlapRatio: number;
  readonly fragmentPairwiseMaximumOverlapFace: number | null;
  readonly fragmentMaximumOutsidePlaneDistanceMetres: number;
  readonly fragmentMaximumSourceDomainViolation: number;
  readonly clippedAreaReplayMaximumDelta: number;
  readonly residualPlaneClosureMaximumDelta: number;
  readonly largestMaskedResidualFaces: readonly {
    readonly sourceFace: number;
    readonly vertices: readonly [number, number, number];
    readonly regions: readonly (AvatarBodyRegion | null)[];
    readonly yRangeMetres: readonly [number, number];
    readonly faceAreaSquareMetres: number;
    readonly shellCoverageFraction: number;
    readonly residualAreaSquareMetres: number;
  }[];
}

type Plane = Readonly<{ name: 'neck' | 'hem' | 'left-cuff' | 'right-cuff'; normal: readonly [number, number, number]; offset: number; keep: 'positive' | 'negative' }>;
type Bary = readonly [number, number, number];
export type BarycentricFragment = readonly [Bary, Bary, Bary];
export interface FragmentDisjointnessReport { readonly maximumPairIntersectionRatio: number; readonly pair: readonly [number, number] | null }
type CoverageFace = { face: number; vertices: [number, number, number]; area: number; fraction: number; residual: number; regions: (AvatarBodyRegion | null)[]; yRange: [number, number] };
const EPS = 1e-8;
export const PAIRWISE_FRAGMENT_AREA_TOLERANCE = 2e-10;
export const FRAGMENT_OUTSIDE_PLANE_TOLERANCE_METRES = 2e-5;
const finite = Number.isFinite;
const cross2 = (a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function polygonArea(poly: readonly Bary[]): number {
  if (poly.length < 3) return 0;
  let twice = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    twice += a[1] * b[2] - b[1] * a[2];
  }
  return Math.abs(twice);
}
function polygonArea2(poly: readonly (readonly [number, number])[]): number {
  if (poly.length < 3) return 0;
  let twice = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twice);
}
function triangleIntersectionRatio(a: BarycentricFragment, b: BarycentricFragment): number {
  const project = (p: Bary): [number, number] => [p[1], p[2]];
  let polygon = a.map(project);
  const clip = b.map(project);
  const orientation = Math.sign(cross2(clip[0]!, clip[1]!, clip[2]!));
  if (!orientation) return 0;
  for (let edge = 0; edge < 3 && polygon.length; edge++) {
    const p = clip[edge]!, q = clip[(edge + 1) % 3]!;
    const signed = (v: readonly [number, number]) => orientation * ((q[0] - p[0]) * (v[1] - p[1]) - (q[1] - p[1]) * (v[0] - p[0]));
    const out: [number, number][] = [];
    for (let i = 0; i < polygon.length; i++) {
      const x = polygon[i]!, y = polygon[(i + 1) % polygon.length]!;
      const dx = signed(x), dy = signed(y), xInside = dx >= -1e-13, yInside = dy >= -1e-13;
      if (xInside) out.push(x);
      if (xInside !== yInside) {
        const denominator = dx - dy;
        if (Math.abs(denominator) > 1e-20) {
          const t = dx / denominator;
          out.push([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t]);
        }
      }
    }
    polygon = out;
  }
  // Twice the projected area is the area ratio for the unit barycentric source triangle.
  return polygonArea2(polygon);
}
export function auditFragmentDisjointness(fragments: readonly BarycentricFragment[]): FragmentDisjointnessReport {
  let maximumPairIntersectionRatio = 0, pair: [number, number] | null = null;
  for (let i = 0; i < fragments.length; i++) for (let j = i + 1; j < fragments.length; j++) {
    const overlap = triangleIntersectionRatio(fragments[i]!, fragments[j]!);
    if (overlap > maximumPairIntersectionRatio) { maximumPairIntersectionRatio = overlap; pair = [i, j]; }
  }
  return { maximumPairIntersectionRatio, pair };
}
function planeDistance(bary: Bary, points: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3], plane: Plane): number {
  const x = points[0].x * bary[0] + points[1].x * bary[1] + points[2].x * bary[2];
  const y = points[0].y * bary[0] + points[1].y * bary[1] + points[2].y * bary[2];
  const z = points[0].z * bary[0] + points[1].z * bary[1] + points[2].z * bary[2];
  const raw = plane.normal[0] * x + plane.normal[1] * y + plane.normal[2] * z + plane.offset;
  return plane.keep === 'positive' ? raw : -raw;
}
function clipDomain(poly: readonly Bary[], points: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3], plane: Plane, inside: boolean): Bary[] {
  if (poly.length < 3) return [];
  const out: Bary[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const da = planeDistance(a, points, plane), db = planeDistance(b, points, plane);
    const ia = inside ? da >= -EPS : da < -EPS, ib = inside ? db >= -EPS : db < -EPS;
    if (ia) out.push(a);
    if (ia !== ib) {
      const den = da - db;
      if (Math.abs(den) < 1e-15) throw new Error('Unstable source-domain plane intersection');
      const t = Math.max(0, Math.min(1, da / den));
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}
function areaInMetres(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  return b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5;
}
function barycentric(point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): { bary: Bary; planeDistance: number } {
  const v0 = b.clone().sub(a), v1 = c.clone().sub(a), v2 = point.clone().sub(a);
  const d00 = v0.dot(v0), d01 = v0.dot(v1), d11 = v1.dot(v1), d20 = v2.dot(v0), d21 = v2.dot(v1), den = d00 * d11 - d01 * d01;
  if (!(finite(den) && den > 1e-20)) throw new Error('Degenerate source face while mapping clipped shell triangle');
  const v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den;
  const u = 1 - v - w, projected = a.clone().addScaledVector(v0, v).addScaledVector(v1, w);
  return { bary: [u, v, w], planeDistance: point.distanceTo(projected) };
}
function boneRegion(name: string): AvatarBodyRegion | null {
  if (name === 'Head') return 'head';
  if (name === 'neck_01') return 'neck';
  if (name.startsWith('spine_') || name.startsWith('clavicle_')) return 'torso';
  if (name.startsWith('upperarm_')) return 'upperarms';
  if (name.startsWith('lowerarm_')) return 'forearms';
  if (name === 'pelvis') return 'hips';
  if (name.startsWith('thigh_') || name.startsWith('calf_')) return 'legs';
  if (name.startsWith('foot_') || name.startsWith('ball_')) return 'feet';
  return null;
}
function sourceRegion(input: CoverageFragmentInput, vertex: number): AvatarBodyRegion | null {
  const color = input.fullSource.getAttribute('color'), skinIndex = input.fullSource.getAttribute('skinIndex'), skinWeight = input.fullSource.getAttribute('skinWeight');
  if (!skinIndex || !skinWeight) throw new Error('Full source lacks skinning attributes');
  if (color && color.itemSize === 4 && color.getW(vertex) > 0.5) return 'hair';
  let strongest = 0;
  for (let channel = 1; channel < 4; channel++) if (skinWeight.getComponent(vertex, channel) > skinWeight.getComponent(vertex, strongest)) strongest = channel;
  const name = input.skeleton.bones[skinIndex.getComponent(vertex, strongest)]?.name ?? '';
  const region = boneRegion(name), neckY = input.rest.bones.get('neck_01')?.point.y ?? 1.5;
  return region === 'head' || region === 'neck' && (input.rest.points[vertex]?.y ?? Infinity) > neckY + 0.045 ? null : region;
}
function officePlanes(input: CoverageFragmentInput): Plane[] {
  const planes: Plane[] = [
    { name: 'hem', normal: [0, 1, 0], offset: -input.hemY, keep: 'positive' },
    { name: 'neck', normal: [0, 1, 0], offset: -input.neckTopY, keep: 'negative' },
  ];
  for (const side of ['l', 'r'] as const) {
    const shoulder = input.rest.bones.get(`upperarm_${side}`)?.point, hand = input.rest.bones.get(`hand_${side}`)?.point;
    if (!shoulder || !hand) throw new Error(`Missing ${side} cuff anchors`);
    const axis = hand.clone().sub(shoulder).normalize(), limit = hand.clone().sub(shoulder).dot(axis) + 0.012;
    planes.push({ name: side === 'l' ? 'left-cuff' : 'right-cuff', normal: axis.toArray() as [number, number, number], offset: -limit - shoulder.dot(axis), keep: 'negative' });
  }
  return planes;
}

/**
 * Replays production's whole-triangle mask against the real full source, then measures the emitted
 * source-shell fragments in each original face's barycentric domain. No material/pixel inference.
 */
export function auditSourceMaskCoverage(input: CoverageFragmentInput): SourceMaskCoverageReport {
  const sourceIndex = input.fullSource.index, visibleIndex = input.displayedBody.index, shellIndex = input.shell.index;
  const sourcePosition = input.fullSource.getAttribute('position'), shellPosition = input.shell.getAttribute('position');
  if (!sourceIndex || !visibleIndex || !shellIndex || !sourcePosition || !shellPosition) throw new Error('Coverage audit requires indexed source, displayed body and shell meshes');
  if (sourceIndex.count % 3 || shellIndex.count % 3 || input.shellSourceFaceIds.length !== shellIndex.count / 3) throw new Error('Source/shell face mapping is not triangle-aligned');
  const displayCount = input.displayedBody.drawRange.count === Infinity ? visibleIndex.count : input.displayedBody.drawRange.count;
  if (input.displayedBody.drawRange.start !== 0 || !Number.isInteger(displayCount) || displayCount < 0 || displayCount > visibleIndex.count || displayCount % 3) throw new Error('Displayed masked body has unsupported draw range');
  const sourceFaces = sourceIndex.count / 3, retainedActual: number[] = [], retainedExpected: number[] = [];
  const region = Array.from({ length: sourcePosition.count }, (_, vertex) => sourceRegion(input, vertex));
  const covered = (vertex: number, area: AvatarBodyRegion) => {
    const ranges = input.maskSpec.coverage.filter(item => item.region === area), y = input.rest.points[vertex]?.y ?? Infinity;
    return !ranges.length || ranges.some(range => y >= range.minY && y <= range.maxY);
  };
  let displayAt = 0;
  for (let face = 0; face < sourceFaces; face++) {
    const at = face * 3, ids = [sourceIndex.getX(at), sourceIndex.getX(at + 1), sourceIndex.getX(at + 2)] as [number, number, number];
    const [ra, rb, rc] = ids.map(id => region[id]) as [AvatarBodyRegion | null, AvatarBodyRegion | null, AvatarBodyRegion | null];
    const expectedHidden = !!ra && !!rb && !!rc && input.maskSpec.hides.has(ra) && input.maskSpec.hides.has(rb) && input.maskSpec.hides.has(rc)
      && covered(ids[0], ra) && covered(ids[1], rb) && covered(ids[2], rc);
    if (!expectedHidden) retainedExpected.push(face);
    if (displayAt < displayCount && visibleIndex.getX(displayAt) === ids[0] && visibleIndex.getX(displayAt + 1) === ids[1] && visibleIndex.getX(displayAt + 2) === ids[2]) {
      retainedActual.push(face); displayAt += 3;
    }
  }
  if (displayAt !== displayCount) throw new Error(`Displayed body index is not the expected ordered subsequence of full source: matched ${displayAt / 3}/${displayCount / 3}`);
  const actualSet = new Set(retainedActual), expectedSet = new Set(retainedExpected);
  const maskReplayMatchesDisplayed = actualSet.size === expectedSet.size && [...expectedSet].every(face => actualSet.has(face));
  const sourceToMetres = input.rest.metresFromMesh, points = new Array<THREE.Vector3>(sourcePosition.count);
  for (let vertex = 0; vertex < sourcePosition.count; vertex++) points[vertex] = new THREE.Vector3().fromBufferAttribute(sourcePosition, vertex).applyMatrix4(sourceToMetres);
  const planes = officePlanes(input), clipAreaByFace = new Map<number, number>(), fragmentsByFace = new Map<number, BarycentricFragment[]>();
  const maxPlaneDistance = 2e-5;
  let fragmentCoverageMaximumOverrun = 0, fragmentMaximumOutsidePlaneDistanceMetres = 0, fragmentMaximumSourceDomainViolation = 0;
  for (let tri = 0; tri < input.shellSourceFaceIds.length; tri++) {
    const face = input.shellSourceFaceIds[tri]!;
    if (!Number.isInteger(face) || face < 0 || face >= sourceFaces) throw new Error(`Shell references invalid full-source face ${face}`);
    const baseAt = face * 3, sourceIds = [sourceIndex.getX(baseAt), sourceIndex.getX(baseAt + 1), sourceIndex.getX(baseAt + 2)] as const;
    const a = points[sourceIds[0]]!, b = points[sourceIds[1]]!, c = points[sourceIds[2]]!;
    const mapped = [0, 1, 2].map(corner => {
      const shellVertex = shellIndex.getX(tri * 3 + corner), p = new THREE.Vector3().fromBufferAttribute(shellPosition, shellVertex).applyMatrix4(sourceToMetres);
      const result = barycentric(p, a, b, c);
      const domainViolation = Math.max(0, ...result.bary.map(value => Math.max(-value, value - 1)));
      fragmentMaximumSourceDomainViolation = Math.max(fragmentMaximumSourceDomainViolation, domainViolation);
      if (result.planeDistance > maxPlaneDistance || domainViolation > 2e-5) throw new Error(`Shell triangle ${tri} does not map inside source face ${face}: ${JSON.stringify({ ...result, domainViolation })}`);
      for (const plane of planes) {
        const outsideDistance = Math.max(0, -planeDistance(result.bary, [a, b, c], plane));
        fragmentMaximumOutsidePlaneDistanceMetres = Math.max(fragmentMaximumOutsidePlaneDistanceMetres, outsideDistance);
        if (outsideDistance > FRAGMENT_OUTSIDE_PLANE_TOLERANCE_METRES) throw new Error(`Shell triangle ${tri} source face ${face} lies ${outsideDistance}m outside ${plane.name} clipping plane`);
      }
      return result.bary;
    }) as [Bary, Bary, Bary];
    const ratio = Math.abs(cross2([mapped[0][1], mapped[0][2]], [mapped[1][1], mapped[1][2]], [mapped[2][1], mapped[2][2]]));
    if (!finite(ratio) || ratio <= 1e-14) throw new Error(`Degenerate shell fragment at triangle ${tri}`);
    clipAreaByFace.set(face, (clipAreaByFace.get(face) ?? 0) + ratio);
    const perFace = fragmentsByFace.get(face) ?? [];
    perFace.push(mapped);
    fragmentsByFace.set(face, perFace);
  }
  let fragmentPairwiseMaximumOverlapRatio = 0, fragmentPairwiseMaximumOverlapFace: number | null = null;
  let residualArea = 0, retainedOverlapArea = 0, maskedResidualFaces = 0, clippedAreaReplayMaximumDelta = 0;
  let residualPlaneClosureMaximumDelta = 0;
  const byCut = Object.fromEntries(planes.map(plane => [plane.name, { faces: 0, areaSquareMetres: 0, sourceFaceIds: [] as number[] }])) as Record<Plane['name'], { faces: number; areaSquareMetres: number; sourceFaceIds: number[] }>;
  const faceReports: CoverageFace[] = [];
  const emptyBary: Bary[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let face = 0; face < sourceFaces; face++) {
    const at = face * 3, ids = [sourceIndex.getX(at), sourceIndex.getX(at + 1), sourceIndex.getX(at + 2)] as [number, number, number];
    const a = points[ids[0]]!, b = points[ids[1]]!, c = points[ids[2]]!, faceArea = areaInMetres(a, b, c);
    if (!(faceArea > 0 && finite(faceArea))) throw new Error(`Source face ${face} has invalid area`);
    let remaining: Bary[] = emptyBary;
    const residualRatios: Record<Plane['name'], number> = { neck: 0, hem: 0, 'left-cuff': 0, 'right-cuff': 0 };
    for (const plane of planes) {
      const outside = clipDomain(remaining, [a, b, c], plane, false);
      residualRatios[plane.name] += polygonArea(outside);
      remaining = clipDomain(remaining, [a, b, c], plane, true);
    }
    const predictedCoverage = polygonArea(remaining), observedCoverage = clipAreaByFace.get(face) ?? 0;
    const disjointness = auditFragmentDisjointness(fragmentsByFace.get(face) ?? []);
    if (disjointness.maximumPairIntersectionRatio > fragmentPairwiseMaximumOverlapRatio) {
      fragmentPairwiseMaximumOverlapRatio = disjointness.maximumPairIntersectionRatio;
      fragmentPairwiseMaximumOverlapFace = face;
    }
    if (disjointness.maximumPairIntersectionRatio > PAIRWISE_FRAGMENT_AREA_TOLERANCE) throw new Error(`Shell fragments overlap on source face ${face}: pair intersection ratio=${disjointness.maximumPairIntersectionRatio}, pair=${disjointness.pair}`);
    const delta = Math.abs(predictedCoverage - observedCoverage);
    const planeClosureDelta = Math.abs(Object.values(residualRatios).reduce((sum, ratio) => sum + ratio, predictedCoverage) - 1);
    residualPlaneClosureMaximumDelta = Math.max(residualPlaneClosureMaximumDelta, planeClosureDelta);
    clippedAreaReplayMaximumDelta = Math.max(clippedAreaReplayMaximumDelta, delta);
    const overrun = Math.max(0, observedCoverage - 1); fragmentCoverageMaximumOverrun = Math.max(fragmentCoverageMaximumOverrun, overrun);
    if (observedCoverage > 1 + 2e-5) throw new Error(`Shell fragments exceed source face area ${face}: coverage ${observedCoverage}`);
    if (delta > 2e-5) throw new Error(`Shell fragments disagree with exact clipping on source face ${face}: predicted=${predictedCoverage}, observed=${observedCoverage}`);
    if (planeClosureDelta > 2e-5) throw new Error(`Clipping-cut residual attribution does not close on source face ${face}: delta=${planeClosureDelta}`);
    const residualFraction = Math.max(0, 1 - observedCoverage), isMasked = !actualSet.has(face), regions = ids.map(id => region[id]);
    if (isMasked && residualFraction > 1e-7) {
      maskedResidualFaces++;
      residualArea += faceArea * residualFraction;
      for (const plane of planes) {
        const amount = Math.max(0, residualRatios[plane.name]) * faceArea;
        if (amount > 1e-12) { byCut[plane.name].faces++; byCut[plane.name].areaSquareMetres += amount; byCut[plane.name].sourceFaceIds.push(face); }
      }
      const ys = ids.map(id => points[id]!.y);
      faceReports.push({ face, vertices: ids, area: faceArea, fraction: observedCoverage, residual: faceArea * residualFraction, regions, yRange: [Math.min(...ys), Math.max(...ys)] });
    } else if (!isMasked) retainedOverlapArea += faceArea * observedCoverage;
  }
  if (clippedAreaReplayMaximumDelta > 2e-5) throw new Error(`Barycentric shell coverage replay drift ${clippedAreaReplayMaximumDelta}`);
  faceReports.sort((a, b) => b.residual - a.residual);
  const largestMaskedResidualFaces = faceReports.slice(0, 24).map(face => ({
    sourceFace: face.face, vertices: face.vertices, regions: face.regions,
    yRangeMetres: face.yRange, faceAreaSquareMetres: face.area,
    shellCoverageFraction: face.fraction, residualAreaSquareMetres: face.residual,
  }));
  return {
    fullSourceTriangles: sourceFaces, displayedTriangles: displayCount / 3,
    maskedTriangles: sourceFaces - actualSet.size, maskReplayMatchesDisplayed,
    maskedResidualFaces, maskedResidualAreaSquareMetres: residualArea,
    maskedResidualFaceIds: faceReports.map(face => face.face).sort((a, b) => a - b),
    maskedResidualByCut: Object.fromEntries(Object.entries(byCut).map(([name, value]) => [name, { ...value, areaSquareMetres: value.areaSquareMetres }])) as SourceMaskCoverageReport['maskedResidualByCut'],
    shellOverlapOnRetainedBodyAreaSquareMetres: retainedOverlapArea,
    fragmentCoverageMaximumOverrun, fragmentPairwiseMaximumOverlapRatio, fragmentPairwiseMaximumOverlapFace,
    fragmentMaximumOutsidePlaneDistanceMetres, fragmentMaximumSourceDomainViolation,
    clippedAreaReplayMaximumDelta, residualPlaneClosureMaximumDelta, largestMaskedResidualFaces,
  };
}
