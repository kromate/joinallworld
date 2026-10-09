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

Sol review found and repaired a validated-point reread, an incorrect concave-building rejection fixture, and a mixed-motion fixture whose initial polygon was smaller than the declared margin. Source-only review is not test acceptance. Tests are currently unrun.

Caller-supplied polygons have no map authority here. A clear result means clearance only against those shapes; source hash verification, retained tile/road/building provenance, terrain support, controller interpolation, complete door/actor boarding motion, crossings/NPC yielding, stopped supplier/shop poses and atomic rental/fleet/parcel/stock/wage integration remain required. Do not enable a trip from this helper alone. The next bounded integration must consume the retained verified district/depot geometry and preserve these explicit missing authorities.
