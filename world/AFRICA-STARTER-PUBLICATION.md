# African starter publication

`build-africa-starters.py` computes each city's five generated source files
and receipt in memory, then passes those exact bytes to
`world/tooling/atomic_starter_publication.py`. Publication is serial and
per-city. The helper never requests geography, changes source caches, or edits
request ledgers.

For a city, the helper takes an advisory lease in
`.cache/world-build/africa-starter-publication/`. That cache directory must be
owned by the current user and private. The lease fails promptly if another
cooperating writer holds it. The helper writes a bounded `intent.json`
ownership marker immediately, then stages the five assets and receipt in a
private directory. The intent binds the city and generation identity,
inventory and source identity, and byte counts and SHA256 hashes for all six
payload files. After syncing the staged files and intent, it atomically renames
the staged city directory into `src/game/cities/`. It then publishes the
receipt by linking a synced pending file to the final receipt name without
replacing an existing receipt, and syncs the receipt directory before
returning.

A rerun recomputes the expected payload. It resumes only when the intent and
all remaining staged or already-published bytes exactly match that payload.
With a matching durable intent, missing staged files can be written and a
short staged file can be resumed only when its current bytes are an exact
prefix of the expected file. Present mismatching bytes and unknown files are
refused; published city assets and final receipts are never appended or
repaired.
An exact completed output and receipt can be verified without an intent for
compatibility with outputs created before this publisher. A mismatched receipt,
stale intent, symlink, unowned partial city or staging directory, unknown
pending receipt, or corrupted asset is refused and left for explicit manual
review. A crash before the intent is durable can leave an unowned private
staging directory; the helper deliberately refuses to adopt or delete it.

The lease coordinates cooperating local generator processes. This design
provides local filesystem crash durability through file and directory syncs;
it is not a distributed lock or a promise about network filesystems. Existing
source request limits and ledgers remain authoritative and are not reset by
publication or recovery.
