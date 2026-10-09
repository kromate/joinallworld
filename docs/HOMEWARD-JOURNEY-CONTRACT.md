# Homeward recovery for visitors

Status: implemented source with focused engine, Node HTTP, SQLite Worker and Vue SSR acceptance. Actual disk/SQLite rollback and corrupt-record acceptance now pass; full combined, interactive rendered, timetable-change and production acceptance remain open. No production activation is authorized by this document alone; WORLD retains the existing coordinated release process.

The first-five integration exposed a real recovery gap. Direct-only ride credit cannot take a cashless foreign visitor to a main home without an airport. Lending only the first connection's fare also fails: existing debt prevents the next booking. A fictional direct flight cannot substitute for real links, and the legacy direct-trip invalidation refund must not convert borrowed fares into spending cash.

The recovery journey must use one explicitly accepted, versioned ticket composed of available real links. Its route starts in the current city and finishes at the unchanged original `estate.home`. The planner chooses the cheapest deterministic cycle-free path of at most four legs, with safe whole-number fares/times and the existing total loan ceiling of ₦1,000,000. Modes, prices and times come from actual route definitions. The quote identity binds its version, origin, home and every leg's endpoints, mode, fare and duration.

Before acceptance, the UI must show every connection, total borrowed amount, repayment terms and the absence of cancellation/skip after departure. The authoritative action recomputes the offered quotation inside the actual once-only booking transaction. Missing, malformed or changed quotations refuse without financial or travel effects, return the new offer and require another click. Transport retries keep the same intent and accepted payload. A changed quote under an already successful intent must conflict rather than create another loan.

Booking records the full ticket, paired advance/debit, debt, active journey, wallet effects and receipt atomically. Spendable cash is unchanged. Existing debt refuses a new booking and is never overwritten. Transfers form one continuous busy journey; an intermediate hub does not become a free playable stop or a second loan opportunity. Progress must identify the actual current connection. The active kind declares movement, so room and private voice membership are revoked through the existing authority boundary. Final completion uses the existing home-arrival path and preserves homes, storage, furniture, ownership and receipts.

The accepted itinerary, total and timing survive restarts. A later price or new-booking status change cannot reprice an issued ticket. Completion happens once, clears only the journey and retains the ordinary repayment debt. Legacy direct trips, debts and successful receipts keep their readers and replay semantics. City dependency discovery loads required saved city rules before reconstruction; missing content fails before the authoritative saved record is replaced. Unsupported or corrupt trusted tickets preserve the stored record for recovery, creating no cash, erasing no debt and performing no silent relocation. The old direct-trip cash-refund hook is not applicable to this borrowed ticket.

Required proof before release:

- Actual Node and Worker zero-cash recovery to non-airport original homes from the five starter capitals.
- Exact advance/debit/loan/effect/receipt settlement and unchanged spendable cash, with same-intent replay before and after restart.
- Restart during each connection, final arrival, duplicate completion and successful old direct-trip/receipt replay.
- Missing, malformed, oversized, stale and altered quotes; existing debt, wrong destination/actor, busy, cancel and skip refusals.
- Preservation across accepted route price/status changes, and refusal without persisted-record replacement when required content or a trusted ticket is unusable.
- Native mobile itinerary/total readability, explicit consent, honest offline uncertainty, unchanged-intent reconciliation and original-home restoration.
- Exact final compiler/build/download/full-suite gates and coordinated sealed deployment with original production continuity witnesses.

Planner checks establish route and quotation behavior only. They do not establish lending authority, persistence, accessible consent or production recovery.
