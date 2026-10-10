# Country owner-helper fingerprint supplement

**H4: launch remains held.** WORLD discovered and Root independently confirmed this source-only incompatibility in public helper `1968cd84614cf06c89166f605089db611fd91f129a029557ce623c96846e3201`. The original full Astra review remains unchanged; see [exact supplement pins](c12-controller-v3-fingerprint-supplement.json).

The normal venue UI sends activity ID inside payload. Exact c12 `server/protocol.ts:128–130` stores the request fingerprint as the JSON four-field header followed directly by canonical payload JSON. Example: `["cairo","activity",null,null]{"id":"cairo-arrival-info"}`. Helper receiptType at line41 cannot parse that complete string as a single JSON value; activity verification at line52 also parses the full string and then wrongly expects the payload ID in header position2. A legitimate ordinary activity receipt therefore cannot satisfy the current helper.

The same existing Cloud Astra owner must construct and compare the exact full canonical fingerprint using the actual normal UI payload and observed activity witness. Bind city/type/payload/action receipt to natural completion. Preserve gameplay/storage fingerprint format, successful legacy no-payload compatibility and exact-once receipts. No substring, prefix-only or permissive parsing fallback proves completion. Added canonical source/dependency pins require exact bytes. No game API, test, browser, funding or source edit was executed in this review.

The earlier visitor-info example was illustrative and is corrected here to the source-defined `cairo-arrival-info`: Cairo facts ID and the shared content-builder template are independently pinned. No actual browser receipt has been captured.
