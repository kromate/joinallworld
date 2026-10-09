# Venue NPC startup fix candidate v1

This is an isolated source candidate; production files are unchanged. `venue-world.before.ts` is an exact copy of `src/venue-world.ts` at SHA-256 `0f7aade6cb6fe56ec8baa74d9ae3b583eee9045bdf34cf7a2154ced36e14f5ea`. `venue-world.candidate.ts` is that source with the patch in `venue-world.patch`; `implementation.diff` also adds the helper at its intended production path, `src/scene/body/startup-gate.ts`.

The candidate fixes two related startup dependencies:

- Each rendered venue frame may call `startCrowd`; the scene's existing `bodyAllowed()` and WebGL2 guard still decides whether canonical people start. Venue NPCs no longer wait for the local player's stand-in to become visible.
- The stand-in module import is attempted only while eligible. A missed gate leaves it available for a later frame, concurrent imports are deduplicated, an import failure opens a 2-second cooldown, and host disposal prevents a late module from being mounted. There is no animation-frame polling or timer retry while idle.

`src/scene/body/startup-gate.test.ts` covers delayed eligibility, bounded retry after import rejection, duplicate calls while pending, disposal during a pending import, and persistent ineligibility. Focused command:

```sh
node --max-old-space-size=32 --experimental-strip-types --test evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/src/scene/body/startup-gate.test.ts
```

Result: 5/5 pass on Node 22.19.0. This was a helper-only test; the cloned host was not typechecked or run in a browser. Root still needs an actual Market/Beach remote check that confirms canonical crowd loading progresses without waiting for the local body, remains procedural when ineligible, and disposes safely.

Candidate host SHA-256: `837e64cf31ab499f72732f4d3e76c5a278815206a8c741ff50280a13968cbc59`. Helper SHA-256: `f3e4021b278ddf00f3b7f6fcf1134c1e705091c6bce823d8038ab5a0a97b829e`. No map interfaces, venue definitions, or production body files are changed.
