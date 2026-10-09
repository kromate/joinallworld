export function verifyHairWitness(witness, expectedMode, expectedStyle) {
  if (!witness || witness.mode !== expectedMode || witness.style !== expectedStyle) throw new Error('Hair witness mode/style mismatch');
  const headTop = witness.headBounds?.max?.[1], centerY = witness.center?.[1], radiusY = witness.radii?.[1];
  if (![headTop, centerY, radiusY].every(Number.isFinite) || radiusY <= 0) throw new Error('Hair witness has invalid measured Head bounds/shape');
  const measuredOverlap = Math.max(0, Math.min(centerY + radiusY, headTop) - Math.max(centerY - radiusY, witness.headBounds.min[1]));
  if (Math.abs(measuredOverlap - witness.bboxOverlapY) > 1e-6) throw new Error('Hair overlap field is not derived from its measured Head bounds');
  return { headTop, centerY, radiusY, bboxOverlap: measuredOverlap };
}
