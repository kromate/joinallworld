# Closed-sedan swept geometry batch

This is a bounded prerequisite for the first connected mapped driving/delivery journey, not acceptance of that journey. Existing driving.ts checks road coverage of the centre path; it does not bound the complete street-detail sedan during a turn. The published descriptor pins half-width1.302m, half-length2.271m and990 triangles/8 draw calls. A previously proposed1.2m envelope is insufficient.

Luna driving exclusively implements new mapped-sweep.ts and mapped-sweep.test.ts. Sol integrates the files, workflow coverage and evidence; Luna Goalmatic independently reviews without writing. World/graphics shared paths, uploader, saves and live vehicle allocation remain untouched.

Acceptance criteria:

- Copy finite bounded coordinates from own data descriptors; do not invoke point getters. Refuse malformed/future descriptors, sparse/oversized arrays, non-convex support and crossing building footprints.
- Check every sedan corner against every convex support half-plane for the complete linear-centre/shortest-heading interpolation. Evaluate endpoints and analytical derivative roots; no spatial or angular samples may stand in for coverage.
- Reject a rotation protrusion and a combined translation/rotation protrusion despite fitting endpoints. Cover heading wrap, both polygon windings and the0.05m edge margin.
- Conservatively check the complete centre segment against simple building footprints using the sedan's circumscribed circle plus margin. An obstacle between clear endpoints must refuse; valid concave buildings remain supported.
- Bound polygons to64 points, buildings to64, coordinates to100000m and input headings to1000000rad. Keep results deterministic and keep canBoard/routeAuthorized false for every result.
- Execute the focused fixtures and compiler checks on an exact published candidate. Any later runtime consumer must also pass unchanged build/download budgets and full release checks.

Sol review found and repaired a validated-point reread, an incorrect concave-building rejection fixture, and a mixed-motion fixture whose initial polygon was smaller than the declared margin. Exact695b22c3 remote UI checks passed438/438, including the six swept-footprint cases; overall CI failed on the separate teaching loader fence. That result predates a further array-length proxy repair and its two hostile-array witnesses. The repaired bounds require new execution evidence.

The next handed-off server pair, district-sweep.ts/test.ts, binds the helper to current/retained manifest and exact pinned manifest, pack and logical-tile verification through createStreetAssets. It uses the same verified decoded tile's8m Marina corridor and all15 actual building footprints, with tile-local pose proposals. Source and independent Luna reviews found no material blocker; syntax passed, functional tests are unrun. It preserves all no-authority flags. The five published-assets cases cover the straight station16→112 proposal, off-road and rotated-body refusal, changed source bytes and invalid input. They are wired into scoped CI; full-source/server coverage also discovers them. Returned evidence identifies source geometry, not an independently replayable pose/vehicle certificate.

Caller-supplied polygons have no map authority here. A clear result means clearance only against those shapes; source hash verification, retained tile/road/building provenance, terrain support, controller interpolation, complete door/actor boarding motion, crossings/NPC yielding, stopped supplier/shop poses and atomic rental/fleet/parcel/stock/wage integration remain required. Do not enable a trip from this helper alone. The next bounded integration must consume the retained verified district/depot geometry and preserve these explicit missing authorities.
