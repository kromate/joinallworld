# Proposed teaching-start gate engine tests

Status: **unapplied test proposal**. Source base reviewed: `8f39fa52f54ef79530ff88f2cc181e6b1bdd6d5f`. The test addition is in [`teaching-start-gate-tests.patch`](./teaching-start-gate-tests.patch); it is not applied to `src/` and does not change runtime behavior.

The new `src/game/teaching-start-policy.test.ts` exercises the proposed trusted `interactiveTeachingStarts` context flag at the engine boundary:

- Missing or false opt-in keeps a new teaching shift on the existing timed path, with no teaching marker or generation increment, and one normal shift payment on timed completion.
- Literal true creates the authored interactive marker, increments the generation once, and advertises the interactive mode in the career view.
- Turning the start flag off after a real marker was issued does not erase it: a trusted save reload retains the practice, elapsed time cannot finish it, and the remaining authored answers complete the existing shift once.
- A similarly named request payload field cannot enable interactive starts.
- A truthy non-boolean supplied at the context-construction boundary is not treated as literal true.

The fixtures use the existing `createLife`, `dispatch`, `advanceLife`, and `viewLife` APIs with the teaching job, authored Freedom Park work spot, and adequate needs. They do not seed a teaching marker, counter increment, completion, or wage. The non-boolean boundary case mutates an otherwise valid context input with `Reflect.set`, avoiding an unsafe cast.

The companion engine gate proposal remains separate and unapplied. Host policy, private Node/Worker opt-in wiring, host-level behavior tests, and recovery acceptance for a marker that is already saved with the gate off remain Integration-owned. This patch does not prove either host is correctly wired and does not authorize turning the feature on.

Validation performed: `git apply --check docs/agent-plans/living-world/teaching-start-gate-tests.patch` succeeds against the reviewed source base. The patch was not applied; no test, typecheck, build, browser, or server was run.
