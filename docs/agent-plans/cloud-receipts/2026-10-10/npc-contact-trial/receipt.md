# NPC grounded contact fixture trial

- Host: `96cc63a2f9d2`; Node `v24.19.0`; configured model `gpt-6-luna`.
- Candidate checkout: `/workspace/remote-verification/repositories/worker-graphics-npc-contact-trial`.
- Published commit: `438a24111983a0634c6fa14eae86664222548fce` on `origin/codex/cloud-graphics-npc-contact-trial-20261010`; remote `ls-remote` SHA matched after push.
- Branch: `codex/cloud-graphics-npc-contact-trial-20261010`, based exactly on prior owned checkpoint `9122e0c4eb2d6db3fca4ed6e71687c4168923162`.
- Current diff is limited to fixture source, contact checker, and `src/scene/venue-scenes.ts` native NPC hooks/private floor helper. Patch SHA256 before commit: `6bb36c199e5ea41bd158ec2edc66f43e668fe8f49af8734cb7f45b2b2beac768`.
- Candidate reused the original owned worker checkout's `node_modules` by temporary symlink for read-only typecheck/bundle operations; no dependency install or mutation. The link was removed before final status.

## Baseline and candidate checks

The baseline report was rendered from the exact base source without the new venue hooks. The candidate report was rendered after mounting and after each idle/interact pose update with a private helper that gates on prepared-native provider evidence, checks every sampled foot-contact point against the real `SceneWalk.contactHeightAt`, subtracts its 0.016 m callback clearance, and calls the body's existing `solveFeet`. It skips unsupported, non-finite, and locomotion poses. Fixture/checker reports callback residuals separately from physical floor gaps and asserts exact left/right IDs, full support coverage, no candidate penetrating by more than 4 mm, a nearest candidate within 4 mm for each side, and physical ankle reach.

Both renderer reports are WebGL2 browser captures of the real Lagos office NPCs and existing gameplay actions:

- Baseline: renderer exit 0; its existing assertions all passed. The new contact checker exited 1 as expected.
- Candidate: renderer exit 0; its existing assertions all passed. The new contact checker exited 0 with status `pass` across Mrs Okafor and Dapo, both feet, and placement-idle / during-interaction / returned-idle phases.
- Candidate `fixture.typecheck.json` TypeScript check exited 0; checker syntax check and `git diff --check` passed.

Machine-wide heavy slot serialization was used for both baseline and candidate bundle/render runs. The browser lease was nested for the bounded local renderer. An earlier pre-trial renderer run on the original `9122` checkpoint used the browser lease without machine-wide heavy serialization; it is preserved in the original worker receipt and is not treated as serialized evidence for this trial.

## Measured change

Across all twelve NPC/phase/side samples, baseline physical correction requests were 68.647–77.213 mm. After correction, the measured residual vertical request was within 0–0.036 mm. Baseline nearest physical gaps ranged from 0.148–51.983 mm, while baseline minimum signed gaps were −68.647 to −77.213 mm. Candidate nearest physical gaps were 0–0.036 mm, and candidate minimum signed gaps were −0.036 to 0 mm. All requested physical ankle reaches were within each actor's measured two-bone reach. Higher toe/heel candidates can remain above the surface; the checker does not require every candidate point to touch the ground.

Reports:

- Baseline: `baseline/office-game-fixture-report.json`
- Candidate: `candidate/office-game-fixture-report.json`
- Baseline six direct-canvas PNGs and SHA256s: `baseline/png/`
- Candidate six direct-canvas PNGs and SHA256s: `candidate/png/`

## Log hashes (all under this receipt's directory)

- Baseline typecheck log: `baseline-typecheck.log`, `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty output, command passed).
- Baseline bundle: `baseline-bundle.log`, `1989dbe919acde49013d6384bac63bca83d00f8957df149ce8a20359a7851175`.
- Baseline renderer: `baseline-render.log`, `019eb56e264612e916ee5575eaa6f508bfee8b9ca31d366314bc1e70d501c61e`.
- Baseline contact checker, expected exit 1: `baseline-contact-check.log`, `637e0e0355853f6a2ee86476c10020bfcb63bd371ffde25e2b4d16b14afc7e29`.
- Candidate typecheck, exit 0: `candidate-typecheck-rerun.log`, `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty output, command passed). The earlier failed typecheck log is retained as `candidate-typecheck.log`.
- Candidate bundle: `candidate-bundle.log`, `fb7424830bc32a6d216a86f62ad3e4a9d1e215cbf840f7e7f6759419b93e158b`.
- Candidate renderer: `candidate-render.log`, `e3358daa4dc7caaaa087ae4be4bd0a5ff1e606225d708262fb8b1db8f0bbdcb2`.
- Candidate contact checker, final exit 0: `candidate-contact-check-final.log`, `79ea2ff936dead25bb873efc07be53b4898c82655589d3ef186efe6a5871dbfe`.
