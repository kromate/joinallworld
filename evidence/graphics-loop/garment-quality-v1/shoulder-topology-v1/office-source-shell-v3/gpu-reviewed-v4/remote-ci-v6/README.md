# GPU source-corner comparison v6 — bind-transform diagnosis (prepared, unexecuted)

This immutable closure pins the separate v4 fixture and v6 remote runner. No local or remote build, browser, test or GPU execution was run. v3/v5 and all prior receipts remain unchanged.

The v5 run passed attribute replay but exposed a bind-mode mismatch. The new fixture emits finite matrix witnesses for raw parse and fitted displayed actor: local/world, bind matrix, raw/current inverse and each inverse against Three's actual bind-mode equation. It checks ordered bone names and every inverse-bind matrix. It requires same bind mode, local matrix and source bind matrix, exact bone-name/inverse-bind identity, and exact canonical inverse relations, but reports the expected raw-versus-fitted inverse delta rather than treating it as an unexplained equality condition.

The recipe keeps the 220 MiB / 25 second bundle and 1,280 MiB / 60 second browser limits. It uses the bounded 1.25-second empty/zombie-only RSS drain after a positive sample. A fixture `loadFailure` is now detected immediately by the CDP runner, so a failed load does not spend the remaining comparison timeout. All source signatures and screenshot/shader guards stay in place. Any successful run remains diagnostic only, not visual or phone-performance acceptance.
