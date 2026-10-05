# Worker adapter contract

This adapter consumes the portable route and socket registries of the game. It does not maintain a second implementation of social, civic, onboarding, world, growth, campus or gameplay rules, and it builds the server context from the same helpers as the Node host (`server/host-context.ts`). Account endpoints remain inert; operator routes exist only when the `MODERATOR_TOKEN` secret is set.

## Persistence and failure boundaries

The existing `JoinAllworldState` class, `joinallworld-v1` object name and existing session/receipt tables are retained. `collections` is an additive table for shared feature namespaces. Each store callback receives a fresh transaction-local view. Callbacks serialize; asynchronous feature callbacks finish before the synchronous SQLite transaction starts. Session, feature namespace, archive and receipt mutations commit atomically. Receipts stay in their own tables — `action_receipts` for game actions and `once_receipts` for every other exactly-once write (`ctx.once`) — and the shared 24-hour window and the per-player and server-wide quota refusals remain authoritative (the server-wide count is taken from the table). Legacy inline receipts migrate into rows without changing their fingerprints. A collection larger than one row is split over `collection_parts` and written with the rest of the transaction. The world's per-local-government shards are rows of `world_shards` written through the same shard store as on Node (`server/world/shard-core.ts`): a cold shard reads that one shard's rows once, at most eight are held in memory, and an append is one SQL transaction.

Every write waits for `storage.sync()` before its commit callback and response. This is deliberately stronger than Node's optional lazy persistence. SQL/callback failure discards the draft and produces no successful response or commit effect; a failed commit is answered `503 storage_unavailable`. While the object is starting the barrier is not waited for: nothing can be acknowledged then, and it cannot complete inside the start-up gate. A failed durability barrier has an uncertain persisted outcome: the instance refuses further store access until restart; a retry uses the persisted receipt. It does not claim to undo a completed SQL commit. Internal storage error details are not returned to clients.

Commit results retain non-enumerable symbol metadata. Shared social modules use it for block and visit revocation effects; JSON cloning would silently lose those effects. Such metadata never enters JSON responses.

## Socket boundary

Optional `restore` hooks (rooms, social presence, the world's online counts) reconstruct the in-memory registries from private hibernation attachments; a restored room socket is marked for re-checking, so its next room message is admitted only if the stored life still allows it. Attachments retain room, position, voice and watch state; secret session IDs remain host-private. Stored sessions and room permissions are rechecked before messages. Joining uses the shared committed-admission handler. Movement changes attachments, not wallet rows. Room chat uses a host receipt seam storing only ID/time/body digest, retaining dedupe over hibernation without storing room-chat text.

The Worker sends an application heartbeat because its hibernating socket API does not expose Node's ping/pong interface. All three browser socket clients (community, social, tables) answer `heartbeat-ack`; this does not enable capture. Idle/expired connections close on alarms. The alarm runs every ten seconds while a socket is connected and every five minutes otherwise, raising the modules' `heartbeat` event either way (due mail and push, registry tidying, table clocks). A table with someone seated keeps an ordinary timer pending so the object is not put to sleep under it. Existing old client tabs should reload with the candidate assets for this heartbeat contract.

## Intentional differences

- Keys the server makes for itself (push, link signing) are rows of `host_keys`, not files.
- `ctx.fetch` cannot ask the runtime to fail on a redirect: it does not follow one and rejects the answer.
- Long-window and protected rate limits are durable rows; short windows (a minute or less) are counted in memory and start again with the object. The operator's own budget is never locked out by a flood of other keys.
- Addresses are kept only as a digest of `CF-Connecting-IP` (IPv6: its /64).

- Worker uses durable SQLite transactions for every write that acknowledges something; nonmaterial writes (the ones Node may defer) are held in memory and written within ten minutes, or with the next durable change that read the same session or collection.
- Worker hibernation restore hooks and digest-only room-chat receipts are host-specific. Node keeps its existing in-memory room-chat history.
- Missing live voice-room membership now follows the shared recovery contract: HTTP 403 `room_membership_required` (old edge used 409).
- Health retains edge `buildId`/`transport` fields alongside shared `build`.
- Existing relay bounds/provider adapter remain; the live test allowance must stay disabled. Local provider tests use a synthetic intercepted endpoint only.

## Verification and staging scope

The deployment owner's external evidence folder records exact commands/results. `deploy/sqlite-store.test.ts` injects SQL and durability failures. `deploy/cloudflare.test.ts` runs Miniflare, Node/Worker sequence comparison, SQL debit/feature rollback, restart/hibernation and authority checks. No full feature or capacity equivalence is claimed from these bounded sequences.

A local esbuild process stalled in this environment. The explicit test-only `JOINALLWORLD_BUNDLER_ROLLUP=1` switch uses Rollup to bundle the identical Worker source into Miniflare. Vite's native config loader produced the real assets. These results do not replace the normal pinned esbuild/Wrangler CI/package gate.

Intended next scope is independent review, integrator acceptance of the portable hooks/heartbeat changes, exact-source packaging CI, then controlled recovery evaluation on the existing unadvertised `joinallworld-next` staging host. No apex/v1 origin change, new credential, account, provider mint or billing change is included. Actual hosted recovery/guest-room/transport acceptance remains separate.
