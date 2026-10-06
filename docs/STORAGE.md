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

Planned in this order; each stage is shippable by itself and changes nothing for a player.

1. The code ships with `STORE_LAYOUT` unset (`legacy`). The new tables (`entries`, `store_meta`) are created empty; nothing
   reads or writes them.
2. See "Rollout" below.

(This section is completed in the final report of the work, with the exact operator steps and the measurements.)
