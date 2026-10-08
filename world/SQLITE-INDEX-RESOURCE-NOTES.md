# SQLite index resource evidence — 8 October 2026

Status: primary-source research, accepted cached positive experiment and measured
kernel/process/SQL failure witnesses. See FEATURE-IDENTITY-OPERATIONS.md for actual
sizes and [INDEX-RESOURCE-OPERATIONS.md](INDEX-RESOURCE-OPERATIONS.md) for terminal
resource/recovery checks. **No durable store acceptance or
production quota freeze**.

Actual Node22.19/SQLite3.50.4 has DEFAULT_MEMSTATUS=0: hard_heap_limit readback8MiB
did not prevent the controlled8MiB text allocation. Do not use this PRAGMA as an
enforced native memory cap on this runtime. The fixed-worker supervisor instead
uses V8 bounds, CPU/wall limits and fail-closed sampled RSS with explicit overshoot
limitations. [SQLite heap-limit conditions](https://www.sqlite.org/c3ref/hard_heap_limit64.html)
explain this measured behavior. File-size and page-limit witnesses preserve the
committed baseline; SIGKILL with real uncommitted WAL frames also recovers it.
These are disposable SQL witnesses, not actual index/ledger crash acceptance.

SQLite's `max_page_count` limits pages in the database file. `journal_size_limit`
controls journal/WAL files retained after transactions or resets; it is not a
hard limit on bytes written during a transaction. Setting journal mode returns
the actual mode. A TRUNCATE checkpoint returns three counters; its first counter
indicates a blocked completion. Successful truncation reduces the WAL to zero.
See [SQLite PRAGMA documentation](https://www.sqlite.org/pragma.html#pragma_max_page_count),
[journal size](https://www.sqlite.org/pragma.html#pragma_journal_size_limit), and
[checkpoint results](https://www.sqlite.org/pragma.html#pragma_wal_checkpoint).

WAL can grow during large write transactions or when overlapping readers prevent
reset. Automatic checkpoints do not guarantee truncation. The WAL is persistent
database state: separating or deleting it can lose committed transactions.
See [SQLite WAL operation and growth](https://www.sqlite.org/wal.html#the_wal_file).

Our inference for the future index: database-page limits alone do not bound total
builder disk use. Admission must account for database/WAL/shared-memory files,
raw captures and other charged artifacts, with bounded transaction size and
explicit reader gaps/checkpoint outcomes. Do not claim a hard in-transaction WAL
cap from an after-commit size check. Preserve a durable database and WAL together;
never delete an existing WAL to free a reservation. The final capacity/overshoot
and recovery contract still needs measured positive and bounded failure tests.

The tracked `tooling/profile_feature_identity.mjs` verifies actual
WAL/FULL/foreign-key settings, records Node/SQLite versions and all three physical
file sizes, and rejects measurement errors instead of returning fabricated zero.
Only an absent optional WAL/shared-memory file maps to zero. It inspects checkpoint
counters and physical truncation. Its disposable schema now includes capture pins
and every original ordinal, with exactly one admitted or exception disposition,
foreign-key binding and per-capture conservation checks. The cached positive run passed
with completed truncation and conserved ordinals; the prototype is not the
durable store or ledger hook.
