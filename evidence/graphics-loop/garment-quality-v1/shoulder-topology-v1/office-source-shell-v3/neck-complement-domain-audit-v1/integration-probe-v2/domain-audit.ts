import * as THREE from 'three';
import type { AvatarBodyRegion } from '/src/game/wardrobe/catalogue.ts';
import type { WardrobeGeometry, WardrobeRestFrame } from '/src/scene/wardrobe/geometry.ts';

type PlaneName = 'hem' | 'neck' | 'left-cuff' | 'right-cuff';
type Plane = Readonly<{ name: PlaneName; normal: readonly [number, number, number]; offset: number; keep: 'positive' | 'negative' }>;
type Region = AvatarBodyRegion | null;
type FaceRecord = Readonly<{
  sourceFace: number;
  vertices: readonly [number, number, number];
  cornerRegions: readonly [Region, Region, Region];
  masked: boolean;
  eligibleTorsoNeck: boolean;
  fullNeckResidualAreaM2: number;
  fullCutAreasM2: Readonly<Record<PlaneName, number>>;
  candidateCutAreasM2: Readonly<Record<PlaneName, number>>;
  independentlyExpectedDomainAreaM2: number;
  excludedReasons: readonly string[];
}>;
export interface NeckDomainInput {
  readonly fullSource: THREE.BufferGeometry;
  readonly rest: WardrobeRestFrame;
  readonly skeleton: THREE.Skeleton;
  readonly mask: Pick<WardrobeGeometry, 'hides' | 'coverage'>;
  readonly hemY: number;
  readonly neckTopY: number;
}
export interface NeckDomainAudit {
  readonly sourceTriangles: number;
  readonly independentlyReplayedMaskFaces: number;
  readonly fullNeckResidualFaceIds: readonly number[];
  readonly fullNeckResidualAreaM2: number;
  readonly fullNeckResidualAreaByFaceM2: Readonly<Record<string, number>>;
  readonly candidateEligibleFaceIds: readonly number[];
  readonly candidateEligibleAreaM2: number;
  readonly candidateEligibleAreaByFaceM2: Readonly<Record<string, number>>;
  readonly actualVsIndependentMissingFaceIds: readonly number[];
  readonly actualVsIndependentExtraFaceIds: readonly number[];
  readonly actualVsIndependentMaxAreaDeltaM2: number;
  readonly excludedFullNeckResidualFaceIds: readonly number[];
  readonly fullNeckResidualFaceRecords: readonly FaceRecord[];
  readonly domainMatchesActualCandidate: boolean;
}

const EPS = 1e-8;
const AREA_EPS_M2 = 1e-12;
const finite = Number.isFinite;
const areaTolerance = (area: number) => Math.max(2e-10, area * 2e-5);

/** Independent 3D Sutherland–Hodgman halfspace clip; does not call candidate clipSourceTriangle. */
export function clipAuditPolygon(points: readonly THREE.Vector3[], plane: Plane, keepInside: boolean, epsilon = EPS): THREE.Vector3[] {
  if (points.length < 3) return [];
  const signed = (point: THREE.Vector3) => {
    const raw = plane.normal[0] * point.x + plane.normal[1] * point.y + plane.normal[2] * point.z + plane.offset;
    const oriented = plane.keep === 'positive' ? raw : -raw;
    return keepInside ? oriented : -oriented;
  };
  const output: THREE.Vector3[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!, da = signed(a), db = signed(b);
    const aInside = da >= -epsilon, bInside = db >= -epsilon;
    if (aInside) output.push(a.clone());
    if (aInside !== bInside) {
      const denominator = da - db;
      if (Math.abs(denominator) < 1e-15) throw new Error('Independent domain clip has unstable plane intersection');
      output.push(a.clone().lerp(b, THREE.MathUtils.clamp(da / denominator, 0, 1)));
    }
  }
  return output.length >= 3 ? output : [];
}

export function auditPolygonAreaM2(points: readonly THREE.Vector3[]): number {
  if (points.length < 3) return 0;
  const origin = points[0]!, cross = new THREE.Vector3(), edgeA = new THREE.Vector3(), edgeB = new THREE.Vector3();
  let area = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    edgeA.subVectors(points[i]!, origin); edgeB.subVectors(points[i + 1]!, origin);
    area += cross.crossVectors(edgeA, edgeB).length() * 0.5;
  }
  return area;
}

export function neckDomainEligibleRegions(regions: readonly Region[]): boolean {
  return regions.length === 3 && regions.every(region => region === 'torso' || region === 'neck');
}

function regionForVertex(input: NeckDomainInput, vertex: number): Region {
  const { fullSource, rest, skeleton } = input;
  const color = fullSource.getAttribute('color'), skinIndex = fullSource.getAttribute('skinIndex'), skinWeight = fullSource.getAttribute('skinWeight');
  if (!skinIndex || !skinWeight) throw new Error('Independent neck domain requires source skin attributes');
  if (color && color.itemSize === 4 && color.getW(vertex) > 0.5) return 'hair';
  let strongest = 0;
  for (let channel = 1; channel < 4; channel++) if (skinWeight.getComponent(vertex, channel) > skinWeight.getComponent(vertex, strongest)) strongest = channel;
  const name = skeleton.bones[skinIndex.getComponent(vertex, strongest)]?.name ?? '';
  let region: Region = null;
  if (name === 'Head') region = 'head';
  else if (name === 'neck_01') region = 'neck';
  else if (name.startsWith('spine_') || name.startsWith('clavicle_')) region = 'torso';
  else if (name.startsWith('upperarm_')) region = 'upperarms';
  else if (name.startsWith('lowerarm_')) region = 'forearms';
  else if (name === 'pelvis') region = 'hips';
  else if (name.startsWith('thigh_') || name.startsWith('calf_')) region = 'legs';
  else if (name.startsWith('foot_') || name.startsWith('ball_')) region = 'feet';
  const neckLimit = (rest.bones.get('neck_01')?.point.y ?? 1.5) + 0.045;
  return region === 'head' || (region === 'neck' && (rest.points[vertex]?.y ?? Infinity) > neckLimit) ? null : region;
}

function makePlanes(input: NeckDomainInput): { fullCut: Plane[]; candidate: Plane[] } {
  const fullCut: Plane[] = [
    { name: 'hem', normal: [0, 1, 0], offset: -input.hemY, keep: 'positive' },
    { name: 'neck', normal: [0, 1, 0], offset: -input.neckTopY, keep: 'negative' },
  ];
  for (const side of ['l', 'r'] as const) {
    const shoulder = input.rest.bones.get(`upperarm_${side}`)?.point, hand = input.rest.bones.get(`hand_${side}`)?.point;
    if (!shoulder || !hand) throw new Error(`Independent domain cannot find ${side} cuff anchors`);
    const axis = hand.clone().sub(shoulder).normalize(), limit = hand.clone().sub(shoulder).dot(axis) + 0.012;
    fullCut.push({ name: side === 'l' ? 'left-cuff' : 'right-cuff', normal: axis.toArray() as [number, number, number], offset: -limit - shoulder.dot(axis), keep: 'negative' });
  }
  const neckPositive = { ...fullCut[1]!, keep: 'positive' as const };
  const hemPositive = { ...fullCut[0]! };
  return { fullCut, candidate: [neckPositive, hemPositive, fullCut[2]!, fullCut[3]!] };
}

function sequentialCut(points: readonly THREE.Vector3[], planes: readonly Plane[]) {
  let remaining = points.map(point => point.clone());
  const areaByPlane = {} as Record<PlaneName, number>;
  for (const plane of planes) {
    const outside = clipAuditPolygon(remaining, plane, false);
    areaByPlane[plane.name] = auditPolygonAreaM2(outside);
    remaining = clipAuditPolygon(remaining, plane, true);
  }
  return { areaByPlane, remainingAreaM2: auditPolygonAreaM2(remaining) };
}

/** Computes declared source domain independently; expected faces/areas never come from candidate output. */
export function auditIndependentNeckDomain(input: NeckDomainInput, candidate?: Readonly<{
  sourceFaceIds: readonly number[];
  areaBySourceFace: Readonly<Record<string, number>>;
}>): NeckDomainAudit {
  const index = input.fullSource.index, position = input.fullSource.getAttribute('position');
  if (!index || !position || index.count % 3) throw new Error('Independent neck-domain audit requires indexed source triangles');
  const planes = makePlanes(input), regionByVertex = Array.from({ length: position.count }, (_, vertex) => regionForVertex(input, vertex));
  const covered = (vertex: number, region: AvatarBodyRegion) => {
    const ranges = input.mask.coverage.filter(item => item.region === region), y = input.rest.points[vertex]?.y ?? Infinity;
    return !ranges.length || ranges.some(range => y >= range.minY && y <= range.maxY);
  };
  const outputFaceIds: number[] = [], outputAreaByFace: Record<string, number> = {};
  const fullNeckResidualFaceIds: number[] = [], fullNeckResidualAreaByFaceM2: Record<string, number> = {};
  const records: FaceRecord[] = [];
  let fullNeckResidualAreaM2 = 0, candidateEligibleAreaM2 = 0, independentlyReplayedMaskFaces = 0;
  const points = Array.from({ length: position.count }, (_, vertex) => new THREE.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(input.rest.metresFromMesh));
  const faceCount = index.count / 3;
  for (let face = 0; face < faceCount; face++) {
    const at = face * 3, ids = [index.getX(at), index.getX(at + 1), index.getX(at + 2)] as const;
    const regions = ids.map(id => regionByVertex[id]!) as [Region, Region, Region];
    const masked = regions.every((region, corner) => !!region && input.mask.hides.has(region) && covered(ids[corner]!, region));
    if (!masked) continue;
    independentlyReplayedMaskFaces++;
    const triangle = ids.map(id => points[id]!) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    const full = sequentialCut(triangle, planes.fullCut);
    // coverage.ts attributes neck residual after hem, before either cuff. This legacy cut is reported
    // separately; it is not the narrower region-qualified, four-plane complement domain.
    const fullNeckResidualArea = full.areaByPlane.neck;
    const eligibleTorsoNeck = neckDomainEligibleRegions(regions);
    const candidateCut = sequentialCut(triangle, planes.candidate);
    const expectedArea = eligibleTorsoNeck ? candidateCut.remainingAreaM2 : 0;
    if (fullNeckResidualArea > AREA_EPS_M2) {
      fullNeckResidualFaceIds.push(face);
      fullNeckResidualAreaByFaceM2[String(face)] = fullNeckResidualArea;
      fullNeckResidualAreaM2 += fullNeckResidualArea;
      const reasons: string[] = [];
      if (!eligibleTorsoNeck) reasons.push('not-all-corners-torso-or-neck');
      for (const plane of planes.candidate) if (candidateCut.areaByPlane[plane.name] > AREA_EPS_M2) reasons.push(`candidate-cut:${plane.name}`);
      if (expectedArea <= AREA_EPS_M2 && eligibleTorsoNeck && !reasons.length) reasons.push('no-positive-area-after-candidate-cuts');
      if (expectedArea > AREA_EPS_M2) {
        outputFaceIds.push(face); outputAreaByFace[String(face)] = expectedArea; candidateEligibleAreaM2 += expectedArea;
      }
      records.push({ sourceFace: face, vertices: ids, cornerRegions: regions, masked, eligibleTorsoNeck,
        fullNeckResidualAreaM2: fullNeckResidualArea,
        fullCutAreasM2: full.areaByPlane,
        candidateCutAreasM2: candidateCut.areaByPlane,
        independentlyExpectedDomainAreaM2: expectedArea,
        excludedReasons: reasons });
    }
  }
  const expected = new Set(outputFaceIds), actual = candidate ? new Set(candidate.sourceFaceIds) : new Set<number>();
  const actualVsIndependentMissingFaceIds = candidate ? [...expected].filter(face => !actual.has(face)).sort((a, b) => a - b) : [];
  const actualVsIndependentExtraFaceIds = candidate ? [...actual].filter(face => !expected.has(face)).sort((a, b) => a - b) : [];
  let actualVsIndependentMaxAreaDeltaM2 = 0;
  if (candidate) for (const face of expected) actualVsIndependentMaxAreaDeltaM2 = Math.max(actualVsIndependentMaxAreaDeltaM2,
    Math.abs(outputAreaByFace[String(face)]! - (candidate.areaBySourceFace[String(face)] ?? 0)));
  const domainMatchesActualCandidate = !!candidate && actualVsIndependentMissingFaceIds.length === 0
    && actualVsIndependentExtraFaceIds.length === 0
    && [...expected].every(face => Math.abs(outputAreaByFace[String(face)]! - (candidate.areaBySourceFace[String(face)] ?? 0)) <= areaTolerance(outputAreaByFace[String(face)]!));
  const excludedFullNeckResidualFaceIds = fullNeckResidualFaceIds.filter(face => !expected.has(face));
  return {
    sourceTriangles: faceCount, independentlyReplayedMaskFaces,
    fullNeckResidualFaceIds, fullNeckResidualAreaM2, fullNeckResidualAreaByFaceM2,
    candidateEligibleFaceIds: outputFaceIds, candidateEligibleAreaM2, candidateEligibleAreaByFaceM2: outputAreaByFace,
    actualVsIndependentMissingFaceIds, actualVsIndependentExtraFaceIds, actualVsIndependentMaxAreaDeltaM2,
    excludedFullNeckResidualFaceIds, fullNeckResidualFaceRecords: records, domainMatchesActualCandidate,
  };
}

export function assertIndependentNeckDomainMatchesCandidate(audit: NeckDomainAudit): void {
  if (!audit.domainMatchesActualCandidate) {
    const excluded = new Set(audit.excludedFullNeckResidualFaceIds);
    const excludedRecords = audit.fullNeckResidualFaceRecords.filter(record => excluded.has(record.sourceFace));
    throw new Error(`Candidate differs from independently clipped torso/neck domain: ${JSON.stringify({ expected: audit.candidateEligibleFaceIds.length, missing: audit.actualVsIndependentMissingFaceIds, extra: audit.actualVsIndependentExtraFaceIds, maxAreaDeltaM2: audit.actualVsIndependentMaxAreaDeltaM2, fullNeckResidualFaces: audit.fullNeckResidualFaceIds.length, excludedResidualFaceRecords: excludedRecords })}`);
  }
}
