# Environment whole-slice fixture v5

This is a separate, ignored review-fixture copy of v4. It leaves all v4 files and production/runtime source untouched. The static fixture input is still the real venue host and current production city-content/scene loaders; the candidate branch retains v4's isolated batch color experiment.

The v5 change repairs the fixture lifecycle controls. **Dispose permanently** now invalidates pending mounts, cancels readiness/motion work, releases held input, disposes the current host, clears its canvas, and leaves only **Dispose and rebuild** enabled. Rebuild creates a fresh host from the same current place/time/variant/crowd controls and the viewer's fixed deterministic player, crowd, home items, street response, and time. It uses the production host's normal recenter path. Stale asynchronous mounts remain generation-guarded and are disposed before publication.

Diagnostics now include an explicit `reviewScope`: Lagos venue scenes (home, neighbourhood, office, market, beach) are covered; the city-map renderer and Atlantic/open-water map scene are not. The record describes this as a synthetic fixture host, not a full application journey. The visible hint repeats the scope so snapshots cannot be mistaken for a whole-map review.

No build, test, server, or browser run was performed for v5. The fixture is prepared for source review only; rebuild/disposal behavior and visual state restoration remain unverified until a later bounded review.
