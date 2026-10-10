# c12 controller source review

**Verdict: MODIFY. Launch remains held.**

Publication `c41e7d732fab4d24e038cd314bcbfc6b5bed45b0`. Controller `214e77832e8b8d09cb4ecfa0c2565f52fabc1ec20dd3803a67c96efc2c74decf` (51913 bytes). Pin map `88e6552f906c5648eaf5143502c70f6d545fb0aec591260abca75c802dc4210b`.

Contract `711aac363b4f3315e8a236a9d1acd5b0d52b7b2a` / SHA-256 `f38bdb14436f78a37516d961159519444ea249755ade95edf1cf43dc88ee7460` is byte-identical to the published copy. All 32 locally available Git pins match (25 c12 source files and 7 helper files); 30 remote environment/receipt pins remain runtime prerequisites. Independent package `28e4f93df5e608b63d3d862173b03b418d70c141803de7f69a6ed836ffb5030d` remains distinct from the earlier Mac package.

## Required fixes

### F1 — P1: Preflight is outside enforceable phase and resource termination

Controller lines 66-71, 167-177, 203-217. The early sampler records earlyFailure but does not abort verifyReview. Streaming pin hashes have no timeout/cancellation. The 120-second elapsed check and full phase monitor are installed only after verifyReview returns. A stalled read can exceed both readiness and complete-phase bounds before any termination path exists.

Required change: Start a trusted bounded watchdog at first owned launch, covering preflight and all descendants. Make pin reads cancellable within the remaining readiness budget; on sampler/resource failure terminate only the recorded owned process group and preserve partial evidence. Do not rely only on the monitored event loop to enforce its own stalled-loop deadline.

### F2 — P2: Screenshot overrides the 10-second CDP command cap

Controller lines 316, 363. Page.captureScreenshot passes CAP.screenshot (15000) as the Cdp.call timeout, replacing the default CAP.cdp (10000). The contract requires both limits.

Required change: Cap every CDP command at 10 seconds and enforce a separate 15-second end-to-end screenshot operation budget.

### F3 — P2: Both browser origins are not resolved before onboarding

Controller lines 432-461. The initial proof is OS localhost lookup plus empty cookie queries. Actual Document remote-address/status checking occurs in navigate inside the per-actor loop. B navigation happens after all A journeys, so A can be created and funded without the required B browser-entry preflight.

Required change: Navigate the one owned page normally to both approved origins and verify actual loopback Document responses and cookie separation before either onboarding. Return to A normally; do not inject or copy sessions.

### F4 — P1: City completion lacks rendered owned-home arrival evidence

Controller lines 469-473; owner-mailbox-schema verify-city-home-checkpoint. The loop returns by flight to Lagos, checks wallet and protected-state/prefix booleans, and immediately appends city to completed. It does not navigate from the Lagos arrival venue to the owned home or assert a rendered home venue/location. Preserving home ownership is not proof of home arrival.

Required change: Complete the ordinary local homeward UI route after the return flight, wait its natural duration, capture the rendered owned-home arrival and require a matching owner location witness before city completion/restart. If the intended acceptance is only home-city airport arrival, explicitly narrow the contract and result label; do not claim the current full home step passed.

## Approval prerequisites

- Revised immutable controller hash and pin map; named WORLD and Integration/Astra review approving those exact bytes. Current NOT-APPROVED proposal is not launch authority.
- Current owner quota observation above 4 percent tied to the launch approval. quota() checks values only; approvedAt is fresh but does not establish when policy usage was measured. Add an explicit observation timestamp/max age or a fresh owner attestation and live policy update responsibility.
- Actual remote verification of the remaining 30 cloud binary, ws, artifact and receipt pins, clean exact c12 source, existing Chromium/Node capability, package guard and accepted independent 28e seal. Local Git matching is not that runtime proof.
- Actual heavy/server/browser lease ownership, process birth/group identities, stage deadline and aggregate resource measurements, published before first browser action. No launch or live handle is established by this review.
- Named owner available for the private request-bound mailbox and authenticated funding/restart procedures. The schema is a trust contract, not an executable implementation or proof of route results.
- Actual operator assignment is a requested gpt-6-astra/high binding; backend model ID is not exposed. Preserve that distinction.
- Exercise or otherwise establish browser HTTP timeout cancellation for pending requests and mutations, CDP timeout cleanup, output-limit abort, and descendant absence under the eventual authorized run. Source alone cannot certify these behaviors.

## Safeguards supported by source

- Source/package are exact c12 and separate independent 28e candidate; no Mac 3a artifact equivalence or Forbidden bypass is asserted.
- Fresh private store/profile, one page, distinct loopback origins, normal input actions and hit tests; failed controls remain partial. No direct game action API, session injection or Mac state import in browser journey.
- Funding is delegated to the named owner with one persisted intent and identical replay, required one-effect/receipt/audit counts, unchanged replay balance and protected baseline hashes; no retry with a fresh credit intent.
- Restart request binds original helper PID/store/port/deadline and exactly one SIGWINCH. Successful reconnect requires ordinary navigation plus owner state witness; no timer renewal.
- Private files use bounded regular-file reads, no-follow and owner/mode checks; public facts are allowlisted. Cookie content is read into private process memory only for presence checks, not emitted or injected.
- Owned PID/start identity and descendant tracking constrain emergency signals. Natural expiry, stopped same-store control and actual child absence are required; emergency cleanup is partial and controller exit/lease release remain owner responsibilities.

## Limits of this review

- No code execution, syntax check, build, browser, stage, network request, funding, restart or deployment was performed. No resource performance or five-city acceptance is claimed.
- The 16 MiB public/structured output limit has accounting and fail-closed acceptance, but raw child output continues to be consumed/discarded after its stricter aggregate threshold while the helper may wait for natural expiry. Clarify discarded-byte versus retained-output accounting and require bounded cleanup; do not advertise a hard producer-output cap.
- Normal onboarding defaults and current UI overlays can still cause conservative partial results; selector/source review is not runtime success.
- This report approves neither launch nor production. Re-review revised controller bytes rather than treating these findings as permission to modify shared source.

Full file hashes and seven helper pins are in the companion JSON. Only these two private review artifacts were written. No owned runtime resources were created.
