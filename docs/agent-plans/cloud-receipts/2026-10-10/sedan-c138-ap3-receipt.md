# Sedan aperture AP3 CPU geometry receipt

- Checkout: `/workspace/remote-verification/repositories/sedan-aperture-20261010`
- Branch: `codex/cloud-sedan-aperture-cpu-geometry-20261010`
- Parent: `4ad527e6ad2751c8e9b4580dba51ad4ae25f5b4b` (retained as historical 15/15 checkpoint)
- Final candidate: `c1383b53a935153451beca180b0c264d99b4c126`
- Final tree: clean; exactly the two allocated sedan-aperture files changed in this successor.

The checkout lockfile SHA256 and the read-only lender checkout lockfile SHA256 both equal `d3a82d0f0d7e750bee84042a2ab36dcaa655cf6e7c9bdb8047823e507112efa9`. The lock pins Three `0.180.0`; the lender package is that version. A temporary local symlink to the lender `node_modules` was used only during the focused test, never modified, and removed after the lease completed.

Focused command: `AGENT_SLOT_DIR=/workspace/remote-verification/agent-slots AGENT_SLOT_HEAVY=1 node --experimental-strip-types scripts/agent-slot.ts heavy -- node --experimental-strip-types --test server/living-world/sedan-aperture.test.ts`

Result: exit 0; 17 tests, 17 passed, 0 failed, 0 skipped, 197.726795 ms. Captured terminal log: `focused-ap3-glasspartition-final.log`, SHA256 `3e58d7f9edab7980c056218779a0dcb0f8e4f91aa16fbffdd179999bc50bd404`.

The tests instantiate source-pinned map and street sedan/interior CPU meshes; verify Float32 attributes; check actual clipped moving-glass vertices and retained static-glass remainder vertices; and check door mesh vertices at progress 0, 0.5, and 1 against the analytic full-angle envelope. They check actual interior solids and steering geometry at both steering endpoints. Scene tests construct continuous line capsules from source scene anchor interpolation for enter-walk, enter-seat/door-close, exit-slide, and exit-seat for normal and reduced-motion timings. These are explicitly unverified anchor centerlines, not full actor envelopes; all authority flags remain false.

Fixed defects found in this follow-up: phase validation no longer coerces untrusted objects; retained box-fragment generation now omits degenerate slabs; and the driver glass moving volume no longer creates a false static-shell collision. First focused failures are preserved in `focused-ap3-first-failure.log` (normalized summary, not verbatim raw terminal output); the failure tool output remains in the execution transcript.

For the reviewed counterexample capsule centered at `[-0.966, 1.20, 0.40]`, radius `0.02`, margin `0.005`, and a fixed door interval `[0.55π, 0.55π]`, the source glass panel is first split by the exact Float32 door clipping box `x=[-1.07,-0.89], y=[f32(0.49),f32(1.48)], z=[f32(-0.05),f32(0.89)]`. The intersecting interior fragment belongs to the articulated door; the glass outside that volume is emitted in the static body mesh. The actual map and street CPU-mesh test verifies a clipped front-glass vertex in the door panel and a retained front-glass remainder vertex in the static body. The exact counterexample test then verifies no `driver-front-glass` shell collision and `candidateGeometry === 'clear-for-supplied-capsules'` for that supplied capsule and interval. This is a narrow partition/classification result, not a body-clearance or boarding claim; the door-sweep candidate check and all four authority flags remain governed by the analyzer, and the exact fixture keeps all authority flags false.

Pinned source hashes still match: interior `3d9a5b3a516031fb7b6e14058a3d3c2615a3f531a38b56781d2f4a66bf8b0a57`; vehicle index `7db039a0b25373a86354639fd703a96aab3a3de48a3088c14c555cc0fa6afc19`; geometry `4bf847bd17a735050daa4686ed0be495c64a7936ed3c65c6e306e740edc94885`; driving scene `3d42051273229265a17fcc5e04b7e5c95ddb72e7fa5fd00520d910cd19cf006c`.

Remaining limits: full clothed actor clip sweeps, ground/support, continuous body motion, route authorization, and renderer/mobile verification remain unproven. No build matrix, browser test, publication, integration, or authority activation was performed.
