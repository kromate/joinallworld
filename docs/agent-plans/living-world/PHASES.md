# Phases, tests and release sessions

The persistent implementation programme begins when the user assigns it. The user's implementation intent includes deployment to production in phases; record that assignment as standing scope. Publishing this plan is a docs-only task and does not launch implementation, merge or deploy. Keep delivery batches small enough to demonstrate and reverse without resetting player data. Parallel work requires separate write scopes.

## Phase 0: establish contracts and ownership

Verify the repository URL/default branch, fetch the chosen baseline, record branch/SHA/dirty state and read applicable `AGENTS.md`/repository instructions. Preserve existing edits. Use an isolated branch/checkout. Discover current Goalmatic, graphics and worldbuilding branches, PRs and interface contracts from published GitHub work. Record reserved paths and who integrates shared types, routes and migrations. Access to the original Mac or its local agents is neither available nor required.

Inspect accessible branches and open PRs as well as the default branch; ongoing work may be ahead of `main`. Inspect worktrees on your own execution machine only. Git worktrees share most refs and repository configuration; local notes or locks do not coordinate separate computers. Use published scope/handoff records with base SHAs where available. If a scope is unresolved, preserve its paths and build an independent interface/fixture; do not claim an absent agent acknowledged a handoff.

Audit the [source candidates](BASELINE.md) and identify runtime equivalents before adding modules. Define qualification, consent, rental, delivery and service state transitions, authority, transaction boundaries, event/version fields, save compatibility and recovery. Resolve district road/vehicle/appearance interfaces from current source and published contracts. For private Goalmatic repositories, first try the supported browser with the user's existing signed-in GitHub session, as described in [BASELINE.md](BASELINE.md#goalmatic-handoff). Do not declare access missing before that read. Browser access does not imply terminal git authentication; never extract cookies/tokens or create new grants to bridge it.

**Exit evidence:** a baseline/scope record, API and event examples, migration strategy, acceptance scenarios and a reproducible Node/Worker baseline. Unknown external APIs get a precise contract/access handoff and an off-by-default adapter; independent game work uses fixtures and continues. No implementation starts in a reserved file with unresolved write ownership. A fixture does not satisfy live integration or actual driving acceptance.

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

Split this into independently accepted units: optional Goalmatic milestone sync, native booking/capacity, and provider-owned payment/refund. Reuse transport/auth/contracts from accessible published integration work; discover actual versioned operations through authorized source and capability reads. The gameplay team supplies the internal capability interface and mocks for unresolved dependencies. Keep each feature disabled until its own gate passes; local missions remain available without it.

**Sync gate:** stable account/workspace/record mapping, explicit consent generation, minimal typed game observations, committed outbox, deduplication/reconciliation and revoke/reconnect behavior proven against an authorized sandbox and verified contract version. No invented endpoints or broad implicit scopes. External completion cannot grant a game reward by default.

**Booking gate:** capacity/resource conflicts, timezone and daylight-saving cases, hold expiry, cancellation/no-show terms and refund obligations are tested. Only one authority can confirm a slot. A link click or mock is not a booking confirmation.

**Payment gate:** a separately approved provider/environment, NGN minor-unit accounting, authenticated provider confirmation, reconciliation, refunds, incident/support ownership and legal/product review. Keep merchant NGN, simulated points and Goalmatic credits separate. Real charges/transfers require the relevant user/provider approvals; never run them as casual test probes.

## Persistent goal and finite delivery batches

The goal spans sessions and continues beyond the first accepted district. Work through the remaining phases and replenish the backlog from actual play, mission/simulation results, live observations and specific user goals within the living-world, real-business and Goalmatic programme. Rank reproducible failures, broken journeys, progression gaps and measurable usability/performance problems by player impact. Tie every proposed improvement to evidence and an acceptance criterion; do not invent busywork to keep a loop alive.

If the runtime has a documented native persistent-goal facility, inspect its supported interface before setting the goal. Do not invent a `/goal` command or claim a scheduled/resumable runner exists. Otherwise maintain the plain-text goal and checkpoint in the branch, with an explicit resume action. A saved file preserves intent; it does not run while the agent is stopped.

Choose one finite batch at a time, with a player outcome, bounded effort and release criterion. Complete its loop below, then play the released result and choose the next evidenced improvement or unmet requirement. Do not declare the programme complete because the first slice passed. If all current requirements pass and no valuable supported improvement remains, record `awaiting direction` and the evidence; if access or a safety boundary blocks a lane, record it and continue independent authorized work. User pause/stop directions end active execution.

## Required loop for every implementation unit

1. Play the current app and relevant missions, run appropriate simulations, and capture the observed issue or unmet planned journey. Specify the player outcome, owned files/contracts and concrete pass/fail observations. Select a named baseline and authorized test environment.
2. Implement the smallest complete unit. Add meaningful behavioral tests requested by this programme, particularly for state/authorization/concurrency; avoid tests that merely restate the code.
3. Run focused tests and relevant existing regressions. Exercise the real UI in an authorized browser on mobile and desktop sizes and the agreed physical device. A fixture-only pass is recorded as such.
4. Investigate failures from evidence, repair the cause, rerun the failing cases and affected integration checks. Continue until acceptance passes or a real blocker is documented. An identical failure after one evidence-backed correction requires root-cause investigation or bounded escalation, not repeated blind retries.
5. Have an independent reviewer inspect the diff and acceptance evidence. The implementer repairs accepted findings; the reviewer or lead rechecks the changed behavior. Review is not a substitute for tests, and a worker's summary is not acceptance.
6. Integrate serially, resolve conflicts without discarding another owner's work, and test the integrated SHA. Stage the candidate, complete the release process below, and verify the live journey and data continuity. Record unmet requirements and release status separately.
7. Play the resulting app, review simulation/rollout evidence, update the ranked backlog and checkpoint, and start the next finite batch within standing scope. Keep precise blockers for unavailable evidence or external contracts.

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

The implementation assignment's phased production deployment is standing authorization within this feature programme. Record its source and limits. Do not add a generic approval question before every release. Repository/environment rules and action-time tool/provider approvals still apply; this docs publication itself performs no release.

Prepare a concrete release packet: finite phase/batch scope and acceptance table, repository and exact source SHA, tests/independent review, staging journey evidence, sealed artifact/digest, existing production target and bindings, data migration/continuity evidence, rollback plan, known limitations and verification actions. Read current release instructions and workflows instead of copying old CLI commands or environment names. A build or staging pass alone is not production success.

Include the currently running version, flags, backup/restore evidence appropriate to the migration, and whether rollback is data-compatible or a roll-forward is required. A backup timestamp alone is not a restore proof. Define observation duration, error thresholds and the authorized recovery action before rollout.

Proceed through the existing release process when the candidate passes these checks and remains within recorded standing scope. Obtain the applicable explicit authorization for new secret access, new costs/provider commitments, destructive or incompatible data changes, security/auth/domain changes, or out-of-scope work. Do not overwrite user data, extract credentials, bypass provider limits or evade denied actions. Keep independent preparation moving while a specific required approval is pending.

Deploy only the reviewed sealed artifact through the existing pipeline. Verify live health/build ID and representative user flow after propagation, plus saved identity/balance/receipt/progress continuity. Use authorized synthetic accounts for writes and preserve real player data. Report deployment, verification and any recovery independently. Health alone does not prove the new gameplay. A failed check triggers diagnosis and repair/reverification or the preauthorized data-compatible recovery; it does not justify resetting data, changing auth/domains, removing gates or bypassing a denial.

Coordinate production workflows against the existing environment lock; GitHub concurrency ordering is not guaranteed FIFO. Do not cancel an in-flight migration to admit a newer job. Recheck the reviewed SHA, artifact, current version, compatibility and standing scope after waiting. Any candidate change requires updated evidence and revalidation; new authority, target, cost or destructive/security risk requires the relevant approval. Preserve tool/provider approval requirements regardless of queue state.

## Evidence record

Maintain one tracker and link detailed logs/screenshots rather than duplicating them. Record the persistent goal, user assignment/standing scope, runtime goal handle if one exists, ranked evidence-backed backlog and next resume action:

`Unit | outcome | owner/model/effort | branch/source SHA | implementation state | test/review evidence | preview status | production status | blocker | next action`

Use `proposed`, `implementing`, `verified at named level`, or `blocked` for units; use `active`, `blocked`, `awaiting direction` or `paused by user` for the goal. Record production separately as `not released`, `released but verification pending`, `verified at build`, or `rolled back`. Each accepted unit records changed paths, contract versions, tested environment, elapsed time/retries where available, live observation results and unresolved risks. Token/cost data stays unknown when unavailable. Never close the programme using a subset of its acceptance requirements or claim unattended continuation without a real runtime facility.

### Supplemental exact-source evidence — 8 October 2026

| Unit | Outcome | Owner/model | Branch/source | Test/review evidence | Preview/production | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| StandIn destination boundary / privacy helpers | Verified at narrow unit level | Sol gpt-6.1-sol; Luna gpt-6-luna implementation | codex/living-world c55156d6 | 13/13 Node24.19,291.84ms; fake body/plain-object only | Not released; no physical/account API acceptance | Pin actual pose assets; trusted lifecycle allocation and Node/Worker route checks |
| Startup attribution | Observed size failure | Sol gpt-6.1-sol | c55156d6 | Ordinary observer build27.32s; [receipt](startup-attribution-c55156d6.json);615756 raw/24staticchunks,756 over | Not released | Changed two-file loader candidate through exact full CI; no cap waiver |
| Changed panel loader | Size gate failed; compile/build verified | Sol review / Luna driving | codex/living-world 0c5ce6e7 | [FullCI37844684751](https://github.com/kromate/joinallworld/actions/runs/37844684751) Node22/24:615633raw/223121gzip over633/121; full tests skipped | Not staged/released | Preserve cards; investigate static registry overhead, receive exclusive scope and changed-source check |
