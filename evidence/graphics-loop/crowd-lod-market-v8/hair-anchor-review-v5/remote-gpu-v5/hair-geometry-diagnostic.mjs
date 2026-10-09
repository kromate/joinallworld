const stable = value => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

function hairMap(record, itemId) {
  return record?.recipeMetrics?.wardrobe?.find(item => item.id === itemId) ?? null;
}

/** Keep the strict exact geometry guard, while exposing each operand before it can reject a pair. */
export function diagnoseGeometryToggle(sourceRecord, compactRecord, hairId) {
  const source = sourceRecord?.actualHairGeometryWitness;
  const compact = compactRecord?.actualHairGeometryWitness;
  const sourceMap = hairMap(sourceRecord, hairId);
  const compactMap = hairMap(compactRecord, hairId);
  const checks = {
    normalizedLook: stable(sourceRecord?.normalizedLook) === stable(compactRecord?.normalizedLook),
    placementRadii: stable(source?.placement?.radii) === stable(compact?.placement?.radii),
    hairAttributes: stable(source?.hairAttributeSignatures) === stable(compact?.hairAttributeSignatures),
    generatedHairTriangles: source?.generatedHairTriangles === compact?.generatedHairTriangles,
    generatedHairVertices: source?.generatedHairVertices === compact?.generatedHairVertices,
    generatedHairBounds: stable(source?.generatedHairVertexBoundsWorldSceneUnits) === stable(compact?.generatedHairVertexBoundsWorldSceneUnits),
    sourceRangeMatchesRecipe: Number.isInteger(source?.generatedHairTriangles)
      && source?.generatedHairTriangles === sourceMap?.sourceTriangles,
    compactRangeMatchesRecipe: Number.isInteger(compact?.generatedHairTriangles)
      && compact?.generatedHairTriangles === compactMap?.outputTriangles,
  };
  return {
    hairId,
    checks,
    exactGuardPassed: checks.normalizedLook && checks.placementRadii && checks.hairAttributes && checks.generatedHairTriangles,
    recipeProvenancePassed: checks.sourceRangeMatchesRecipe && checks.compactRangeMatchesRecipe,
    source: { witness: source, recipe: sourceMap },
    compact: { witness: compact, recipe: compactMap },
    interpretation: 'No equality is waived: this record separates exact-guard failure from whether each observed range agrees with its own source/compact recipe target.',
  };
}

export function compareReviewCaptures(source, compact, hairId) {
  return diagnoseGeometryToggle(
    { ...source.metrics, actualHairGeometryWitness: source.metrics.actualHairGeometryWitness },
    { ...compact.metrics, actualHairGeometryWitness: compact.metrics.actualHairGeometryWitness },
    hairId,
  );
}
