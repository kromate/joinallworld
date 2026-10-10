# c12 v4 source review

**ACCEPT SOURCE DESIGN for the corrected H1–H4, authority and root-receipt scope. No launch authorization.**

Public packet `8bceca5f586ca4b619759bb778dd142151b08302`; manifest `5d553c9c9da5e32bf95afc5d3b2939a2bf1e30d9375b4b5eff5ec83685103f61`. All 14 manifest hashes/lengths match. Prior V3 packet `b7eea09360e020c30c1ae2cbf22894026c43c7d8` is preserved. Contract711 caps and stage/browser arguments are unchanged.

- H1: Controller passively observes existing normal onboarding POST /api/session response, checks loopback/status/port/bounded body and captures public ID privately. Origin A/B IDs must differ. Every actor request carries guestPublicId. Owner queries exact public ID, checks SQL and serialized ID/name/secret/expiry consistency, live guest expiry, absence of account/device binding and unambiguous current character. Name is no longer identity authority. No new browser request, copied cookie or account login is introduced.
- H2: creditProof compares protectedFields immediately after original credit and exact replay. allProtected surrounds owner handlers and credit readback, preserves original/funded receipt-wallet-ledger prefixes and compares inactive actors to frozen cash/home/history checkpoints. Completed checkpoints are durable. Final allProtected(null) records explicit success/failure before DB closure. Primary Lagos residence while away is read from actual estate.away.lagos; ordinary time/needs/session renewal are not falsely held immutable.
- H3: After durable one-SIGWINCH intent, mutating guards recheck quota/action deadline, exact control/source/package/storage, writable authority and PID birth immediately before process.kill, with no intervening await. Cutoff refusal keeps intent without sending a replacement signal.
- H4: Controller passively captures the normal activity POST envelope and binds one actionId and identical retries. Helper requires payload.id matching the naturally observed action, reconstructs the exact canonical concatenated full fingerprint and existing 96-character bounded form, and compares the exact successful receipt ID. Obsolete JSON.parse of concatenated stored fingerprint/top-level activity ID inference is removed.
- AUTHORITY: Read-only fullSchema checks canonical tables, columns, indexes, schema version and migration rows. Repeated authority checks require actual fresh writable epoch1, no retired epoch/watermark. No schema repair/write path is introduced.
- ROOT_RECEIPT: Same authenticated root cookie supplies admin/me plus normal session public ID; read-only session/account and shortRef agree. Persisted credit intent includes this root binding. Actual receipt sender, kind, timestamp and canonical bounded [target,credit,{amount:2000000},reason] fingerprint, plus audit admin account, must match. One fsynced original intent and identical replay remain; ambiguity stops without a fresh ID.

## Exact executable pins

- astra-controller/country-controller.v4.mjs: `b92773045ea16f20f9e7f92e18aca0901dbb791a6e5e43bcb93f1ca52b759fce` (65342 bytes).
- astra-owner-helper/world-owner-mailbox.v2.mjs: `1f9b26b4182354e931ec81b81061f0158158007e7c87b5c15e3ca961523126ba` (36276 bytes).

## Qualification

- Acceptance is limited to the corrected source design and old H1-H4/authority/root-receipt scope. F1-F4 source-design closures remain unchanged. No runtime action or five-city pass is claimed.
- Both current proposals remain approved:false and launchAuthorized:false. This report is not a live binding or instruction to launch. WORLD remains sole stage/funding/restart owner; actual quota above4, named approval, exact runtime pins, leases and process handles are still required by the unchanged contract.
- Actual normal session/activity response capture, schema/root authentication, owner timing, successful once replay, natural action witnesses, output/resource caps, screenshots and cleanup require the finite authorized run. Any unavailable observation yields partial/refusal, not reset, regrant or relaxed caps.
- Root finalization must inspect owner-terminal allExistingActorsFinalProtectedReadback and status alongside controller/watchdog receipts, natural stage expiry and every owned process absence before accepting or releasing leases. A controller journey-complete-pending label alone is insufficient.
- Private public IDs, session-key hashes, actor/owner baselines, intents, DB/control and normal-request witnesses remain private. Public packet contains source/proposals only. No raw credentials or state should be copied into public receipts.
- No reviewed code, node --check, tests, build, browser, HTTP, SQLite connection, funding, restart, network, source modification or new agent occurred in this review.
