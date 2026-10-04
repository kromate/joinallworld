# Recovery Worker adapter contract

This adapter consumes the portable route and socket registries from the recovery source. It does not maintain a second implementation of social, civic, onboarding or gameplay rules. Account endpoints remain inert; moderator routes remain disabled.

## Persistence and failure boundaries

The existing `JoinAllworldState` class, `joinallworld-v1` object name and existing session/receipt tables are retained. `collections` is an additive table for shared feature namespaces. Each store callback receives a fresh transaction-local view. Callbacks serialize; asynchronous feature callbacks finish before the synchronous SQLite transaction starts. Session, feature namespace, archive and receipt mutations commit atomically. Receipts stay in their own table and the shared 24-hour window/cap refusal remains authoritative. Legacy inline receipts migrate into rows without changing their fingerprints.

Every write waits for `storage.sync()` before its commit callback and response. This is deliberately stronger than Node's optional lazy persistence. SQL/callback failure discards the draft and produces no successful response or commit effect. A failed durability barrier has an uncertain persisted outcome: the instance refuses further store access until restart; a retry uses the persisted receipt. It does not claim to undo a completed SQL commit. Internal storage error details are not returned to clients.

Commit results retain non-enumerable symbol metadata. Shared social modules use it for block and visit revocation effects; JSON cloning would silently lose those effects. Such metadata never enters JSON responses.

## Socket boundary

Three optional restore hooks reconstruct room and social-presence registries from private hibernation attachments. Attachments retain room, position, voice and watch state; secret session IDs remain host-private. Stored sessions and room permissions are rechecked before messages. Joining uses the shared committed-admission handler. Movement changes attachments, not wallet rows. Room chat uses a host receipt seam storing only ID/time/body digest, retaining dedupe over hibernation without storing room-chat text.

The Worker sends an application heartbeat because its hibernating socket API does not expose Node's ping/pong interface. Both browser socket clients answer `heartbeat-ack`; this does not enable capture. Idle/expired connections close on alarms. Existing old client tabs should reload with the candidate assets for this heartbeat contract.

## Intentional differences

- Worker uses durable SQLite transactions for all writes; Node may defer nonmaterial writes.
- Worker hibernation restore hooks and digest-only room-chat receipts are host-specific. Node keeps its existing in-memory room-chat history.
- Missing live voice-room membership now follows the shared recovery contract: HTTP 403 `room_membership_required` (old edge used 409).
- Health retains edge `buildId`/`transport` fields alongside shared `build`.
- Existing relay bounds/provider adapter remain; the live test allowance must stay disabled. Local provider tests use a synthetic intercepted endpoint only.

## Verification and staging scope

The deployment owner's external evidence folder records exact commands/results. `deploy/sqlite-store.test.mjs` injects SQL and durability failures. `deploy/cloudflare.test.mjs` runs Miniflare, Node/Worker sequence comparison, SQL debit/feature rollback, restart/hibernation and authority checks. No full feature or capacity equivalence is claimed from these bounded sequences.

A local esbuild process stalled in this environment. The explicit test-only `JOINALLWORLD_BUNDLER_ROLLUP=1` switch uses Rollup to bundle the identical Worker source into Miniflare. Vite's native config loader produced the real assets. These results do not replace the normal pinned esbuild/Wrangler CI/package gate.

Intended next scope is independent review, integrator acceptance of the portable hooks/heartbeat changes, exact-source packaging CI, then controlled recovery evaluation on the existing unadvertised `joinallworld-next` staging host. No apex/v1 origin change, new credential, account, provider mint or billing change is included. Actual hosted recovery/guest-room/transport acceptance remains separate.
