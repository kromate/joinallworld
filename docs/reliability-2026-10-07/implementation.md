# Implement the Allworld reliability programme

Use [README.md](./README.md) for scope and the architecture decision. Use [risk-register.md](./risk-register.md) for the evidence behind each requirement. This document defines proposed modules and contracts; those modules do not exist yet.

## Execution rules

1. Complete W0 first. Record decisions and evidence in a new implementation log beside this file.
2. Preserve dirty user work. Use bounded agents with separate file ownership. Keep one integrator for shared types, persistence and migrations.
3. Mark packages `open`, `local`, `staging`, or `production`. Record SHA, commands, outputs and unresolved risks. Keep a matching R01–R38 status table.
4. Prefer existing focused checks. The acceptance scenarios below define required proof; this planning request does not separately authorize new tests, servers, load traffic, provider spending or deployment. Obtain missing authorization without blocking independent design/local source work.
5. Implement one package at a time across shared state. W1, W4 and an independent W10 audit may run in parallel after W0. W2 precedes monetary migration. W3 precedes W5. W6 and W7 precede W8. W9 depends on W2. W12 closes the programme.
6. Keep a reversible feature flag or adapter selection while changing storage/protocols, but give each production state record one writer. Remove obsolete implementations after the defined migration window.

## Non-negotiable state contracts

- Acknowledgement means the whole command is durable: identity authorization, life version, balance, inventory/ownership, limits, journal, receipt and outbox.
- Room presence and movement are replaceable observations. They do not authorize rewards, purchases, travel completion or ownership.
- One stable operation ID follows a user intent through retries, reconnects and provider delivery. Different payload under the same ID is a conflict. An expired operation cannot be re-executed under its old ID.
- An uncertain response means “check the existing outcome”, not “generate a new ID”. An idempotency key alone does not authorize the caller.
- System mint/burn postings balance the journal. Player spendable balances stay nonnegative safe integers. Never convert SQL `BIGINT` to a lossy JavaScript number. Validate at boundaries and retain the current safe range until the protocol explicitly changes.
- A journal is an audit record, not a backup. An opening balance is a migration checkpoint, not reconstructed transaction history.
- Game currency and real currency have distinct types, records and authorities. No implicit conversion or redemption exists.

## W0 — Freeze scope, inventory limits and define the experiment

**Owner:** primary integrator with Luna inventory. **Risks:** R10, R33 and all O-labelled rows.

Read current `package.json`, `wrangler.jsonc`, `deploy/README.md`, `SECURITY.md`, storage/route registries, and actual release configuration. Inventory each route and message kind: owner, authentication, state mutated, retry semantics, complexity, body limit, rate limit, money effect and provider dependency. Inventory hard caps and table retention, including accounts, guests, receipts, messages, room members, queues, archives, logs and outbound providers. Avoid copying current caps into the future implementation without measurement.

Record the currently deployed SHA, host, namespace, object identity, provider region/plan, enabled telemetry, restore capability and edge rules using read-only tools where available. Record unavailable facts as blockers, never defaults. Do not infer live configuration from the checked-out Wrangler file or historical notes.

Choose target concurrency tier, hot-room occupancy, expected new-account rate, old-save size, provider budget and recovery scope. Use README defaults for provisional engineering work only. Distinguish browser sessions, unique accounts, simultaneously active players, requests/second and socket frames/second.

**Output:** `baseline.json`, route/limit inventory, approved load-environment description and R01–R38 status table. **Done:** each register row has an owner and evidence source; each external decision has an owner and explicit pending state.

## W1 — Measure pressure, cap work and make failures actionable

**Owner:** Sol. **Risks:** R10, R21, R24, R25, R34.

Extend `server/telemetry/`, `deploy/cloudflare-worker.ts`, `deploy/sqlite-store.ts` and `server/pulse.ts`. Add bounded histograms/counters for queue wait, callback time, commit/barrier time, serialized bytes, rows touched, pending work, limiter outcomes, socket frames/bytes, fanout, room occupancy, receipt occupancy, storage size and outbox age. Aggregate by route template and message class. Avoid unbounded player/IP/transaction labels or secret payloads. Correlate a sampled trace through an opaque request ID and build ID.

Add an admission controller before expensive state work. Give core reads, durable commands, new-account creation and optional providers separate bounded concurrency/queue budgets. Reject before exceeding a measured queue deadline; return JSON with a machine-readable capacity code and bounded Retry-After. Reserve recovery/operator capacity, with authenticated operator access. Do not drop a committed response or accepted money command to satisfy a queue budget.

Add runtime controls to disable transfers, one reward source, new registrations or paid external services independently. Read controls through authoritative, auditable configuration. Preserve gameplay that is unaffected. Alerts cover queue delay, error ratio, invariant failures, storage growth, outbox lag, quotas, backup age and cost slope. Verify ingestion and alert receipt, not just HTTP 200. Missing telemetry must appear as missing, not healthy zero.

**Acceptance:** synthetic overload produces bounded 429/503 responses, stable memory and no partial writes. An injected storage failure triggers an observable alarm. A telemetry outage does not increase command latency without bound. Thresholds and operator actions are recorded before rollout.

## W2 — Establish authoritative economic history and fix earned-credit divergence

**Owner:** Sol, reviewed by primary integrator. **Risks:** R11–R13, R16, R36.

First fix `activities.ts` to emit the actual credited amount and update `social.ts` to use that field. Inventory every completion emitter/listener before changing the event type. Do not recompute an advertised reward after `credit` has refused it.

Add proposed `server/economy/journal.ts` and storage-backed journal operations. Change `wallet.ts` to emit a structured monetary effect with amount, source, source ID and eligibility classification. Collect effects inside the current command draft. Persist effects within the existing SQLite `transactionSync`, not a second asynchronous write. Deterministic simulation can consume effects without external storage; production cannot commit money without journal persistence.

Use these logical tables, with indexed keys rather than a new giant JSON collection:

| Table | Required fields and constraints |
| --- | --- |
| `economic_principals` | Immutable character/wallet principal ID; current account ownership link; guest ownership mode; lifecycle state |
| `economic_limit_subjects` | Account-scoped subject after claim, guest-scoped before claim; linked principals; versioned lifetime and daily allowance checkpoints |
| `wallet_accounts` | Wallet ID; principal and character/city identity; currency; spendable balance; version; quarantine status |
| `money_transactions` | Transaction ID; actor principal ID; operation ID; payload hash; kind; policy version; source ID; time; unique actor principal+operation ID |
| `money_entries` | Transaction ID and entry ordinal unique; wallet/system/escrow account ID; signed amount; resulting balance/version for spendable or escrow wallets; source classification |
| `money_transfers` | Transfer ID; sender/recipient wallet; amount; state `reserved`, `credited` or `refunded`; version; terminal transaction ID |
| `money_checkpoints` | Wallet version; opening balance; source snapshot hash; source namespace/schema; imported time; history boundary |
| `command_outbox` | Event ID unique; aggregate ID/version; payload schema; delivery state; attempts; next due time |

A direct, immediately available transfer may post sender→recipient in one transaction. Use escrow for existing deferred recipient effects: sender→escrow once, then escrow→recipient or escrow→sender exactly once. Each posting balances to zero across player and system accounts. Enforce terminal-state transitions conditionally by version. Keep immutable postings; put delivery workflow status in a separate mutable record. Journal all money-moving commands, including periodic settlement, interest, refunds, table wins, referrals, purchases, rent and operator adjustments.

Group all money effects of one command into one balanced journal transaction. Deferred settlement/refund uses a deterministic child operation ID derived from the transfer ID and phase, with a conditional terminal transition preventing both outcomes. Give system-triggered settlement its own stable source ID; use the intended settlement period/version, never the wall-clock retry time. Preserve the command receipt independently from journal retention.

Bootstrap each valid stored wallet with one checkpoint/opening posting using deterministic `migrationId + walletId`. Import from authoritative saved cash, not the last 60 lines. Reconcile pending gifts so opening cash plus escrow neither loses nor duplicates their value. Preserve pre-migration earned/limit counters as explicit checkpoint data. Quarantine ambiguous or invalid records. Retain legacy bounded history as historical display only; mark its incompleteness.

Post each player's opening cash against a dedicated migration-equity system account. For each already-debited, uncredited legacy gift, create exactly one opening escrow balance offset against migration equity; do not debit the sender again or credit the recipient during import. Give that transfer a deterministic legacy ID. Its subsequent settlement/refund is the only player cash mutation. Confirm total player cash plus pending escrow is unchanged by import. Ambiguous legacy effects remain quarantined, not guessed.

Player and escrow accounts require version-checked resulting balances. System issuance/sink/equity entries may use deterministic buckets and omit a running balance; they still participate in the zero-sum posting constraint. Never lock one global system balance for every reward. Wallet principal IDs remain immutable through claim/parking. Current owner links and account-level limit subjects may change, but prior journal ownership is not rewritten.

Proposed caller contract:

```ts
type CommandOutcome =
	| { kind: 'committed'; operationId: string; stateVersion: number; transactionIds: string[] }
	| { kind: 'duplicate'; operationId: string; stateVersion: number; transactionIds: string[] }
	| { kind: 'rejected'; code: string };

interface DurableCommands {
	execute(input: VerifiedCommand): Promise<CommandOutcome>;
	outcome(actor: VerifiedActor, operationId: string): Promise<CommandOutcome | null>;
}
```

`VerifiedActor` is created server-side from authentication. `VerifiedCommand` contains validated payload, operation ID/fingerprint, expected version where required and policy version. The service owns authorization, settlement and atomic persistence; callers cannot submit arbitrary journal entries.

**Acceptance:** failed overflow credit does not increase earned allowance. Two concurrent spends cannot overspend. Response loss then retry returns one transaction. Failure between debit/credit/receipt writes changes nothing. A post-migration transfer remains traceable after receipt/UI pruning. Checkpoint plus subsequent entries reconstruct cash and transferable allowance; pre-migration history is explicitly incomplete. Duplicate bootstrap is a no-op. Remediation dry-run identifies exact postings; applying it twice has one effect.

## W3 — Remove per-frame storage and global socket work

**Owner:** Sol. **Risks:** R02–R05, R21.

Change `cloudflare-worker.ts`, `server/ws/rooms.ts` and the host socket seam. Classify frames as replaceable movement/presence, control, or durable commands. Keep durable auth/money limits. Use a bounded per-connection token bucket for ephemeral frames, with token/time state restored from a bounded socket attachment. Persist only a changed socket attachment. Carry a conservative shared session budget across multiple sockets through one session coordinator or quota lease; opening eight sockets must not multiply a player's allowance eightfold.

An attachment survives hibernation, not arbitrary reconnects. Protect reconnect/upgrade and session creation with independent durable/edge limits. Repeated wake, reconnect, invalid JSON or oversized input must not reset a valuable allowance or cause unbounded DB writes. Drop/close repeated abusive frames without one error response per frame. Validate size before parsing.

Coalesce movement to the latest state for each update interval. Use room-size and per-recipient interest bounds. Add acknowledgement sequence/window limits for reliable messages; a synchronous `send()` success is not delivery proof. Close slow consumers once bounded unacknowledged work expires and let them resync. Use native `bufferedAmount` only on runtimes that expose it; do not assume Node WebSocket APIs exist on Workers. Keep durable reliable payloads outside per-socket attachments.

**Acceptance, pending an authorized disposable run:** instrumented 10,000 movement frames produce no limiter table write per frame and no scan/serialization of all global sockets. A changed socket needs at most O(1) attachment work per frame. Persist safety-critical quota/identity changes before hibernation; coalesced movement may restore from its last checkpoint and request a fresh position. Hibernation never restores extra quota. Eight sockets and repeated reconnects remain within the shared budget. Slow consumers and invalid-frame floods leave healthy clients responsive. Re-run block/visibility checks after fanout changes.

## W4 — Recover clients without replaying user intent

**Owner:** Sol. **Risks:** R06–R08, R30, R32.

Change `src/client.ts`, `src/community.ts`, `src/tables/client.ts` and monetary UI callers. Preserve operation IDs for uncertain consequential commands in identity-scoped storage. On reload, ask the server for the original outcome before offering retry. Persist minimal intent metadata, no tokens, and clear it on confirmed outcome or identity change. Reject a stored pending record from a different principal. Avoid a general offline action queue; offline gameplay remains read-only.

Add full-jitter backoff, a finite retry budget and stability period before resetting attempts. Respect Retry-After, offline/hidden state and room revocation. Share connection/poll coordination across tabs where supported, with a safe fallback. Use generation tokens and monotonically increasing state versions to discard stale responses after identity/city changes. Coalesce duplicate refreshes.

Version room snapshots and reliable event cursors. Reconnect receives a fresh authorized snapshot plus replayable durable messages after a cursor. When retention has expired, force a snapshot and identify the gap. Public venue chat is currently transient: retain that privacy policy and show a gap unless a separately reviewed retention policy changes it. Do not recover messages from dedupe hashes.

**Acceptance:** disconnect after debit but before response, reload, then retry yields one debit. Delayed old-account/city responses never replace current state. A deployment with an old tab produces a compatible result or safe reload. Flapping sockets stay within the retry budget. Polling pauses in background and spreads requests after resume.

## W5 — Partition realtime rooms with bounded authorization

**Owner:** Sol; primary integrator owns authorization design. **Risks:** R01, R04, R07, R22, R29.

Add proposed `deploy/room-object.ts` and `server/realtime/admission.ts`. Route by normalized `city + venue + instance`, using finite room occupancy and deterministic overflow admission. Room objects own sockets, presence, movement and transient signalling only. Persistent table results, rewards, membership entitlements, blocks and durable messages remain core-owned. During this stage the existing core remains a bottleneck for durable commands; label that explicitly.

Core issues a short-lived signed ticket with audience, room/instance, principal/public character ID, device/session reference, identity epoch, permission version, expiry and nonce. Keep tickets out of logged query strings. Bind a ticket to authenticated upgrade context and consume its nonce in the destination room. Renew from core at a bounded interval, not per movement frame. Default proposed ticket lifetime is 60 seconds; revocations propagate immediately through outbox, with expiry as the maximum fallback window. Sensitive operations always reauthorize with core. If renewal cannot be verified, stop protected interactions and close on expiry.

Room tickets must not include raw session secrets or authorize arbitrary rooms. Preserve block/privacy rules before constructing both snapshots and deltas. Account claims, bans, logout, character switches and movement between places invalidate the relevant epoch. At-least-once outbox delivery is deduplicated by event ID; older policy versions never overwrite newer ones. If invalidation is missed, ticket expiry bounds stale room access.

**Acceptance:** two rooms have separate realtime load/failure budgets. Unrelated realtime rooms remain usable during isolated movement/fanout overload. Shared-core command overload remains a W1/W8 concern; this stage does not claim complete city isolation. Ticket replay in another room or after identity change fails. Revocation closes the existing socket within the declared bound. Durable commands cannot be called through a room to bypass core. Restarted rooms reconstruct authoritative membership safely.

## W6 — Make storage work proportional to the changed entity

**Owner:** Sol. **Risks:** R09, R10, R20.

Profile accessed collections in `deploy/sqlite-store.ts` before choosing the first migration. Extract high-churn social players/conversations/messages, business profiles, civic votes and indexes into keyed records. Introduce narrow repository operations instead of proxying an entire global JSON object. Keep the command transaction passed through all participating repositories. Preserve public IDs and referential ownership.

Use indexed keyset pagination, bounded query results and batched expiry workers with resumable cursors. Partition journal history by time when needed; archive with a manifest/hash before removing online data. Keep sufficient checkpoint and transaction linkage to reconcile. Never remove live idempotency protection to free space. Treat existing world-shard logs as useful storage layout, not compute distribution.

**Acceptance:** grow data volume 10× while holding one-entity operation constant; rows/bytes touched stay approximately constant except documented bounded indexes. Full-cap behavior is explicit and reversible. A failed cleanup batch resumes without deleting newer data or required money evidence.

## W7 — Make corruption, upgrades and restoration explicit

**Owner:** Sol; primary integrator owns restore decisions. **Risks:** R12, R16–R18, R20, R37.

Add schema version/checksum and migration records. Run required migration work before serving writes. Use transactional DDL where supported; make multi-step backfills checkpointed and idempotent. A Wrangler class migration is not an application schema migration. Add an explicit supported reader/writer schema range. Reject incompatible starts; preserve the previous compatible reader during an expand/backfill/contract migration window.

Separate new-player defaults from loading persisted money. Quarantine invalid money/ownership rather than applying a default balance. Return a recoverable support state; allow unaffected read-only access. Build read-only reconciliation and remediation-preview commands. Keep operator repair as explicit, auditable compensating postings, with a second review for the concrete affected accounts and amounts.

Record encrypted backup/export manifests, key recovery dependencies, provider restore reference and last verified restore time. Restore to an isolated target first; compare identities, wallet sums, receipts, pending gifts, inventory and ownership. Define crash recovery separately from region/provider disaster recovery. Replay only committed journal/change-log records with original effect payload, immutable event ID and aggregate version. Never re-execute client commands under a new clock, policy or random seed, or re-send providers blindly. If committed records after the backup watermark are unavailable, report that measured data-loss boundary.

Treat the Node JSON store as development-only unless its durability is strengthened and verified. Production mode must refuse unsupported persistence settings. Do not claim Node crash/power-loss behavior from Worker checks.

**Acceptance:** interruption at each migration boundary resumes; newer schema refuses an older incompatible writer. Corrupt money stays quarantined. Recovery completes within the agreed RTO and reports actual RPO. Account/grant keys survive the rehearsal. Ledger and business-data retention/deletion policies are documented and implemented separately.

## W8 — Remove the durable singleton without splitting money authority

**Owner:** Sol; primary integrator owns database, placement and cutover. **Risks:** R01, R13, R19, R38.

Implement a PostgreSQL adapter behind the command/repository boundaries from W2/W6. PostgreSQL owns canonical identities, life snapshots/versions, wallets, inventory, land/unique ownership, receipts, social durable records, principal limits, journal and outbox. Room DOs remain ephemeral. Never leave life completion authoritative in SQLite while its reward wallet becomes authoritative in PostgreSQL.

Choose a managed provider/region only after benchmarking from expected users and Worker placement and obtaining the needed spending approval. Use Hyperdrive transaction pooling with a cache-disabled connection for all authoritative reads. Keep transactions short and external provider calls outside them. Set bounded pool wait, statement and transaction timeouts. Acquire affected rows in stable ID order. Use explicit row locks and uniqueness constraints; use serializable isolation where invariants span predicates, retrying the entire transaction with the same operation ID after a bounded serialization failure. Return a retryable response when retry budget is exhausted.

Avoid a shared issuance-account balance row lock on every wage. Journal issuance/sink postings remain explicit, but derive their totals asynchronously or bucket their system accounts. Keep per-player spend checks strongly consistent. Isolate read-heavy public projections and lag them explicitly; replicas cannot authorize spending or account access. A managed database needs capacity/connection/storage alarms and its own HA/restore evidence.

Cutover procedure:

1. Add a durable source change log/outbox covering every mutated durable entity, delete and identity move, not money alone. Write each change record in the same SQLite transaction as its source mutation.
2. Export a consistent snapshot with source epoch/high-watermark and hashes. Preserve principals, public IDs, operation IDs, versions, pending transfers and encryption dependencies.
3. Import into the non-serving target. Replay subsequent changes in order per aggregate, rejecting version gaps. Compare target/source counts, hashes, balances, pending obligations and owner relationships. Include friendships, blocks, economic-limit subjects, earned allowances, inventory and receipts at the same watermark; they are money-authorization inputs.
4. Rehearse a final brief write freeze. Pause all mutation paths, including alarms/background settlement/provider callbacks. Drain source transactions, record final watermark and replay to it.
5. Durably retire source write authority with a `fence_epoch` checked inside every mutating transaction immediately before commit. Drain/abort pre-fence work, record the final watermark, verify target replay reached it, then activate the matching target authority epoch and switch routing. Source routes, alarms and callbacks reject writes after retirement. Routing alone is not fencing. Tickets issued under the old epoch must be renewed before protected room use.
6. Keep the source read-only for recovery. Once target accepts writes, simple rollback to source is forbidden: use a reviewed reverse replay under a new freeze, or a forward fix. Room reconnects acquire the new epoch.

Use a single cutover for the interacting economy in this programme. Do not migrate arbitrary player cohorts across two independent money authorities. Cohort migration would need an additional cross-authority transfer protocol and is out of this design.

**Acceptance:** target conformance includes all current SQLite command behaviors. Snapshot/replay catches up with exact data and authorization checksums. Failure between mutation and change-log writes commits neither. Faults before/after each cutover step cannot create two writers. An in-flight old command crossing the fence and an old alarm/callback both abort. Response-loss retry resolves on the new authority. A noisy account cannot exhaust the connection pool for everyone. Publish measured sustainable capacity and remaining bottleneck.

## W9 — Control issuance and multi-account abuse

**Owner:** Sol with product decisions by primary/user. **Risks:** R14, R15.

Tag issuance and sinks by immutable source ID and policy version. Aggregate daily minted/burned supply, spendable cash, escrow, debt/deposits, median balances, concentration and transfer velocity. Distinguish transfer volume from new money. Version simulation inputs and content; include wages, interest, missions, table rewards, referrals, offline catch-up, inventory resale and all new sources.

Introduce stable economic principals and preserve them through claim/parking/switching. Aggregate caps across all characters owned by an account. Recommended product policy: retain guest-first gameplay but require claim before peer-money transfers. Treat this as an explicit product decision before activation; accounts do not prove unique humans. Supplement with reward-specific velocity and graph signals. Use IP as a risk signal, not a sole household ban. Do not retroactively confiscate legitimate rewards just because a balance is high.

Keep immutable wallet principals separate from the mutable account-level limit subject. Claim links existing principals without copying or merging balances. Import each principal's counter checkpoint once using an ownership-link migration ID. Conservatively sum lifetime counters, and sum send/receive amounts and counts for the same Lagos day; never reset them on character switch. Claiming a second played character must neither discard its prior usage nor count that usage twice.

Classify source budgets explicitly. An asynchronous aggregate can raise an alert or pause future issuance; it is not a hard cap. A hard issuance cap requires a budget reservation committed atomically with the journal posting under the same operation ID, using a bounded locked bucket or preallocated quota whose total is fixed. Failed/replayed commands do not consume another reservation. Never authorize against a stale dashboard aggregate.

**Acceptance:** linked characters cannot reset limits through switching. Received gifts remain ineligible earned income. Daily journal supply equation reconciles. Simulations cover worst-case legitimate strategies, time jumps, retries, collusion and long inactivity. Unknown source categories cannot silently mint. Breaching a source budget can pause only that source with an understandable user message.

## W10 — Preserve identity, permissions, privacy and operator control

**Owner:** Sol audit/implementation; primary security review. **Risks:** R15, R21–R23, R28, R29, R35.

Retain RS256/audience/issuer/expiry/recent-auth/email checks, strict account origins, CSRF and session rotation. Make every durable resource access owner-scoped at the repository boundary. Exercise wrong-character, wrong-account, expired ticket, stale device and replayed token cases. Define provider password-reset/revocation integration; a game device cookie must not silently outlive the selected revocation policy. Preserve guest identity and parked lives during claim/recovery; never clone a wallet to resolve a conflict.

Inventory every feature's retained user data and credentials. Add resumable export/deletion participants for social, growth, world, support, commerce and account records. Keep legally/product-required audit retention as an explicit policy decision; pseudonymize ledger identities and isolate PII. Do not promise comprehensive erasure while feature rows remain.

Review operator roles, secret scopes, key rotation, CSP, dependency lockfiles, artifact provenance, input/body limits and server-controlled outbound destinations. Keep secrets out of URLs/logs/exports. Rate-limit expensive unauthenticated operations before key fetch/crypto/storage where possible. Preserve provider outage caching already present in token verification.

**Acceptance:** authorization matrix denies cross-owner operations. Claim/switch/logout revoke old room authority. Export/deletion covers all inventoried collections. Old operator/provider keys fail after a rehearsed rotation; encryption key migration preserves access only for the intended account. Shared-network legitimate players are not categorically locked out by bot rules.

## W11 — Bound external services and keep real commerce separate

**Owner:** Sol. **Risks:** R25–R27, R38.

Preserve HTTPS, timeout, redirect rejection, server-owned destinations, encrypted account-bound grants and PKCE/state/device binding. Move durable external effects into an outbox with claim lease, delivery ID, bounded retry/backoff and a terminal repair queue. Re-check authorization before applying returned state after a long request. Never hold a database transaction over an external call.

Where a provider supports idempotency, send a stable delivery key. Where it does not, classify a timeout as uncertain and reconcile before retrying. Do not claim exactly-once email delivery. Store revocation failures for retry, rather than forgetting a live grant. Migrate encryption key versions along with ciphertext; evaluate envelope encryption and provider-managed keys before moving grants out of the DO.

Set per-provider concurrency and paid-use allowances, with owner-defined daily/monthly budgets and alert thresholds. Forecast gross charges separately from credits. Alerts alone are not spend caps. Paid relay, email or commerce failure must not stop free core gameplay. Never automatically purchase protection plans or increase provider limits.

Keep Goalmatic/Store Studio authoritative for real orders and providers authoritative for settled balances. Use separate `GameNaira` and real minor-unit types. No game-wallet mutation follows a checkout return. If verified order webhooks are later added, require signature, tenant/order binding, amount/currency checks, replay protection and provider reconciliation.

**Acceptance:** slow/failed providers do not hold core transactions or amplify retries. Duplicate/uncertain callbacks have one recorded outcome. A deleted/revoked account cannot receive a late connected grant. Real checkout/refund does not change game currency. Simulated budget exhaustion stops optional paid calls and raises an alert.

## W12 — Prove release, client and operational behavior

**Owner:** primary verification, bounded Sol/Luna non-UI checks. **Risks:** R30, R31, R33–R35 and final closure for all rows.

Retain existing fast release flow while adding focused checks for changed contracts. Verify the actual release repository/configuration rather than assuming this checkout's CI is the production gate. Bind deployed artifacts to source SHA, protocol version, schema range and environment identity. Keep hashed assets and compatible prior chunks for the supported old-tab window. Smoke signed-in/guest identity, stored balance, room reconnect and one replay-safe operation on the actual target build.

Use an explicitly authorized Worker staging environment. Run tiered mixed traffic with realistic aged data: active/idle players, account churn, popular room skew, transfers, world queries, background settlement and provider failures. Record generator location/limits so generator saturation is not mistaken for server capacity. At each tier run at least 15 minutes steady load plus a reconnect burst; run a two-hour soak at the selected release tier. Those durations are proposed verification requirements, not permission to spend/run them now.

Stop if invariant errors occur, spending exceeds the approved bound, unexpected errors exceed 1% for a minute, or queues grow without recovery. That is an emergency stop threshold; release acceptance still requires unexpected errors below 0.1% over the steady-state window and the README latency gates. All load/failure scenarios remain pending authorized disposable/staging execution. Declare capacity at no more than 50% of the measured saturation point until longer production evidence justifies another margin. A hot room has its own limit even if total concurrency is low. Raising a cap is not acceptance evidence.

Exercise failure points: DB unavailable/full/slow, process restart, lost response after commit, expired identity, duplicate command, outbox duplicate/out-of-order, partial migration, stale binary, expired keys, provider outage, slow consumer and 10× reconnect wave. Compare conservation and ownership checksums before/after. Keep commands rejected under load distinct from lost accepted commands.

On a low-end physical Android and desktop, verify cold/warm entry, constrained network, busy room, city switch, repeated navigation, background/resume, WebGL context loss, memory growth, readable errors and account recovery. Set explicit measured asset/frame/memory budgets per supported scene; reuse existing render tiers/context-loss handling. Proposed minimum is stable 30 fps for the supported low-quality tier, with functional fallback if 3D cannot run. Do not label a desktop emulation as a phone result.

Write incident procedures for overload, exploit, storage failure, provider outage, credentials compromise and bad release. Each needs detection, responsible owner, safe containment, recovery, evidence preservation and a player-facing update draft. External posting remains separately authorized. Define active-player metrics and bot exclusions so page views do not become claimed player counts.

**Done:** every R01–R38 row links its implementation and verification artifact, or states an unresolved blocker. Publish the capacity envelope, remaining single points of failure, restore drill result and budget assumptions. “Never bottleneck” is not an acceptance claim.
