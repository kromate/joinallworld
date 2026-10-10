# Long lists: paging, lazy loading and windowing

One pattern serves every list that can grow. A server route returns a page and a cursor; a small client engine asks for the next page before the reader reaches the end; a list component draws the rows, keeps the reader's place and, for a very long list, draws only the rows near the viewport.

## The server side

* A page is `limit` rows (capped at `PAGE_MAX`, 100, whatever is asked) and `next`, an opaque cursor. `next: null` means nothing follows. The client hands the cursor back as `after`.
* A cursor names the SORT KEY of the last row the client holds (a time and an id, a name and an id, an amount and an id, a message number). It is never an offset, so a row added or removed while the client pages can neither repeat a row nor skip one. A row that moves (a chat that gets a new message moves to the top) is not repeated lower down; the live push puts it at the top.
* A page may hold fewer rows than asked (a name search reads at most `DIRECTORY_SCAN` names a request); `next` is null only at the end.
* A cursor that is not ours is answered `400 invalid_cursor`.
* Without `limit` the old answer is given (old clients keep working).
* A read writes nothing. Each route states its cost below; none walks every player or conversation to answer one page.

| List | Route | Page | Order, cursor | Cost of one page |
| --- | --- | --- | --- | --- |
| Players view (founder, listed admins; others 404) | `GET /api/social/everyone?q=&sort=&city=&after=&limit=` | 40 (max 100) | `newest` (exact: first-seen time, id), `name` (exact), `online` (connected first, then newest), `city` (connected in a city); `q` = name prefix then contains | A directory index of plain rows, rebuilt at most every 15 s per viewer, or at once when a player is added, renamed, or a friendship or block changes: O(N log N) per rebuild, then O(log N + page). A name-contains search reads at most 20,000 lower-cased names a request. Online and by-city read the presence registry: O(connected players). Counts (`total`, `gone`) come with the index. |
| Chats | `GET /api/social/conversations?limit=&after=`, and `GET /api/social/me?lite=1` | 30 (max 100) | last activity (time, id); the first page also carries the pinned chats | One pass over the caller's own chat list (at most 100, 1,000 for the founder) for the order; summaries only for the page. |
| A conversation's lines | `GET /api/social/conversations/:id?before=<seq>&limit=` | 40 on open, 40 older (max 100) | message number; `more` says older lines are kept (200 are kept) | One conversation of at most 200 lines. |
| Directory of homes (Neighbours) | `GET /api/civic/neighbours?city=&district=&after=&limit=` | 40 (max 100) | name, id | Per-city sorted rows kept 10 s; a binary search and the page. |
| Rich list below its top | `GET /api/civic/richlist?city=&board=balances\|earners&after=&limit=` | 40 (max 100), to rank 500 | amount, id | The same kept rows. |
| Place boards (cities, states, countries) | `GET /api/civic/boards?scope=&by=&after=&limit=` | 25 (max 100) | rank (a place's order by the measure, then id) | Each city keeps a weekly tally that a check-in updates; a build reads one tally and the resident count of each city (keys only, no resident record) at most every 10 s, then a page is a slice. Places with fewer than 5 residents or 5 active players are left off. |
| Founder's old friend page | `GET /api/social/friends?after=` | 50 | friends-since order | The directory index (the old route is kept for old clients). |

Lists that cannot grow (friend requests 30, blocked 200, reports 20, updates 50, search results 10, group picker 20) are not paged by the server; the long ones among them are drawn in chunks (below).

### The Players view: who, what, how

Only the founder's character (and accounts whose address hash is in `ADMIN_EMAIL_SHA256S`, resolved by the same check the admin section uses, on every request) get `everyone`; for anyone else it is a 404 `not_found`. For the founder the list is the players they are friends with and have not blocked or been blocked by; players who removed or blocked the founder are only counted (`gone`), never named. A row holds a name, when they joined, what the friends list already shows (online or not, and where for a friend), and whether a direct chat exists (`chat.unread`, `chat.listed`). A chat that holds only the automatic welcome note is "no chat yet". No row carries an address.

`POST /api/social/chats/open { with }` returns the direct chat with a player and puts it back in the caller's chat list if it had been dropped from it (a full list drops its quietest chat; the founder's holds 1,000, everyone else's 100). A player never talked to has `conv: null`: the first message creates it. `POST /api/social/messages/many { to: [≤20 ids], body, clientId }` (founder and admins) sends the same words to each as an ordinary direct message through `send` (screening, blocks, the stranger rules, the per-minute limit, push and notice), at most 6 such requests per 10 minutes (`LIMITS.batchPerWindow`, `batchWindowMs`); each player has their own line in `results`.

## The client side

* `src/app/ui/lazyList.ts` is the engine. `createLazyList({ fetchPage(cursor, signal), key, label })` returns `items`, `loading`, `error`, `hasMore`, `total`, `announcement` and `loadMore()`, `reset()` (the query changed: the read still on its way is dropped and its rows never shown), `retry()`, `upsert()`, `remove()`. Rows are kept once by `key`. After a failure nothing is asked for by itself until `retry()`. `keptList(key, make)` and `keepPosition` let a list and its scroll position outlive the panel (coming back from a detail shows the same rows at the same place).
* `src/app/ui/LazyList.vue` draws a list: `items`, `itemKey`, `hasMore`, `loading`, `error`, `announcement`, `label`, `rowHeight`, `skeletonRows`, `memory`, `height`; slots `row` and `empty`; events `more` and `retry`. It scrolls with the nearest scrolling ancestor (or by itself, given `height`). It asks for more while the end is within 1.5 viewports (an IntersectionObserver on a sentinel with a bottom root margin, and a scroll-position check as the fallback; `PREFETCH_SCREENS`). It shows grey rows while a page loads and "Couldn't load more · Try again" on failure, announces "Loaded 40 more players" in a polite live region, never moves focus, offers "Jump to top" after three viewports (no animation under reduced motion), and, when every row has one fixed `rowHeight` and there are more than 300 rows (`WINDOW_AFTER`), draws only the rows near the viewport plus 8 each side (and the row that has focus), in a box as tall as the whole list.
* Rows of unknown height (chat lines) use chunked rendering instead: the newest 60 are drawn, earlier ones are drawn 40 at a time as the reader scrolls up (a skeleton at the top stands in for them), then fetched from the server when those run out; the scroll position is kept on the line being read. `chunkedView(rows, step)` spreads the drawing of a list already in memory (wallet lines, stalls, tables, places) the same way.
* The admin tables can use `LazyList` and `createLazyList` as they are: give them a `fetchPage` that returns `{ ok: true, items, next, total? }`.

## Measured (5,000 players, 300 chats of 200 lines, 5,000 residents; bytes of the JSON answer)

| Request | Before | After |
| --- | --- | --- |
| Opening Messages, the founder's overview | 62,245 B (`GET /api/social/me`: 100 chats and the newest 50 automatic friends) | 17,234 B (`?lite=1`: 30 chats, the rest by cursor; the Players view reads the friends) |
| Next page of chats | none (the 101st chat was out of reach) | 16,327 to 16,431 B per 30 |
| Opening a 200-line conversation | 17,406 B (the newest 50 lines) | 14,042 B (the newest 40); older lines 40 at a time; all 200 would be 34,157 B |
| Founder's friends, one tap of "Show more friends" | 6,205 B per 50, with no search | the Players view: 5,129 B per 40, with search, sorts and counts |
| Neighbours | 18,383 B for the first 200 homes, the rest "not listed" | the same first view; one district's next 40 homes 4,102 B |

A request on this build costs about 95 ms on the Node host with these collections whatever it asks (a player card takes as long): the host copies the whole social collection for each transaction, which is the storage layout's cost and not the list routes'.
