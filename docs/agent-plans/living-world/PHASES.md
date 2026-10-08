# Phases, tests and release sessions

The implementation programme begins when the user assigns it. This published plan alone authorizes no gameplay edits or releases. Keep phases small enough to demonstrate and reverse without resetting player data. Independent preparatory work may run in parallel only with separate owners and files.

## Phase 0: establish contracts and ownership

Verify the repository URL/default branch, fetch the approved baseline, record branch/SHA/dirty state and read applicable `AGENTS.md`/repository instructions. Preserve all existing edits. Use an isolated branch/checkout for this programme; never use another agent's active working directory. Identify the current Goalmatic, graphics and worldbuilding owners, their branch SHAs and interface contracts. Record who owns shared types, routes, state migrations and integration.

Inspect worktrees and open PRs as well as the default branch; an active owner may be ahead of `main`. Git worktrees share most refs and repository configuration. A local ownership file or worktree lock does not coordinate agents on separate computers. Use a mutually acknowledged remote ownership/handoff record, through an authorized channel, with scope, base SHA, owner and expiry/renewal. A local note alone cannot grant a conflicting lane.

Audit the [source candidates](BASELINE.md) and identify runtime equivalents before adding modules. Define qualification, consent, rental, delivery and service state transitions, authority, transaction boundaries, event/version fields, save compatibility and recovery. Agree the district road/vehicle/appearance interfaces with their owners. Inspect historical prototype branches only when available and authorized.

**Exit evidence:** a baseline/ownership record, API and event examples, migration strategy, acceptance scenarios and a reproducible local Node/Worker baseline. Unknown external APIs are marked blocked with an owner/action; local game work uses contract fixtures and stays unblocked. No implementation starts in a file with unresolved write ownership.

## Phase 1: one complete district

Implement the full school → qualification → rental → driving → shop restocking → barber → reward → tool improvement → reload journey in [DESIGN.md](DESIGN.md). Include zero-money onboarding, NPC counterparts and two-player service consent. Use actual steering/braking and a persisted appearance result. Integrate mission events and existing wallets/business records without duplicate reward paths.

**Exit evidence:** a recorded solo journey and a two-player journey, each on a named build. A fresh guest reaches the loop; an existing saved player keeps progress. Depot-to-shop delivery adds the declared stock and pays once. Earned game cash purchases the tool upgrade exactly once, its additional approved practice style becomes usable, and both survive reload/reconnect alongside all prior progress. A repeated or racing delivery/service request settles once. Unauthorized borrowing, invalid assessments, revoked consent and stale departure actions fail without charging or changing another player. Mobile and desktop inputs complete the journey.

This phase is not accepted as separate disconnected screens. If a world/asset interface is blocked, finish its independent contracts/tests and report the exact remaining dependency; do not substitute decorative driving for the agreed behavior.

## Phase 2: livelihoods and recurring missions

Deepen the accepted loop with varied replenishment contracts beyond the first depot route, orders, fulfilment/refunds, permission-based borrowing, more affordable equipment/progression, recurring NPC relationships and mission variation. Reuse the existing economy simulator and event registry. Introduce new business types only when the shared contracts can support them.

**Exit evidence:** last-item purchase races, delivery abandonment, repeated refunds, shop closure and time rollover preserve stock/cash invariants. Measure progression over 1, 7 and 30 game days, recovery from zero money, and rewards from repeated combined strategies. A resumed player sees meaningful choices and a useful next action. Replay does not mint money or undo another player's consent.

## Phase 3: professions and bounded institutions

Deliver fictional medicine, law and civic progression as separate subphases, each with learning, assessment, service, consequence and recovery. Audit existing politics/justice code before adding roles. Keep roleplay cases/evidence separate from platform moderation and private data; give judgments an appeal and public spending a bounded simulated ledger.

**Exit evidence per subphase:** a solo NPC and opt-in multiplayer case completes, permission/role expiry takes effect, a player can withdraw or appeal, and no role obtains operator/private-data/real-payment powers. Existing election, civic, economy and account tests remain green. A whole professions phase cannot be closed because one role title was added.

## Phase 4: curated real-business pilot

Implement separate place/profile/world-object links, opt-in claims and distinct contact/management/location verification. Support branches, co-located businesses, service areas, owner media rights, corrections, disputed claims, suspension and removal. Start with merchant-controlled store/booking links and clear destination/fulfilment ownership.

**Exit evidence:** an approved test merchant completes claim, preview, publish, edit and revoke; a rejected claim never becomes a public verified listing. Private evidence/residential addresses do not appear in public APIs, exports or logs. Provenance/licence/attribution is recorded for every pilot map/asset/profile. Links are validated. Real health/legal services remain excluded. Current privacy and consumer requirements are reviewed before inviting real merchants.

## Phase 5: verified external capabilities

Split this into independently accepted units: optional Goalmatic milestone sync, native booking/capacity, and provider-owned payment/refund. The existing integration owner supplies real transport/auth/contracts. The gameplay team supplies the agreed internal capability interface and mocks. Keep each feature disabled until its own gate passes; local missions remain available without it.

**Sync gate:** stable account/workspace/record mapping, explicit consent generation, minimal typed game observations, committed outbox, deduplication/reconciliation and revoke/reconnect behavior proven against the owner's approved sandbox. No invented endpoints or broad implicit scopes. External completion cannot grant a game reward by default.

**Booking gate:** capacity/resource conflicts, timezone and daylight-saving cases, hold expiry, cancellation/no-show terms and refund obligations are tested. Only one authority can confirm a slot. A link click or mock is not a booking confirmation.

**Payment gate:** a separately approved provider/environment, NGN minor-unit accounting, authenticated provider confirmation, reconciliation, refunds, incident/support ownership and legal/product review. Keep merchant NGN, simulated points and Goalmatic credits separate. Real charges/transfers require the relevant user/provider approvals; never run them as casual test probes.

## Required loop for every implementation unit

1. Specify the player outcome, owned files/contracts and concrete pass/fail observations. Select a named baseline and authorized test environment.
2. Implement the smallest complete unit. Add meaningful behavioral tests requested by this programme, particularly for state/authorization/concurrency; avoid tests that merely restate the code.
3. Run focused tests and relevant existing regressions. Exercise the real UI in an authorized browser on mobile and desktop sizes and the agreed physical device. A fixture-only pass is recorded as such.
4. Investigate failures from evidence, repair the cause, rerun the failing cases and affected integration checks. Continue until acceptance passes or a real blocker is documented. An identical failure after one evidence-backed correction requires root-cause investigation or bounded escalation, not repeated blind retries.
5. Have an independent reviewer inspect the diff and acceptance evidence. The implementer repairs accepted findings; the reviewer or lead rechecks the changed behavior. Review is not a substitute for tests, and a worker's summary is not acceptance.
6. Integrate serially, resolve conflicts without discarding another owner's work, and test the integrated SHA. Record each unmet requirement explicitly. Only the release process below can change production status.

## Acceptance matrix

| ID | Boundary | Required proof |
| --- | --- | --- |
| A1 | Player experience | Complete solo/NPC and multiplayer journeys; fresh guest and existing account; zero-money access; readable desktop/mobile flows and usable touch/keyboard controls. |
| A2 | Persistence | Reload, reconnect and host restart preserve qualifications, contract states, consent, stock, money, appearance and mission progress; compatible older/v1 saves and interrupted migrations recover without reset. |
| A3 | Replay and races | Same ID/same payload returns the original outcome; changed payload conflicts; new IDs cannot resettle terminal domain records; concurrent tabs and last stock/vehicle/chair/slot races have one valid winner. |
| A4 | Authorization | Wrong actor/workspace, expired qualification/grant, consent revocation, account switch, membership loss and departure during an operation cannot retain stale authority. |
| A5 | Accounting | Cash/stock/custody/reward transitions are atomic or explicitly reconciled; failure after commit/response loss, cancellation racing completion and repeated refunds leave explainable ledgers. |
| A6 | External service | Duplicate webhooks/stale/out-of-order events, timeout after provider success, wrong workspace, revoke while queued, reconnect with a new consent generation and provider outage are tested. No old queue replay or fabricated success. |
| A7 | Node and Worker | Focused integration journeys and persistence/receipt/restart semantics on both supported runtimes; exhaustive checks appropriate to economy/storage/authority changes. |
| A8 | Privacy and assets | No credential/private-evidence leak; service-area privacy; correction/removal/retention paths; consent scopes; map/media licences and visible attribution; no fictional role gains moderation powers. |
| A9 | Performance | Current startup/download budgets hold; lazy feature loading; measured agreed mobile input/frame behavior. Record device/environment and distinguish viewport emulation from physical-device evidence. |
| A10 | Release | Exact reviewed source SHA, compatible saved progress, passing sealed package checks, authorized target, live health/build marker, public user journey and continuity after rollout. |

## Checks at this baseline

Read current `package.json` and [FAST-CHECKS.md](../../FAST-CHECKS.md); these examples are navigation aids, not a permanent script catalogue:

```sh
npm run check:fast
npm run check:full
npm run economy
npm run first-minute
npm run first-day
npm run two-players
npm run two-cities
```

Use repository machine slots for heavy/server/browser operations on a shared machine. Do not start overlapping full builds or reuse another task's server/data. Preserve existing state; use disposable test identities/data in an authorized preview. `smoke` creates and mutates a synthetic player, so it is not a read-only production check.

Full checks are warranted for the planned storage/economy/authority changes. Validate Node compatibility and Worker behavior using the current documented commands. Run the full suite once at the chosen evidence layer for the release SHA; rerun relevant checks when that SHA or an unresolved condition changes. A passing earlier SHA does not cover later code.

## A production session for each accepted phase

Prepare a concrete release packet: phase scope and acceptance table, repository and exact source SHA, tests/review, sealed artifact/digest, current target and bindings, data migration/continuity evidence, rollback plan, known limitations and proposed verification actions. Read current release instructions and workflows instead of copying old CLI commands or environment names.

Include the currently running version, flags, backup/restore evidence appropriate to the migration, and whether rollback is data-compatible or a roll-forward is required. A backup timestamp alone is not a restore proof. Define observation duration, error thresholds and the authorized recovery action before rollout.

Obtain a user release-session **GO** naming the phase, artifact and environment, unless exact standing permission already covers them and is recorded. Respect any provider/tool approval required at action time. A broad implementation instruction, this docs publication, an old deployment, a changed goal or an approval for another phase does not supply release permission. Keep independent authorized preparation moving while a release gate is pending.

Within an authorized session, deploy only the reviewed sealed artifact through the existing pipeline. Verify live health/build ID and representative user flow after propagation, plus saved identity/balance/receipt/progress continuity. Report deployment, verification and any rollback independently. Health alone does not prove the new gameplay. A failed check triggers diagnosis and repair/reverification or the approved rollback; it does not justify resetting data, changing auth/domains, removing gates or bypassing a denial.

Coordinate all production workflows against one agreed environment lock; GitHub concurrency ordering is not guaranteed FIFO. Do not cancel an in-flight migration to admit a newer job. Recheck the approved SHA, artifact, current version and authorization after waiting for the lock. Material changes to scope, target, artifact, migration or risk require a new GO. Preserve tool/provider approval requirements regardless of queue state.

## Evidence record

Maintain one tracker and link detailed logs/screenshots rather than duplicating them:

`Unit | outcome | owner/model/effort | branch/source SHA | implementation state | test/review evidence | preview status | production status | blocker | next action`

Use `proposed`, `implementing`, `verified at named level`, or `blocked` for implementation. Record production separately as `not released`, `released but verification pending`, `verified at build`, or `rolled back`. Each accepted unit records changed paths, contract versions, tested environment, elapsed time/retries where available, and unresolved risks. Token/cost data stays unknown when unavailable. Never close the programme using a subset of its acceptance requirements.
