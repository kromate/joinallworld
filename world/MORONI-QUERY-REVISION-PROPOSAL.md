# Moroni source revision proposal

Prepared 9 October 2026. This is source for remote review and fixture execution.
No revised request has run, no Moroni city has been generated, and Comoros is
not admitted to gameplay.

The original selected point remains `[43.240244, -11.704158]`. Its completed
5,965-byte OpenStreetMap response contains no usable building/street pair.
`playable-africa-rollout/moroni-original-source/packet.json` preserves that
response, receipt and spent request ledger byte for byte. The packet SHA256 is
`d2bca4c02dee0a00c3db8a88e70bc54a41e95bc8687a02dc59296cfcea8ca40a`.
It contains public ODbL source data and attribution, with no game saves or keys.

The explicit `--source-query-revision moroni-wide-001` option supports only a
KM-only selection. It retains the same point and uses the fixed bbox
`[43.228244, -11.716158, 43.252244, -11.692158]` with the original OSM map endpoint.
The original cache is read only. Revision state lives separately under
`.cache/world-build/playable-africa-revisions/moroni/moroni-wide-001/`.
Both ledgers share the original two-attempt lifetime ceiling. Exactly one
remaining revision attempt is available, with the existing 8 MiB/45 second
response, 350 building, 160 road and 6,000 point limits. Failure remains charged.

The frozen runner contract and each stable KM plan bind this revision. Resume
uses its frozen selection. Other countries omit the revision field, preserving
their prior contract structure. The old failed contract and its source pins
remain historical evidence and cannot be resumed with changed generator code.

Coordinator review fixed an unconditional null contract field and a fixture
expectation that accidentally discarded the supplied country/city identity.
All four proposed Python files parse with `ast.parse`. No fixture suite or
actual acquisition acceptance is claimed.

Remote validation owns these four source files only:

- `scripts/world/build-africa-starters.py`
- `world/tooling/run_africa_starters.py`
- `world/tooling/test_africa_starter_selection.py`
- `world/tooling/test_run_africa_starters.py`

Run the two existing fixture modules serially in the shared remote heavy slot.
Review reservation durability before any real request: the proposed acquisition
currently reuses the legacy non-atomic JSON writer. Prove the charge survives
interruption before opening the network and that partially published source
state cannot obtain a second attempt. Keep the original public packet immutable.
Check no-follow cache paths, exact query binding, exhausted/malformed ledgers,
default contract shape, and new-run/resume propagation. A passing fixture suite
does not itself authorize replaying or resetting the original request.

After review, restore the preserved original cache into a fresh dedicated
builder checkout only if absent, verify all three packet hashes, and create a
new frozen KM-only contract. Any real acquisition requires the WORLD coordinator
to assign that single remaining attempt and preserve its actual ledger/report.
Do not merge the whole WORLD branch, change Nigeria, edit runtime registries,
raise budgets, or deploy this proposal. The main country-admission work has
priority over this queued source repair.
