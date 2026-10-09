# Driving v1/v2 issuance and rollback contract review

Decision: MODIFY the contract with the rules below before accepting an implementation. The proposed default-OFF issuance boundary is sound. This review does not approve cloud source, bindings, staging, activation, migration, or release.

## Scope and pins

Reviewed on 2026-10-10 by independent Astra source inspection only. No implementation, runtime, compiler, test, build, browser, server, dependency install, or delegated work was performed. Only finite file reads, hashes and git-show inspection were used. Owner files were not changed.

Root: public codex/living-world source checkout.

| Input | SHA-256 |
| --- | --- |
| docs/agent-plans/living-world/remote-driving-handoff-2026-10-10.md | f80ab931247c6ada992cde49462b86e62753d7ad9e09f40ea96b27e7d254bc7f |
| proposals/school-reverse-9482e2cd/manifest.json | f34dcaff8e648ab98a8afc64121ccb21d29d9b094f6ef1e3b2aa30e3dd813a8c |
| proposals/school-reverse-9482e2cd/reverse-gear-implementation.patch | 9482e2cdff947f726298040ee32c6102623277ee67ca1d05c84955999901f1d7 |
| proposals/school-reverse-9482e2cd/ui-addon-abc7d746/reverse-ui-controls.patch | abc7d746bb47b5b23094b1baca1def5847feee737f30ba3728326133a803046e |

Proposal paths in this table are relative to docs/agent-plans/living-world. The inspected service file matches git-show at eec14690544a4646e4cd8a5ad280d61bbe2709ca, SHA-256 a761b610ec85ffc79528a4883ebaa764f04d620a8bd9273c5cd5802c95631594.

Handoff line 36 reports accepted pure evidence of baseline 15, one expected red, candidate 22 with zero skips. These results were not rerun or independently inspected here. The manifest is an earlier snapshot with testsExecuted false; its service-test hash precedes the separate assertion addon listed in the handoff. Neither snapshot certifies the ungated service/client overlay. No final cloud candidate bytes were supplied.

## Required contract changes

### F1. Define replay ordering and the boundary of nonmutation

Handoff line 44 requires a previously committed explicit-gear retry not to mutate. The existing service at lines 293–309 reads the clock and applies timeout or clock-reversal pause writes before comparing the retained packet receipt. The frozen implementation patch leaves this order unchanged.

Concrete source-predicted case: with trusted issuance ON, accept packet P for the current actor, city, location and journey, sequence 1, frames [{throttle:1,brake:0,steer:0,gear:"reverse"}]. Preserve the committed row, instantiate the service OFF on that store, advance the clock beyond lastInputAt + 1500, and resend exactly P. The existing order calls pauseRecord and writeRecord, changes revision, timestamps, credit and state, then returns successful duplicate. It does not satisfy a nonmutating replay guarantee. A gate before receipt recognition instead incorrectly rejects the committed packet.

Require valid envelope, authenticated ownership, strict saved-row validation and matching journey/context before a replay can succeed. For that authorized context, recognize the exact retained successful receipt before any driving-row clock, timeout, issuance or simulation mutation. A replay returns the current canonical session with duplicate success and the current OFF capability absence. It does not replay physics, spend credit, change revision/timestamps/receipt, issue a version, or grant credentials. The terminal receipt case must also work. Same retained sequence with a different fingerprint remains packet_conflict.

Do not broaden this to unlimited historical replay. Storage retains only lastPacket, whose sequence equals nextSequence - 1. An older accepted sequence whose receipt was replaced remains a sequence conflict. Preserve the existing stored fingerprint representation; do not silently normalize old receipt strings differently.

The contract should say whether "nonmutating" means the driving row. Existing access at lines 142–146 renews a session and settles life state, so a whole-database immutability claim is stronger than current behavior. Keep authorization and city/location safety checks. A mismatched context must never use a receipt to bypass them. If an existing safety pause is retained for a mismatched context, report it as that separate refusal transition, not as a nonmutating successful replay.

### F2. Specify capability freshness across every response path

Handoff line 45 does not yet define how capability loss interacts with a successful duplicate, successful lifecycle response, or delayed response. The frozen UI patch lines 49–59 and 82–86 sends explicit gear without any capability. This is a known unfinished overlay, not evidence that the unreceived implementation contains the same fault.

The baseline component applies successful lifecycle replies directly at lines 559–564 and successful restart replies at lines 531–537, outside applyResponse. A capability update only in applyResponse would miss these paths.

Concrete acceptance case: receive an ON response, select Reverse and buffer controls; then receive a current successful OFF pause/resume response without capability. If only the shared handler clears permission, the cached ON value and explicit-gear intent survive. A related case delivers an older ON response after a newer OFF refusal at the same saved revision. Row revision alone cannot order ephemeral permission because a refused packet need not change it.

Require absence to revoke permission on every applicable current driving response, including success, refusal and duplicate. Adopt permission only after actor, city/location, journey and request freshness checks. An obsolete ON response must not restore it after observed loss. A fresh authoritative response after reconciliation may enable it again; merely receiving a previously queued response may not. Do not persist permission in the lesson, actor or packet receipt.

On loss, clear requested gear, keys, touch, wheel intent and unsent frames. Stop local prediction and control production while an in-flight packet is uncertain; reconcile and pause through the existing fenced lifecycle path. Keep the sent packet immutable. Never strip gear from that packet and resend it under the same sequence, or invent its acknowledgement. Once reconciled, legacy three-field driving can remain available OFF. Canonical reverse motion must still display as reverse until an authoritative transition stops or changes it.

### F3. Make version issuance and rollback terms unambiguous

Handoff lines 44, 46 and 48 require both "no v2 issuance OFF" and continued v2 pause/resume/legacy operation. Define issuance as creation or upgrade to v2. It does not prohibit writing an already-issued v2 row after an authorized lifecycle action or legacy control. Keep that journey at v2; do not strip gear to obtain a v1-shaped save.

Concrete failure case: rollback reads a running v2 reverse row but its forward-only writer omits gear, or rejects every v2 write. OFF pause, resume or old-client input then corrupts or strands a valid journey. "Compatible reader" must therefore mean a compatible deployed reader/writer and service behavior, including terminal evidence and retained receipt handling.

Both explicit forward and explicit reverse are new explicit-gear input and must be refused OFF, including a mixed packet with one geared frame. Validate the complete packet and refuse before simulating any frame or charging credit. A normal new OFF journey is v1. Only trusted literal true enables issuance. Omitted, false, strings and saved/browser claims cannot enable it. Capture the trusted setting for the service instance; no mutable request object may become its authority.

Do not conflate process restart with the explicit lesson /restart action. A process restart preserves the journey and its v2 contract. The existing explicitly authorized lesson restart creates a different journey and retains its existing policy; this review does not authorize using it to reset the observed score-zero school attempt.

## Minimum acceptance evidence

1. Source review must receive the exact candidate commit, allowed-file diff and hashes. Verify that the issuance option remains unwired in production; strict v1/v2 storage and qualification-evidence readers are independent of the gate; capability comes only from trusted construction and is absent OFF on every response. Review all writer paths and client adoption paths. Do not loosen corrupt-row, terminal, receipt, city, location, account or revision checks.

2. Actual Node24 service checks must cover omitted/false/string versus literal true, new OFF v1, atomic refusal of explicit forward/reverse and mixed packets, ON accepted reverse, OFF v2 current/pause/resume/legacy forward controls, corrupt rows preserved, and terminal evidence. Snapshot the driving row before and after refusal/replay. Include exact replay after timeout, clock reversal, lifecycle revision changes and process reopen; a conflicting payload, old unretained sequence and foreign context must not get duplicate success. Verify no simulation, credit, receipt, score or qualification changes on the successful replay.

3. Actual component checks must cover capability absent on initial load and successful lifecycle/restart/refusal/duplicate replies, ON-to-OFF loss while controls are held or buffered, loss while a packet is in flight, and a delayed ON reply after loss at the same revision. Exercise all existing actor/location/journey/unmount fences. Verify keyboard access and 48px direction controls. A client capability is presentation information, never server authority.

4. Before any v2 issuance, stage and pin an OFF deployment that can read and operate v1 and v2, including its exact rollback image. Review the eventual Node and Worker bindings separately. An environment string must not accidentally become trusted true through truthiness, inherited defaults or browser data. Default OFF must hold independently on both hosts. A mixed deployment must not leave any v1-only process reading a store that can receive v2.

5. Actual Node/Worker and persistence evidence must use the final pinned artifacts. Issue a v2 row in an isolated authorized store, durably reopen it, move to the compatible OFF rollback artifact, and demonstrate current/pause/resume/legacy control plus receipt and terminal behavior. Preserve row identity, version, position and earned score. A reload may perform the existing explicit safe pause; record its expected revision change separately from nonmutating input replay. Also test an untouched v1 row and a corrupt row. A unit fixture or serialized object alone is not restart or Worker parity proof.

6. Actual desktop and mobile gameplay must continue the original school/store, demonstrate controlled backing away from the road edge without heading teleport or checkpoint credit from reverse, and show that switching direction brakes before changing motion. Observe blur, hidden page, disconnect, capability loss and reopen. Preserve the original score 0 and school/home/wallet facts. No licence, score, qualification or payment grant follows from this mechanic. Physical-phone evidence and viewport emulation must be labeled separately.

7. Final remote evidence must identify actual runtime/model/host, exact bytes, commands, exits, counts/skips, durations and logs. Retain failures. Run the handoff's focused checks, all five compiler projects, build, size and smoke checks under its current resource limits and explicit compiler exception. Preserve startup caps, including 195600 Brotli. Full candidate CI, exact-SHA stage continuity and release observation remain outstanding until separately proved.

After the first durable v2 write, C1/eec v1-only rollback is forbidden for that store. Disabling issuance is not a migration or downgrade. A compatible rollback image must exist and be pinned before enabling, with original-store continuity evidence and a recovery plan that does not discard accepted progress.

This report grants no implementation acceptance. It does not extend the 09:00 Lagos / 08:00 UTC cutoff on 2026-10-10 and authorizes no paid resources.

