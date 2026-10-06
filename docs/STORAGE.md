# Storage

How the game keeps its shared data, why the biggest collections are kept one entry at a time, how an existing store is moved,
how to roll it out and how to go back. Read [CAPACITY.md](CAPACITY.md) first for the problem: the cost of one request grew with
the number of players stored.

## The problem in one paragraph

`social`, `growth`, `civic` and `business` were each ONE JSON value. A request that touched one read the whole value, parsed
it, changed one player's record and wrote back whatever differed. At about 1.9 KB of `social` a player, 10,000 registered
players are 18 MB of text to parse for a message between two of them, and 65% of the Durable Object's CPU at 3,000 players
at rest was parsing and re-serialising these values. A small change near the start also rewrote every 400,000-character part
after it.

## What is stored now

A collection listed in `KEYED_SPECS` (`server/keyed.ts`) is stored as

- a **root**: the collection's JSON with each big map replaced by the marker `{"$keyed":"<map id>"}`. The scalars, the small
  maps and the arrays stay in it, in their own places (`social.seq`, `social.reports`, `growth.metrics`, `civic.prefs` …);
- **entries**: one stored text for each key of each big map, in the order the keys were added.

| Collection | Keyed maps (one entry per key) | What stays in the root |
| --- | --- | --- |
| `social` | `players[id]`, `convs[id]` (the conversation with its messages), `houses[id]`, `pending[id]` | `reports` (at most 2,000), `seq`, `sweptAt`, `founder`, `pings` (at most the open-ping limit), `pingJoins` |
| `growth` | `players[id]`, `shares[code]`, `comeback[id]`, `push[id]`, `contacts[id]` | `salt`, `metrics`, `tables`, `outreach`, `comebackStats`, `sweptAt` |
| `civic` | `cities.<city>.residents[id]`, `cities.<city>.gov.elections[week]` | `prefs`, `salt`, each city's counters, announcements, ads, hunt, radio |
| `business` | `shops[owner]` | `reports`, `seq` |

Everything else (`support`, `moderation`, `campus`, `pulse`, the five `admin*` collections, accounts, sessions, receipts,
pictures, the limiter and the world registry) is stored exactly as before: each is bounded by a cap in the code or by a
table of its own, and none of them grows with the number of players the way these four do.

### Why this grain

Measured on the synthetic store of `server/testing/legacySeed.ts` (10,000 registered players, what a few weeks of play leave):

| Map | Entries | Average | p99 | Largest |
| --- | --- | --- | --- | --- |
| `social.players` | 10,000 | 830 B | 1.5 KB | 2 KB |
| `social.convs` | 4,054 | 2.4 KB | 24 KB | 26 KB |
| `social.pending` | 105 | 360 B | 508 B | 508 B |
| `growth.players` | 10,000 | 190 B | 325 B | 326 B |
| `growth.comeback` / `contacts` / `push` / `shares` | 1,475 / 1,475 / 804 / 1,035 | 390 / 190 / 280 / 210 B | | |
| `civic.cities.lagos.residents` | 6,991 | 157 B | 161 B | 162 B |
| `civic.cities.lagos.gov.elections` | 1 per week | 114 KB (Lagos, one election) | | |
| `business.shops` | 298 | 440 B | 470 B | 471 B |

Totals: `social` 18.7 MB (root 50 KB), `growth` 4.2 MB (root 477 KB), `civic` 2.2 MB (root 12 KB), `business` 0.17 MB.

- A **conversation is one entry**, messages included. The longest it can be is 200 messages: about 30 KB (up to 400 KB with
  every message at its length limit and four-byte characters), far below a row's 2 MB limit. A message therefore rewrites one
  row of about 30 KB, which is one row written on the platform's bill (rows are billed, bytes are not) and 0.1 ms of CPU to
  parse and write. Splitting a conversation into a head and pages of messages would turn the one row a message costs into two
  and make every read of a thread read two kinds of row; it was measured as not worth it. An entry longer than a row's chunk
  (400,000 characters) is split over `collection_parts`, like any collection always was, and read back whole.
- **Residents are one entry each** because a check-in is the most frequent write of the game: it rewrites 157 bytes, not a
  city's worth.
- **Elections are one entry per week** (the votes of a Lagos election are 114 KB at 10,000 players).

## How a request sees them

Route and service code is unchanged. `db.social` is still the object it always was: `db.social.players[id]`,
`id in db.social.players`, `delete db.social.convs[key]`, `Object.keys(db.social.players)`.

- The root is parsed (50 KB at 10,000 players, 1 KB at 100); each keyed map in it is a **lazy map** (a `Proxy`). Reading
  `players[id]` reads and parses that one entry, once, and hands out the same object for the rest of the transaction.
- **Writing**: at the end of the transaction every entry that was read or made is turned into text again and compared with the
  text it was read as; only the ones that differ are written, and the root when its text differs. A removed key is removed.
  Nothing is written by a read, and a transaction that changes nothing writes nothing.
- **Keys**: `Object.keys(map)` and `in` read keys only (one index scan; `in` is one point lookup). The order is the order a plain
  object lists its keys (integer-like keys first, ascending, then the order they were added), so code that relies on it
  ("newest first", the founder's friends pages) sees the same order.
- **Identity**: within a transaction one key is one object; the next transaction parses it again, so nothing mutated and
  not committed is ever seen again. The social service's per-collection `WeakMap`s key on the root object, which is made
  fresh for each transaction as before.
- **Durable and lazy**: unchanged. A lazy change is held in memory per entry (and per root) and written within the flush
  time; a durable transaction writes the held change of every entry it read, with its own. Only a change to an entry or
  root that is stored already is ever held; making or removing a key is written at once.
- **Failure**: a commit is ONE SQLite transaction with the sessions, receipts and every entry in it. If anything in it fails
  nothing of it persists. On Node the commit of a transaction is applied to memory and undone with the rest of its write if
  the file cannot be written.

### Scans: asking about many entries without reading them

A few places must ask "which players" instead of "this player". Each entry is stored with three columns beside its text
(its **projection**, `PROJECTIONS` in `server/keyed.ts`): `ix` a number, `tx` a lower-case text, `jx` a small JSON payload.
`scanKeys(map, projection, query)` answers from the columns; on the legacy layout (and on a plain object) the same function
walks the values and projects each, so both layouts answer alike. A scan is used as a **prefilter**: the original test is
kept and applied to each entry the scan returns.

| Map | `ix` | `tx` | `jx` |
| --- | --- | --- | --- |
| `social.players` | last seen | name | `{ b: blocked ids, f: [founder, since] if the automatic friendship holds, i: who invited them }` |
| `social.pending` | the oldest effect's time | | |
| `growth.players`, `growth.shares` | last seen, made | | |
| `growth.comeback` | when to look at the player next | | |
| `civic …residents` | last check-in | | |
| `business.shops` | when a closed shop closed (9e15 while open) | `city`, NUL, `venue` of an open shop | |

### Every place that looked at all of a map, and what was done

| Site | Frequency | Before | Now |
| --- | --- | --- | --- |
| `social` search (`service.search`) | each search | every player | the name index, in the order players were added, `orKey` for an id |
| `social` friend search (founder) | each search | every player | the name index |
| founder's automatic friends (`founderFriends`) | each page | every player | `jx.f` index; the founder's own record |
| block index at start-up (`service.ts` start) | each wake of the object | every player | `jx.b` index (players who block anyone) |
| hourly sweep: forgotten players, stale gifts | hourly | every player and queue | `ix` prefilter |
| picture request (`routes/social.ts picture`) | each picture | every conversation, message by message | the picture's own row names its conversation |
| operator: reported pictures, find a picture, picture counts (`modPictures`, `modPictureConv`, `pictureCounts`) | operator | every conversation held at once | one conversation at a time (`forEachValue`): memory of one entry |
| admin player page: how many they invited | operator | every player | `jx.i` index |
| civic counters (`counters`, each pulse) | each civic pulse | every resident | `ix` count; no resident read |
| civic prune of residents | every `PRUNE_EVERY_MS` | every resident | `ix` prefilter |
| civic directory and rich list (`neighboursView`, `richListView`) | on request of that panel | every resident | unchanged (reads every resident of one city; 157 B each) |
| business `shopsAt` (each venue view) | each venue view | every shop | `tx` index |
| business `prune` | each business request | every shop | `ix` prefilter |
| growth hourly sweep (`sweep`) | hourly | every share and player | `ix` prefilter |
| growth comeback `plan` | each round | every comeback record | `ix` prefilter; the next wake from the `ix` column |
| growth comeback orphan sweep (`sweep`) | hourly | keys, then each record | unchanged (records of players who opted in: a small fraction) |
| `Object.keys(map).length` against a cap (`growth.players`, `shares`, mutes …) | on creation | keys | keys only (one index scan; no entry read) |
| announcements mail cursor (`announce-mail`) | operator | `Object.keys(g.comeback).sort()` | keys only |
| `routes/civic.ts` prefs prune | rare | each city's resident keys | keys only |
| `admin/stats.ts` shops | operator | every shop | unchanged (a few hundred records) |
| `houses` hourly prune | hourly | every house | unchanged (a house exists only while someone is a guest) |

Known costs that remain, by design: the roots (`social` 50 KB at 10,000 players; `growth` 477 KB because its `metrics.lives`
map holds every life of the last 31 days and is shared by two paths of the metrics code); a conversation list reads the
conversations a player lists (up to 100); a founder's page of friends reads one page; `civic` neighbours and rich lists read
a city's residents.

## The three layouts

`STORE_LAYOUT` (an environment variable of the Node host, a variable of the Worker) and, once set by the operator, the store's own
`layout` row:

| Layout | Truth | What else | Use |
| --- | --- | --- | --- |
| `legacy` (default) | one JSON value per collection | nothing | what shipped before |
| `shadow` | the legacy value | the entry rows are kept beside it, written in the same SQLite transaction, and compared on a sample of reads; a mismatch counter | the release before the switch |
| `entries` | the entry rows | the legacy rows are kept untouched as a safety copy | after the switch |

On **Node** the file is the same in every layout (`devices.json`, with each collection assembled whole when it is written):
`entries` changes how the host holds and reads collections in memory, not what is on disk, so there is nothing to migrate and
the way back is to unset the variable. `shadow` is `legacy` there.

## Moving an existing store (Worker)

The store is moved by the operator, at run time, with the routes below; the code ships with `STORE_LAYOUT` unset, which
changes nothing. The layout lives in the store itself (`store_meta`): once the operator has set it, a restart with another
`STORE_LAYOUT` value does NOT change it. The variable is only the starting point of a store that has never been told.

| Route (operator token) | What it does |
| --- | --- |
| `GET /api/mod/store` | the layout, per collection: mode, synced, whether a legacy row exists, entries stored, any error; the shadow counters (`mismatches`, `checks`, `errors`, the first differences) |
| `GET /api/mod/store/compare` | each collection's entry rows against its legacy value: equal or not, and the first differences |
| `GET /api/mod/store/hashes` | a fingerprint of each collection's whole text, to compare two stores or a store before and after |
| `POST /api/mod/store/migrate` `{collections?}` | make the entry rows from the legacy values and read them back; one SQLite transaction per collection |
| `POST /api/mod/store/layout` `{layout, force?}` | `shadow`, `entries` or `legacy`; refuses with 409 and a code (`shadow_mismatch`, `not_equal`, `migration_failed`) when it would lose or mismatch anything |
| `POST /api/mod/store/safety` `{action: 'drop' \| 'restore', force?}` | after the switch: delete the legacy rows (not before 14 days, `SAFETY_DAYS`, unless `force`), or go back to them |

**What "moving a collection" does.** In ONE SQLite transaction: any old entry rows of the collection are cleared; the legacy
text is cut into a root and entries WITHOUT parsing it (`splitText`: a scan of the text that slices each entry out, so a
20 MB collection costs 20 MB of text, not 80 MB of objects); each entry is written with its projection columns; then every
row is read back and put together again, and the result must equal the legacy text to the character. Anything else (a
mismatch, a failure of any statement, the object being evicted) rolls the whole step back: the collection stays legacy, the
store is readable, and the step is tried again by the next call or the next start. Requests that arrive during a step wait
in the store's queue, so none sees a half-moved collection. The legacy rows are never written by the move.

**Cost** (`scripts/store-migration-bench.ts`, node:sqlite on the build machine; the Worker's storage adds its own latency):

| Registered players | `social` | All four collections | Table rows written (each entry row also writes one index entry) | Compare of everything |
| --- | --- | --- | --- | --- |
| 2,000 | 53 ms | 93 ms | 7,800 | 18 ms |
| 10,000 | 264 ms | 457 ms | 39,400 (so about 79,000 rows billed) | 83 ms |
| 2,000, heavy profile (five times the friends, full conversations) | 355 ms | 399 ms | 16,100 | 131 ms |

The largest step is one collection in one event: 0.3 s of CPU at 10,000 players against a limit of 30 s, so no step is split
into key ranges. 79,000 rows is under 0.2% of the plan's 50 million a month. Memory: the legacy text (19 MB `social`) and
its slices are held while the step runs; a store of 10,000 players needs about 60 MB for it, within the object's 128 MB.

**A failure at any point.** The move is tested by failing every statement of it in turn (`deploy/sqlite-migration.test.ts`): each
time the store reads back exactly what it held before, and the move then finishes. A deploy or eviction between two collections
leaves some collections moved and some not; each is judged by its own `synced` flag, and `entries` mode serves only the ones
that are moved, the others stay legacy. A commit in `shadow` or `entries` is one SQLite transaction (sessions, receipts, root,
entries): nothing of a failed one stays (tested at every statement).

### Rollout, with the operator's steps

1. **Ship** with `STORE_LAYOUT` unset. Check `GET /api/mod/store`: `requested: legacy`; `entries` tables are empty.
2. **Shadow.** `POST /api/mod/store/layout {"layout":"shadow"}`. The first request after it makes the entry copy of each
   collection (about half a second at 10,000 players) and from then on every legacy write also writes the entries that changed,
   in the same transaction. One load of a collection in 50 (`shadowSample`) compares the whole entry copy with the legacy text
   (one more `entries` write per changed entry; the extra CPU is the splitting of the legacy text on each write of a layered
   collection). A copy that fails to be written stops being kept (`errors`), the player's write stands, and the copy is made
   again at the next start. Watch `shadow.mismatches` and `shadow.errors` stay at 0 for as long as you like (a few days).
3. **Check.** `GET /api/mod/store/compare`: every collection `equal: true`.
4. **Switch.** `POST /api/mod/store/layout {"layout":"entries"}`. It refuses unless the copy equals the legacy value now and the
   shadow counters are clean (`force: true` overrides the counters only). From this moment collections are read and written per
   entry; the legacy rows stay untouched as the safety copy, and the switch's time is kept.
5. **The way back, in the first 14 days.** Either
   - `POST /api/mod/store/layout {"layout":"shadow"}` (or `legacy`): the legacy rows are rewritten from the entries, so every
     write made since the switch is kept, and the store carries on in the older layout; or
   - `POST /api/mod/store/safety {"action":"restore"}`: back to the legacy rows exactly as they were at the switch; writes made
     since are given up. Use this only if the entries themselves are suspect.
6. **Retention.** After 14 days, `POST /api/mod/store/safety {"action":"drop"}` deletes the legacy rows of the four collections.
   The way back to `legacy` still works afterwards (it is made from the entries); `restore` does not.
7. **Settle.** Set `STORE_LAYOUT=entries` as the variable too, so that a store made from scratch starts in it.

There is no dual write after the switch: keeping the legacy text current would mean serialising the whole collection on every
request, which is what this change removes. The way back is a one-time rewrite from the entries instead.

## Tests

- `server/keyed.test.ts`: splitting and assembling, a model test of the layer against plain objects (12 seeds, 600 transactions each,
  restarts, discarded transactions, undo), scans.
- `deploy/sqlite-entries.test.ts`: the Worker's store in the entries layout against the legacy layout through random transactions,
  lazy writes and restarts; one row for one changed player; rows split over parts; a failing commit.
- `deploy/sqlite-migration.test.ts`: shadow, the switch, the way back, the safety copy, a failure at every statement of the move and
  of a commit, requests during the move, shadow against random changes.
- `server/store-model.test.ts`: two servers, one per layout, given the same random requests (friends, messages, groups, reactions,
  blocks, gifts, pings, searches, civic pulses, reads): every answer and every stored collection equal.
- `deploy/storage.edge.test.ts`: the same on Miniflare with persisted storage and restarts, the operator routes, the rows a message costs.
- The whole server suite and the edge suite run under `STORE_LAYOUT=entries` (`STORE_LAYOUT=entries npm test`, `STORE_LAYOUT=entries npm run test:edge`).
- `scripts/live-build-migration.ts --live <checkout of the live build>`: data written through the live build's own routes is moved by this build
  on both hosts and every collection reads back equal.
