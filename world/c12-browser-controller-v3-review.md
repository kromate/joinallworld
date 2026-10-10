# c12 controller v3 and owner helper source review

**MODIFY owner helper; launch held. F1–F4 closed at source-design scope only.**

Packet `b7eea09360e020c30c1ae2cbf22894026c43c7d8`; manifest `2a6292adc64467b017890df4bf2252140586d31c4e06892e09d5b6e977e674d5`. All 11 full files read and hashes/lengths match. Exact available Git source/helper pins match. Numeric711 contract remains SHA `f38bdb14436f78a37516d961159519444ea249755ade95edf1cf43dc88ee7460`.

- F1: Public --run starts independentWatchdog, derives T0 from its Linux PID birth, forks supervisor before pin preflight, tracks exact roots/descendants, samples at 250ms, refuses >500ms gaps/4GiB, aborts missing readiness at 120s and starts emergency cleanup at 890s. fileDigest carries readiness AbortSignal. Owner helper must register with watchdog before SQLite/HTTP. No runtime scheduling, cold-import latency or cleanup performance is proved.
- F2: Cdp.call clamps timeout to 10000ms. Screenshot has separate token-bound 15000ms deadline, forwarded to independent watchdog and checked after bounded PNG decode/write. Runtime IPC latency and cancellation remain unproved.
- F3: Single page navigates A then B then A before onboarding; each requires actual Document status200 and loopback remote address/port, and both cookie stores remain empty. Later A cookie present/B absent check retained.
- F4: Return now enters normal Home navigation, chooses/waits an offered local route if needed, checks original home heading plus Private venue line and PNG, then owner requires Lagos/location home/no active action/owned protected state before completion. Exact c12 arrival.test.ts states resident return already lands at home; the new observation also covers that case. No live visual evidence claimed.

## Remaining concrete fixes

### H1 P1 — Funding target is not bound to authenticated browser actor/account identity

world-owner-mailbox.v1.mjs snapshot(), protectedFields(), fund(); controller capture-baseline-and-fund-once request. snapshot scans sessions by name, returns column public_id but discards session publicId/account/expiry and device/account relationship. fund accepts that match using name, cash and home, without a private public-ID witness from the normal browser session. protectedFields checks name/ID/home assets only. No explicit A/B identity inequality is enforced. Exact c12 SessionRecord distinguishes guest secret from account-owned session reached only through accountDevices; display name is not the authority.

Required change: For this fresh guest-only scope, bind each origin to its normal authenticated public ID using a reviewed read-only normal-session response witness; keep that ID private. Query that ID, validate stored publicId equality/current guest status/live expiry/current character, record protected identity metadata and assert A != B. Reject account-owned/device-bound ambiguity rather than adding provider login/cookie injection. If account actors are intentionally supported, validate account/session/device authority explicitly without publishing secrets.

### H2 P2 — Protected-state and cross-actor claims exceed the comparisons performed

world-owner-mailbox.v1.mjs creditProof(), fund(), observeActor(), verify-city-home-checkpoint. creditProof verifies money/audit/prefix effects but never compares protectedFields(after) with baseline before returning verified funding. Later homeProof compares only the active actor. observeActor for completed A during B checks its ID but not its protected state or wallet/receipt snapshot; no final comparison proves B funding/journeys left A unchanged.

Required change: Before issuing successful funding proof compare protected identity/home/ownership/inventory immediately after first credit and replay. Freeze each completed actor checkpoint and compare it during/after the other actor funding and at finalization, with only explicitly explained normal settlement fields excluded. Keep raw baselines private.

### H3 P2 — Restart can be dispatched after the new-action cutoff

world-owner-mailbox.v1.mjs one-exact-sigwinch-restart handler. Main-loop guard() is nonmutating. Handler performs synchronous snapshot/home/control and durable intent work, then process.kill without guard(true) at dispatch. Unlike funding POST, restart has no immediate actionDeadline check. A request admitted just before cutoff can signal after it; subsequent guard/failure does not undo the restart.

Required change: Call guard(true) immediately before the signal after intent persistence and revalidate exact PID birth. If cutoff has passed, retain intent as unexecuted and return partial; never renew or send substitute signals.

## Money, privacy and launch evidence

- Read-only SQL is explicit (DatabaseSync readOnly, SELECT and BEGIN/COMMIT). No raw save writes, DDL, minting or browser action APIs are present. Store discovery checks seven table names and version2; strengthen/read-only verify current main_store_authority and required columns before claiming full schema validation. Current SQL failures are conservative refusals, not permission to repair a store.
- Funding intent is written wx and fsynced with directory before POST. Exactly 2000000, root /api/admin/me, scoped admin POST, same payload/clientId replay and readback one wallet/audit/receipt are present. On ambiguous first transport, original state must prove success before replay; unavailable proof stops without a fresh intent. Replay transport ambiguity also stops. No auto helper restart is authorized.
- Actual admin route c12 uses ctx.once on caller.session and fingerprint [target,action,params,reason]. creditProof queries the unique clientId and kind but does not compare receipt sender/fp to authenticated root identity/intent; tighten that evidence linkage rather than claiming those fields were validated. UUID and matching audit/target/money strongly constrain ordinary accidental mismatch but are not a substitute for explicit authority checks.
- Private output uses 0700 directory/0600 regular files with no-follow bounded reads, and safe public publication compares an exact allowlisted object. Full session rows, baselines, cookie/control and request envelopes remain private; name-scan currently reads unrelated session values into memory, so ID-scoped lookup also reduces unnecessary private reads.
- Owner restart uses one exclusive durable intent, exact PID birth, actual helper event count1, same port/store/deadline, root readiness and SQLite inode plus saved receipts. Original stage helper and numeric720/900/120/60 bounds stay pinned. Root must prove actual terminal process absence before releasing leases.
- Quota freshness now requires observed_at_utc <=60s and >4 percent plus live owner commitment. Current false NOT-APPROVED bindings are correct; do not fabricate approval/time/live usage.
- Remaining runtime proofs: all remote binary/package/ws pins, accepted independent28e guard/seal, actual leases/processes, owner-ready/auth/schema, bounded request cancellation/HTTP behavior, visible controls/overlays, activity witnesses, natural expiry and cleanup. Syntax receipt is preparation evidence only.

## Exact executable pins

- astra-controller/country-controller.v3.mjs: `4d31fbf5ab809953a2f44d0bed671db6d55f4f954ff6fc1e5ab5763251347042` (62346 bytes).
- astra-owner-helper/world-owner-mailbox.v1.mjs: `1968cd84614cf06c89166f605089db611fd91f129a029557ce623c96846e3201` (27428 bytes).

Read all 11 manifest files, including full 60-line owner helper, plus selected exact c12 authority source. No reviewed executable, syntax check, tests, build, browser, SQLite connection, network, funding, restart, source edit or new agent. Only requested /tmp review files written. Existing WORLD remains sole owner. No launch authority derives from this report.
