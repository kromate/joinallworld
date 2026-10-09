# Isolated source-domain A/B fixture

This parallel fixture uses the unchanged source-corner office chart and neck-complement implementation copied from the frozen v1 snapshot. Its only semantic change is an independent source-domain calculation and reporting path.

For each actual source body it preserves the historical `maskedResidualByCut.neck` report (hem clip first, neck-cut residual next, before cuffs and without a torso/neck-only filter). It separately calculates the complement's declared domain from full-source triangles that the production mask hides, all three strongest-bone corner regions being torso/neck, and positive remaining area after neck, hem, and both cuff planes. The independent calculator uses its own polygon clipping and area routine, not `clipSourceTriangle` or the emitted complement triangles. It verifies the legacy cut against the existing coverage report, then checks source-face IDs and areas per face against the independently computed declared domain.

The captured report contains every legacy neck-residual face with corner regions, full-cut per-plane areas, candidate-cut per-plane areas, independently expected domain area, and explicit exclusions. Snapshot APIs expose the complete report once per matched body; render status includes compact counts. If candidate output differs from the independent domain, the fixture fails closed and includes missing/extra IDs plus excluded-face details.

A passing result would establish only consistency with the declared torso/neck domain and enable matched source/candidate pixels for root review. It does not prove excluded shoulder/arm faces are visually irrelevant, that the whole neckline aperture is closed, or that the complement is aesthetically accepted.
