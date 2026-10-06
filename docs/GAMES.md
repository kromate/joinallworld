# Board games and the word puzzle

Chess, Weave (word tiles) and Oro (a word a day), added to the table system (`src/tables/**`, `server/growth/tables.ts`).

## Where they are
- **Tables.** `src/tables/derive.ts` adds a chess table at every venue whose scene kind is a park, lounge (buka), rooftop, viewing centre, beach, campus quad, lakeside or the campus, and a Weave table at lounges, rooftops, quads, lakesides and the campus. Landmark scenes (`outcrop`, `tower`) get none: they are at their triangle budget. Table ids are `<venue>-chess` and `<venue>-weave`; existing Lagos tables are unchanged. Server, scenes, HUD chip and share links all read the same function.
- **Phone, Games app.** Oro (daily and practice), and `phone-chess` / `phone-weave`: a private table per player against the house's bots, anywhere, with no venue. It is never listed or watchable by anyone else and is forgotten when empty. Inviting a friend to a game is the existing table share (a venue table); a "Join game" message button is not done.

## Table-system additions (all optional on a rules object, `src/tables/rules.ts`)
`side(move)` (resign, draw offers: any seat, any time, no clock change, not a real move), `clockMs(state)` and `charge(state, seat, elapsedMs)` (a game with its own clock; the server measures the time). A game ended by `resign` or `time` before everyone has moved twice is called off like a forfeit.

## Chess
Standard rules (castling, en passant, promotion with a choice, check, mate, stalemate, threefold repetition, fifty-move rule, insufficient material). Clocks: 5+3, 10+0, or relaxed (3 minutes a move). Draw offers: one pending, three per seat, a bot ignores them. Bot: alpha-beta with quiescence, node budget only (deterministic, no wall clock): easy ~170 nodes, medium 12,000, hard 40,000; about 1 to 3 million nodes a second, so a hard move is about 20 ms (max about 50) on a laptop. The bot runs on the table's host (Node or the Worker) within that budget.

## Weave
13x13 board, 4-fold symmetric premium squares of its own design, 98 tiles (2 blanks), rack of 7, 30-point all-tiles bonus, exchange when the bag has 7, pass, six scoreless turns end the game, the server checks every word against the list. 2-4 players, 120 s a turn, three missed turns forfeit. Tables are in memory only, so the game is synchronous; a persistent mode would need the match state stored per move (rows per move) and a turn-notification path.

## Oro
Same word for everyone each Lagos day, six guesses, hard mode, streaks. The answer is chosen on the server from a salted permutation (the growth salt); responses never carry it before the puzzle ends. A guess in progress is kept in memory only (a restart loses an unfinished puzzle, not a finished one). Stored: `growth.players[id].oro = { stats: { played, won, streak, best, last, dist[6] }, today: { no, guesses, won, hard } }`, written once when a puzzle finishes (one growth-collection transaction, the cost of a finished table game). Word data and licence: `docs/WORDS.md`.

## Rewards
No new faucet. A win against a real player is paid by the existing table rule (cap four a day, three per pair). Bot games and Oro pay nothing. Missions: "Win a game of chess" and "Solve today's word" (event `table.played` with `where` flags).

## Sound hook
Boards emit `window` event `jaw:table` with `{ game, event }` (`move`, `capture`, `check`, `castle`, `promote`, `end`, `play`, `bingo`, `exchange`, `pass`, `guess`, `win`, `lose`). No audio is played here.

## Not done
Ayo / draughts; a "Join game" message button; Oro at a table with friends; Weave persistent (asynchronous) games.
