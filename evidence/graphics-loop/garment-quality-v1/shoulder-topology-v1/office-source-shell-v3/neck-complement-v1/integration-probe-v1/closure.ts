export interface NeckResidualClosureInput {
  readonly residualSourceFaceIds: readonly number[];
  readonly residualAreaSquareMetres: number;
  readonly residualAreaBySourceFace: Readonly<Record<string, number>>;
  /** One source face id per emitted complement triangle; ids may repeat after clipping. */
  readonly complementTriangleSourceFaceIds: readonly number[];
  readonly complementAreaSquareMetres: number;
  readonly complementAreaBySourceFace: Readonly<Record<string, number>>;
}

export const NECK_CLOSURE_ABSOLUTE_TOLERANCE_M2 = 2e-7;
export const NECK_CLOSURE_RELATIVE_TOLERANCE = 2e-5;

/** Fails closed unless the complement covers precisely the measured residual source-face set and area. */
export function assertNeckResidualClosure(input: NeckResidualClosureInput): void {
  const { residualSourceFaceIds, residualAreaSquareMetres, residualAreaBySourceFace, complementTriangleSourceFaceIds, complementAreaSquareMetres, complementAreaBySourceFace } = input;
  if (!Number.isFinite(residualAreaSquareMetres) || residualAreaSquareMetres < 0
    || !Number.isFinite(complementAreaSquareMetres) || complementAreaSquareMetres < 0) throw new Error('Neck residual areas must be finite nonnegative square metres');
  const expected = new Set<number>();
  for (const face of residualSourceFaceIds) {
    if (!Number.isInteger(face) || face < 0) throw new Error(`Invalid residual source face id ${face}`);
    expected.add(face);
  }
  const actual = new Set<number>();
  for (const face of complementTriangleSourceFaceIds) {
    if (!Number.isInteger(face) || face < 0) throw new Error(`Invalid complement source face id ${face}`);
    actual.add(face);
  }
  if (expected.size !== actual.size || [...expected].some(face => !actual.has(face))) {
    throw new Error(`Neck complement face set differs from measured residual: expected=${expected.size}, actual=${actual.size}`);
  }
  const tolerance = Math.max(NECK_CLOSURE_ABSOLUTE_TOLERANCE_M2, residualAreaSquareMetres * NECK_CLOSURE_RELATIVE_TOLERANCE);
  if (Math.abs(complementAreaSquareMetres - residualAreaSquareMetres) > tolerance) {
    throw new Error(`Neck complement area does not close measured residual: complement=${complementAreaSquareMetres}, residual=${residualAreaSquareMetres}, tolerance=${tolerance}`);
  }
  const residualFaces = Object.keys(residualAreaBySourceFace).sort(), complementFaces = Object.keys(complementAreaBySourceFace).sort();
  if (residualFaces.length !== expected.size || residualFaces.some(face => !expected.has(Number(face)))) throw new Error('Measured per-face area map does not match residual source-face set');
  if (complementFaces.length !== actual.size || complementFaces.some(face => !actual.has(Number(face)))) throw new Error('Complement per-face area map does not match emitted source-face set');
  if (residualFaces.length !== complementFaces.length || residualFaces.some((face, index) => face !== complementFaces[index])) throw new Error('Neck complement per-face area keys do not match measured residual');
  for (const face of residualFaces) {
    const expectedFaceArea = residualAreaBySourceFace[face]!, actualFaceArea = complementAreaBySourceFace[face]!;
    if (!Number.isFinite(expectedFaceArea) || expectedFaceArea < 0 || !Number.isFinite(actualFaceArea) || actualFaceArea < 0) throw new Error(`Invalid per-face neck area for source face ${face}`);
    const faceTolerance = Math.max(1e-10, expectedFaceArea * NECK_CLOSURE_RELATIVE_TOLERANCE);
    if (Math.abs(actualFaceArea - expectedFaceArea) > faceTolerance) throw new Error(`Neck complement does not close source face ${face}: complement=${actualFaceArea}, residual=${expectedFaceArea}, tolerance=${faceTolerance}`);
  }
}
