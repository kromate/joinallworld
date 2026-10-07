# Reliability implementation tracker

This file records what is implemented in this checkout. It is not evidence of deployment or production behavior.

## A1 — player-wallet correctness

Implemented locally:

- `activity.completed` carries the amount the wallet actually credited. Transferable earnings and career pay displays use that amount rather than recomputing the advertised reward.
- A persisted life with a null, missing, negative or unsafe cash balance is refused with `economy_unavailable` before settlement mutates it. A genuinely absent life still receives the new-life default.
- An authenticated quarantined player can still file and retry a support report. Its operator context explicitly says `economy_unavailable`, carries `life: null`, an empty ledger and bounded action metadata, and never repairs, defaults or copies the corrupt save. The recovery HUD links to support, while offline, expired and unauthenticated forms remain disabled.

Focused proof: typecheck clean and the A1 effects, career and integration selection passed 47/47. The focused support backend, operator and component/model regression selection passed 31/31.

## A2 — player-wallet audit history

Implemented locally:

- Every player-wallet `credit` and `debit` can emit an exact effect into a server-owned, transaction-local collector.
- Node persists effects in the same JSON commit as the life and forces monetary transactions durable. This fallback is for local development: its append-only `walletEffects` array grows without bound and rewrites as part of the JSON document.
- Worker SQLite appends effects in the same transaction as sessions, receipts, archives, collections and per-entry collection writes. Effects bypass the no-change and lazy-held branches, including a net-zero sequence whose bounded display state ends where it began.
- New peer transfers share one stable audit ID across sender debit, immediate or pending recipient credit, and refund. Historical pending gifts are not assigned invented IDs.
- `GET /api/support/history?after=<seq>` returns only the authenticated character's effects, 50 rows plus one lookahead. SQLite uses the `(public_id, seq)` index; the Node fallback uses its append order.
- Statement exposes recorded history by explicit request. It keeps one 50-row page, resets on public identity change, and ignores late responses from an old identity.

Focused acceptance command:

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 600000 -- bash -o pipefail -c 'npm run typecheck && node --experimental-strip-types --test server/economy/effects.test.ts server/economy/history.test.ts server/social.test.ts server/store.test.ts deploy/sqlite-store.test.ts deploy/sqlite-entries.test.ts src/app/features/money/statementHistory.test.ts src/app/features/panelsA.test.ts'
```

Result: typecheck clean; 90/90 combined focused tests passed, followed by the final additive SQLite migration check at 20/20. Full log: `/tmp/allworld-a2-focused-rerun.log` on the implementation host.

## A3 — uncertain public actions and reconnect recovery

Implemented locally:

- Before sending a public action, the client persists its exact canonical body, server-time action ID, city and public character ID. A browser-storage failure sends nothing.
- A reload or response loss exposes an explicit retry of that same body and ID. The client never replays it automatically and blocks a different action while its outcome is unknown.
- Parsed action outcomes clear the intent. Network failures, unknown 5xx responses, `storage_unavailable`, `server_busy`, rate limiting and 401 responses retain it. A newly accepted public identity drops an intent owned by the prior identity.
- A crossed, older retry response can settle the pending intent without replacing a newer accepted life revision. Existing capacity refusal fields and the target client's wake, catch-up and sent-ID tracking remain in use.
- An identity generation fences the full action await, including response metadata, errors and asynchronous city-rule loading. A late response from character A cannot overwrite character B, clear B's pending intent, expire B's session or mark B offline.
- The public action route checks an existing receipt before the city gate. If no receipt exists and the character has moved, it atomically records a normal `city_moved` refusal with the current city's state and revision. Whichever request wins serialization becomes the terminal outcome for that action ID; payload and server-authority conflicts remain 409 errors, and room membership validation receives the actual current city.
- Action and life cooldowns are route-scoped. An unrelated support or account 429 does not freeze gameplay commands; `server_busy` still applies a bounded shared-core cooldown.
- Community and table reconnects use bounded full jitter. Ordinary retry counters reset only after a stable authenticated join, while the community capacity-close branch and delta protocol remain intact. Stale table socket callbacks cannot replace the current identity's state.
- The HUD shows the pending action ID and offers explicit same-action retry without eagerly importing another panel. `economy_unavailable` has a distinct recovery connection state.

Focused acceptance command:

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 600000 -- bash -o pipefail -c 'npm run typecheck && node --experimental-strip-types --test server/recovery-action-intent.test.ts server/recovery-command.test.ts src/client.test.ts src/app/state/game.test.ts src/app/features/models.test.ts src/community.test.ts src/tables/client.test.ts src/app/components.test.ts'
```

Result: typecheck clean and 74/74 focused A3 tests passed. Full log: `/tmp/allworld-a3-focused-final.log` on the implementation host.

Primary review also proved a full recovery reload: `GET /api/session` restores the same public identity, the corrupt `GET /api/life` remains read-only, and the real client can file support without sending `POST /api/session` or `/api/action`. Result: 1/1 in `/tmp/allworld-recovery-support-client.log`.

## A4 — local SQLite schema and main-state write authority

Implemented locally, with no public retirement route or production activation:

- The main SQLite store boots through an atomic application-schema registry. The legacy unversioned database upgrades additively to schema 2 while preserving current sessions, receipts, accounts, collections, per-entry rows and projection columns, `store_meta`, layout/safety metadata and wallet effects. The unused `action_expiry` index remains deliberately removed. A newer or incomplete declared schema is refused before the store is usable; a failed migration rolls back its schema records and resumes cleanly.
- One persistent authority row records the main-store epoch, writable state, retirement source epoch and wallet-effect watermark. Every ordinary write checks the instance epoch before its callback and again inside the final SQLite transaction. An in-flight callback from another instance cannot commit after retirement.
- Retirement is an expected-epoch compare-and-set. It first writes and syncs this instance's held baseline, then atomically marks the store read-only with `MAX(wallet_effects.seq)`, cancels the lazy flush timer and crosses the durability barrier. Retrying the same expected epoch is idempotent; a stale epoch is refused. An uncertain barrier fails closed until reopen.
- Held flushes, normal commits, layout preparation/backfill, migration tools, reverse layout changes and safety-copy writes share the authority check. A retired reopen remains readable, skips write-producing preparation and does not restart a flush loop.
- Worker world-shard append, replacement and metadata writes call the main-store assertion inside their SQLite transaction. The real Worker always supplies this guard; standalone shard backends may omit it for isolated use.

Focused proof: typecheck clean; 51/51 store, entry-layout, projection, migration, retirement, shard and recovery-boundary tests passed in `/tmp/allworld-a4-focused.log`. Three focused persisted-Worker checks also passed, including the row budget and layout restart path, in `/tmp/allworld-a4-worker.log`.

## Integrated startup boundary

- Lagos startup no longer groups unused Abuja, Kano and Port Harcourt link modules into the authored-route chunk.
- Full statement reconstruction moved out of the eager wallet view into the lazy Statement screen/server helper. The eager view retains cash and newest-first recent ledger lines; statement arithmetic, server comparison and rendering remain covered by the focused wallet, panel and support tests.
- The measured startup is 614,121 raw bytes, 222,522 gzip bytes and 194,695 Brotli bytes after the cross-identity snapshot mask and direct recovery-support route. The reviewed raw-only ceiling is 615,000 bytes (0.99% above the former 609,000 limit); gzip remains 223,000 and Brotli remains 195,600. First-paint, scene/render and Worker size limits are unchanged.
- An isolated `7d08e8b7` snapshot reproduced nine engine-contract failures (17 passed, 9 failed) in `/tmp/allworld-engine-baseline.log`. Their stale registration order, optional-field and authored-stop expectations were corrected against current contracts without weakening assertions; the engine contract now passes 26/26 in `/tmp/allworld-engine-contract-fixed.log`. The ownership-mask client, support and UI-focused selection passes 86/86 in `/tmp/allworld-owner-mask-final-focused.log`.

## Boundaries still open

- This is player-wallet effect history, not a balanced double-entry ledger. Government treasuries, tax appropriations and other political accounts are a separate currency/audit scope and are not covered by the player history endpoint.
- Existing cash has no opening checkpoint, so history is explicitly labelled as beginning when recording was enabled. Earlier balance changes cannot be reconstructed from the bounded statement.
- Fixed-deposit cash movements are captured, but the locked principal is not represented as a separate audited liability. Loan and other debt balances are not journal accounts; only their player-cash repayments appear as wallet effects.
- There is no repair workflow, source taxonomy, policy-version ledger, aggregate supply report or historical backfill in A2.
- A4 fences the main application store and world shards only. Worker operational tables remain outside this authority: persistent rate-limit classes and expiry cleanup, `turn_budget`, `call_relay_budget`, `chat_receipts`, `host_keys`, and `chat_images`. Durable Object alarms and WebSocket hibernation attachments are also outside it. They require their own migration/cutover contract before any claim of a full-object fence.
- The gate cannot stop binaries that predate it. Rolling an old binary back after this schema or authority is active remains prohibited.
- No public retirement endpoint, production cutover, schema activation, provider change or PostgreSQL runtime exists in A4. Phase B scale work remains separate.
- No production deployment or database cutover is established by these local checks.

## Release acceptance — 8 October 2026

The final source typecheck and 86 focused checks passed. Engine contracts passed 26/26 and the impacted home/protocol selection passed 52/52. Built download checks, 15 source smoke checks and the five required Worker release checks passed. Full exhaustive testing was not run.

Browser acceptance used disposable local players: recorded wallet history rendered; the server statement reconciled; switching to a quarantined identity hid the prior balance and scene; support produced receipt P-1 while preserving the corrupt stored value; fresh guest Play now reached Freedom Park. Messages recovered after a simulated HTTP failure. A 12-second browser lifecycle pause resumed with successful life requests. These are desktop checks including a mobile viewport, not physical-phone or production proof.

The raw startup allowance was reviewed from 609,000 to 615,000 bytes for the recovery and ownership checks. Measured startup: 614,121 raw, 222,522 gzip and 194,695 Brotli bytes. Compressed-download, first-paint, scene and Worker-package limits remain unchanged. Further speculative startup refactors were stopped.

The recovery phone header can still show generic No service/battery wording although support is reachable; this is a cosmetic follow-up. The wider Phase B programme remains pending. The user requested conserving remaining AI usage, so this release checkpoint does not claim completion of PostgreSQL cutover, room partitioning, capacity or physical-device acceptance.
