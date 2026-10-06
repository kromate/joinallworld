/**
 * OWNER: growth
 * The table service: every game table in every venue, the matches played at them, and what a
 * finished match records. The server is the only judge: it holds each match's full state, applies
 * every move through the game's own rules (src/tables/<game>.js), plays the bots, keeps the clock
 * on its own time, and sends each seat only what the rules' `view` says that seat may see.
 *
 * A TABLE is a place in a venue (src/tables/places.ts). You sit only while your stored life is in
 * that venue; anyone may watch. At most one seat per player across all tables.
 *   open     people sit; the first to sit may set the table's options; anyone seated starts
 *            the game, filling empty seats with bots if they ask
 *   playing  moves, one at a time, numbered: a move carries the number `n` of moves already made
 *            when it was chosen. The same move with a number just used is answered with the current
 *            state and changes nothing (a retry); any other stale number is refused. So a move is
 *            applied exactly once however often it is sent.
 *   over     the result stays on the table for TUNING.resetMs, or until someone asks to play again
 *
 * CLOCK. A seat has the game's `turnSeconds` to move. When it runs out the rules play for that seat
 * (in Whot: go to market); the third time in a row the seat forfeits. A bot moves TUNING.botDelayMs
 * after its turn starts. A player whose last connection to the table is gone keeps the seat (a
 * RECONNECT gets the same seat and the current state) but forfeits after TUNING.awayForfeitMs.
 *
 * RANDOMNESS. A match has a seed made on the server from the platform's random source. Every
 * shuffle and every bot choice is drawn from a generator keyed with that seed and the move
 * number. The seed never leaves this module, so no client can know a hand or the market's order.
 *
 * WHAT IS STORED. Live tables are in memory only: a restart ends the games in progress and
 * nothing is recorded for them. When a match ends properly, one saved transaction writes, in the
 * growth collection: each human's pending result (`players[id].wins`, applied to their life by
 * POST /api/growth/tables/claim), `tables.ratings` (two-player matches between two humans) and
 * `tables.pairs` (how often two players' games counted today). A game that ends by someone
 * leaving before every human has moved twice is CALLED OFF: nothing is recorded for anyone.
 *
 * NO STAKES. Nothing is wagered. A win against a real player is paid by the game, inside the
 * caps of src/game/content/growth.ts; the same two players' games count three times a day.
 */
import { lagosTime } from '../../src/game/clock.ts';
import { makeRng } from '../../src/game/util.ts';
import { TABLE_REWARDS } from '../../src/game/content/growth.ts';
import { venueLabel } from '../../src/game/content/venues.ts';
import { cityContent } from '../../src/game/cities/index.ts';
import { BOT_NAMES } from '../../src/tables/places.ts';
import type { TableDef } from '../../src/tables/places.ts';
import { withBoardGames } from '../../src/tables/derive.ts';
import { GAMES } from '../../src/tables/games.ts';
import { RulesError, RATING, cleanOptions, eloChange, withNames } from '../../src/tables/rules.ts';
import type { Outcome, TableOptionSpec, TableOptions, TableRules, TableState } from '../../src/tables/rules.ts';
import { canOccupyVenue } from '../protocol.ts';
import { growthOf, playerOf } from './data.ts';
import { count } from './metrics.ts';
import type { CityId } from '../../src/types/protocol.ts';
import type { LifeState } from '../../src/types/life.ts';
import type { ResultGameId, TableGameId, TableOptionValue, TableRating, TableResultMine, TableStateFrame, TableSummary, TablesFrame } from '../../src/types/growth.ts';
import type { GrowthCityTablesRecord, GrowthCollection, GrowthPlayerRecord, PendingTableResult, RouteContext, SessionRecord, WsConnection } from '../types.ts';

/** The venue id of a table that is on the Phone: it is not in any venue. */
export const PHONE_VENUE = 'phone';

/** Timings. A test may shorten them; nothing else should. */
export const TUNING = { botDelayMs: 900, awayForfeitMs: 120000, resetMs: 45000, missesToForfeit: 3, maxSockets: 40, logLines: 30, minMovesEach: 2, keepAwakeMs: 45000 };
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const refuse = (code: string, reason: string) => Object.assign(new Error(code), { reason });
const ready = (state: LifeState | null | undefined): state is LifeState => Boolean(state) && !(state?.onboarding?.required === true && state.onboarding.done !== true);
const messageOf = (error: unknown): unknown => (typeof error === 'object' && error !== null && 'message' in error ? error.message : undefined);

/** Ratings are city-local. Legacy ratings predate multi-city play and therefore belong to Lagos. */
export function ratingsForCity(g: GrowthCollection, cityId: CityId): NonNullable<GrowthCityTablesRecord['ratings']> {
  if (!g.tables.cities) g.tables.cities = {};
  let city = g.tables.cities[cityId];
  if (!city) {
    city = cityId === 'lagos' && g.tables.ratings ? { ratings: g.tables.ratings } : {};
    g.tables.cities[cityId] = city;
  }
  if (!city.ratings) city.ratings = {};
  if (cityId === 'lagos') g.tables.ratings = city.ratings;
  return city.ratings;
}

/** Remove only results earned in this city. Other-city wins wait for the character to return there. */
export function takePendingTableResults(player: GrowthPlayerRecord | null, cityId: CityId, limit = 12): PendingTableResult[] {
  if (!player) return [];
  const due = player.wins.filter((result) => (result.cityId ?? 'lagos') === cityId).slice(0, limit);
  player.wins = player.wins.filter((result) => !due.includes(result));
  return due;
}

// ---- one game, with its state type hidden ---------------------------------------------------------
//
// The two games have different states, moves and views (src/tables/whot.ts, penalty.ts). The service
// below never looks inside one: it keeps a match's state in the closure of an Engine built by
// startEngine(), so the compiler checks every call into the rules and no type is cast away.

/** A move already read by its game's parseMove: it can be described and played, and has a JSON form for retry detection. */
interface ParsedMove {
  readonly json: string
  /** What the retry check compares with the last move's `json`: JSON.stringify of the parsed move itself, which is undefined for an undefined move (so such a move is never taken as a retry), as before. */
  readonly retryKey: string | undefined
  /** A move any seated player may make at any time without it being their turn (resign, offer a draw). */
  readonly side: boolean
  /** The log line for this move by `seat`, from the state before it. */
  describe(seat: number): string
  /** Apply it (the rules throw RulesError for an illegal one); returns the log lines it earned: the move itself, then any report. */
  play(seat: number, rng: () => number): string[]
}
/** A running match: its state is private to the engine. */
interface Engine {
  toMove(): number[]
  outcome(): Outcome | null
  /** What a seat (or a watcher: null) may see. */
  view(seat: number | null): Record<string, unknown> | null
  parseMove(input: unknown): ParsedMove
  /** The computer's move for a seat, read the way a player's is. */
  botMove(seat: number, rng: () => number): ParsedMove
  /** The clock ran out: the rules play for the seat. Returns the log lines. */
  timeout(seat: number, rng: () => number): string[]
  forfeit(seat: number): void
  /** How many milliseconds the seat to move has, for a game that keeps its own clocks; null when every move gets the game's `turnSeconds`. */
  clockMs(): number | null
  /** Charge the time the mover took, just before a real move is applied. */
  charge(seat: number, elapsedMs: number): void
}
/** A game as a table needs it. Reads the rules object each time, so a live change to it is seen. */
interface Game {
  readonly label: string
  readonly seats: { min: number; max: number }
  readonly turnSeconds: number
  optionSpecs(): [string, TableOptionSpec][]
  cleanOptions(given: unknown): TableOptions
  start(seats: number, rng: () => number, options: TableOptions): Engine
}

function gameOf<State extends TableState, Move, View>(rules: TableRules<State, Move, View>): Game {
  return {
    get label() { return rules.label; },
    get seats() { return rules.seats; },
    get turnSeconds() { return rules.turnSeconds; },
    optionSpecs: () => Object.entries<TableOptionSpec>(rules.options),
    cleanOptions: (given) => cleanOptions(rules, given),
    start(seats, rng, options) {
      let state: State = rules.start(seats, rng, cleanOptions(rules, options));
      const parseMove = (input: unknown): ParsedMove => {
        const move = rules.parseMove(input);
        // JSON.stringify(undefined) is undefined at run time though typed string.
        const retryKey: string | undefined = JSON.stringify(move);
        return {
          json: JSON.stringify(move ?? null),
          retryKey,
          side: rules.side?.(move) === true,
          describe: (seat) => rules.describe(state, seat, move),
          play(seat, moveRng) {
            const line = rules.describe(state, seat, move), before = state;
            state = rules.apply(before, seat, move, moveRng);
            // An empty description logs the clock line, as before.
            return [line || `{${seat}} ran out of time`, ...(rules.report?.(before, state) ?? [])];
          },
        };
      };
      return {
        toMove: () => rules.toMove(state),
        outcome: () => rules.outcome(state),
        view: (seat) => { const view = rules.view(state, seat); return isRecord(view) ? view : null; },
        parseMove,
        botMove: (seat, botRng) => parseMove(rules.bot(state, seat, botRng)),
        timeout(seat, timeoutRng) {
          const before = state;
          state = rules.timeout(before, seat, timeoutRng);
          return [`{${seat}} ran out of time`, ...(rules.report?.(before, state) ?? [])];
        },
        forfeit(seat) { state = rules.forfeit(state, seat); },
        clockMs: () => (rules.clockMs ? rules.clockMs(state) : null),
        charge(seat, elapsedMs) { if (rules.charge) state = rules.charge(state, seat, elapsedMs); },
      };
    },
  };
}
const GAME_OF: Record<TableGameId, Game> = { whot: gameOf(GAMES.whot), penalty: gameOf(GAMES.penalty), chess: gameOf(GAMES.chess), weave: gameOf(GAMES.weave) };

// ---- the service's own records ----------------------------------------------------------------------

interface Seat { id: string; name: string; bot: boolean; away: number; left?: boolean; misses?: number; moves?: number }
interface Match {
  id: string
  /** Made on the server; never leaves this module. */
  seed: string
  /** Moves made so far. */
  n: number
  log: string[]
  last: { seat: number; n: number; move: string } | null
  deadline: number
  /** When the move now being waited for began, and the most it may take (the game's `turnSeconds`, or its own clock). */
  turnStart: number
  allowedMs: number
  botAt: number | null
  engine: Engine
}
interface TableResult { text: string; calledOff: boolean; winners: number[]; per: Record<string, TableResultMine> }
interface Table {
  key: string
  cityId: CityId
  place: TableDef
  game: Game
  status: 'open' | 'playing' | 'over'
  seats: Seat[]
  options: TableOptions
  match: Match | null
  sockets: Set<WsConnection>
  timer: ReturnType<typeof setTimeout> | null
  result: TableResult | null
  endedAt: number
  pumping?: boolean
}
/** The seat at an index the rules named; a state that names a seat the table does not have is a bug and throws. */
function seatOf(table: Table, index: number): Seat {
  const seat = table.seats[index];
  if (!seat) throw new RangeError(`Table ${table.key} has no seat ${index}`);
  return seat;
}
/** The match of a table whose status says one is on. */
function matchOf(table: Table): Match {
  if (!table.match) throw new Error(`Table ${table.key} has no match`);
  return table.match;
}

const services = new WeakMap<object, ReturnType<typeof buildService>>();

export function tablesService(ctx: RouteContext) {
  const cached = services.get(ctx);
  if (cached) return cached;
  const api = buildService(ctx);
  services.set(ctx, api);
  return api;
}

function buildService(ctx: RouteContext) {
  const now = () => ctx.now();
  /** `${cityId}:${tableId}` → table */
  const tables = new Map<string, Table>();
  /** publicId → the key of the table that player is seated at */
  const seated = new Map<string, string>();
  const gameId = (value: string): TableGameId | null => (value === 'whot' || value === 'penalty' || value === 'chess' || value === 'weave' ? value : null);
  /** The tables standing in a city: the ones it lists, and a chess and a word-tile table wherever a venue suits them (src/tables/derive.ts). */
  const places = (cityId: CityId): TableDef[] => {
    const content = cityContent(cityId);
    return withBoardGames(content.venues, content.tablePlaces).flatMap((place) => {
      const game = gameId(place.game);
      return game ? [{ id: place.id, venue: place.venueId, game, label: place.label, seats: place.seats }] : [];
    });
  };
  /** The Phone's own tables: a board game against the house's bots, anywhere, with no venue and no seat for anyone else. Yours alone; the id the screen uses is `phone-chess`, `phone-weave`. */
  const phonePlace = (id: unknown): TableDef | null => {
    const game = typeof id === 'string' && id.startsWith('phone-') ? gameId(id.slice(6)) : null;
    return game === 'chess' || game === 'weave' ? { id: `phone-${game}`, venue: PHONE_VENUE, game, label: game === 'chess' ? 'Chess on your Phone' : 'Word tiles on your Phone', seats: GAME_OF[game].seats.max } : null;
  };
  const venueName = (cityId: CityId, venueId: string): string => cityContent(cityId).venues.find((venue) => venue.id === venueId)?.name ?? venueLabel(venueId, cityId);

  function tableOf(cityId: unknown, id: unknown, caller: string): Table {
    const city = ctx.cityIds.find((item) => item === cityId);
    if (city === undefined) throw refuse('invalid_city', 'That city is not available.');
    const phone = phonePlace(id);
    const place = phone ?? (typeof id === 'string' ? places(city).find((entry) => entry.id === id) ?? null : null);
    if (!place) throw refuse('unknown_table', 'That table does not exist.');
    // A Phone table is one per player (and per city): nobody else can find or watch it.
    const key = phone ? `${city}:${place.id}:${caller}` : `${city}:${place.id}`;
    let table = tables.get(key);
    if (!table) {
      const game = GAME_OF[place.game];
      table = { key, cityId: city, place, game, status: 'open', seats: [], options: game.cleanOptions({}), match: null, sockets: new Set(), timer: null, result: null, endedAt: 0 };
      tables.set(key, table);
    }
    return table;
  }
  const seatIndex = (table: Table, id: string) => table.seats.findIndex((seat) => !seat.bot && seat.id === id);
  const names = (table: Table) => table.seats.map((seat) => seat.name);
  const connected = (table: Table, id: string) => [...table.sockets].some((ws) => ws.session.id === id && ctx.core.isOpen(ws));

  /** What anyone may know about a table: who sits, whether a game is on. Never a card. */
  function summary(table: Table): TableSummary {
    return { id: table.place.id, venue: table.place.venue, venueLabel: table.place.venue === PHONE_VENUE ? 'Your Phone' : venueName(table.cityId, table.place.venue), game: table.place.game, gameLabel: table.game.label, label: table.place.label,
      status: table.status, max: Math.min(table.place.seats, table.game.seats.max), min: table.game.seats.min, options: table.options,
      seats: table.seats.map((seat) => ({ name: seat.name, bot: seat.bot, ...(seat.bot ? {} : { id: seat.id, away: seat.away > 0 }), ...(seat.left ? { left: true as const } : {}) })),
      watching: new Set([...table.sockets].map((ws) => ws.session.id).filter((id) => seatIndex(table, id) < 0)).size };
  }
  /** The table as one player (or a watcher) may see it. */
  function stateFor(table: Table, id: string): TableStateFrame {
    const seat = seatIndex(table, id), match = table.match;
    return { type: 'table-state', cityId: table.cityId, table: summary(table), you: seat >= 0 ? seat : null, host: table.seats.find((item) => !item.bot)?.id === id,
      n: match?.n ?? 0, view: match ? match.engine.view(seat >= 0 ? seat : null) : null, log: match?.log ?? [],
      toMove: match && table.status === 'playing' ? match.engine.toMove() : [], clock: match && table.status === 'playing' ? { deadline: match.deadline, now: now(), seconds: Math.ceil(match.allowedMs / 1000) } : null,
      result: table.result ? { text: table.result.text, calledOff: table.result.calledOff, winners: table.result.winners, mine: table.result.per[id] ?? null } : null,
      optionList: table.game.optionSpecs().map(([name, option]) => ({ name, label: option.label, values: [...option.values], names: option.names ? [...option.names] : option.values.map(String), value: table.options[name] as TableOptionValue })) };
  }
  function broadcast(table: Table): void {
    for (const ws of table.sockets) { if (ctx.core.isOpen(ws)) ctx.send(ws, stateFor(table, ws.session.id)); else table.sockets.delete(ws); }
    // Sockets that asked for a venue's list are told that it changed (no table data in the nudge).
    if (table.place.venue !== PHONE_VENUE) for (const ws of ctx.core.sockets()) if (ws.tablesVenue === `${table.cityId}:${table.place.venue}` && !table.sockets.has(ws) && ctx.core.isOpen(ws)) ctx.send(ws, { type: 'tables-changed', cityId: table.cityId, venue: table.place.venue });
    if (ctx.core?.hibernates === true && table.status === 'open') schedule(table);
  }

  // ---- the clock ----------------------------------------------------------------------------------
  function schedule(table: Table): void {
    if (table.timer) { clearTimeout(table.timer); table.timer = null; }
    let due = Infinity;
    if (table.status === 'playing') { const match = matchOf(table); due = Math.min(match.deadline, match.botAt ?? Infinity, ...table.seats.filter((seat) => seat.away > 0 && !seat.left).map((seat) => seat.away + TUNING.awayForfeitMs)); }
    else if (table.status === 'over') due = table.endedAt + TUNING.resetMs;
    // A host that forgets what is in memory when nothing is pending (the Worker: ctx.core.hibernates) keeps a timer
    // going while anyone sits at or watches an open table, so the seats are still there for the next message.
    else if (ctx.core?.hibernates === true && (table.seats.length || table.sockets.size)) due = now() + TUNING.keepAwakeMs;
    if (due === Infinity) return;
    // The delay is at least a quarter second of real time, so a clock that is not the wall clock (a test's) cannot spin.
    table.timer = setTimeout(() => { table.timer = null; void pump(table); }, Math.max(250, Math.min(due - now(), 60000)));
    table.timer.unref?.();
  }
  const rngFor = (match: Match, salt: string) => makeRng(`${match.seed}|${match.n}|${salt}`);
  function log(table: Table, text: string): void { const lines = matchOf(table).log; lines.push(withNames(text, names(table))); if (lines.length > TUNING.logLines) lines.shift(); }

  /** The clock for the move that starts now: the game's own (a chess clock) or its fixed `turnSeconds`. */
  function startTurn(table: Table, match: Match): void {
    match.turnStart = now();
    match.allowedMs = Math.max(1000, match.engine.clockMs() ?? table.game.turnSeconds * 1000);
    match.deadline = match.turnStart + match.allowedMs;
  }
  /** Play a move (a ParsedMove) for a seat, or, with `auto: 'timeout'` and no move, let the rules play for the clock. */
  function applyMove(table: Table, seat: number, move: ParsedMove | null, { auto = false }: { auto?: false | 'timeout' } = {}): void {
    const match = matchOf(table);
    const side = move?.side === true && auto === false;
    // A real move is charged the time it took; a side move (resign, offer a draw) is not a turn and leaves the clock alone.
    if (move && !side && auto === false) match.engine.charge(seat, now() - match.turnStart);
    const lines = auto === 'timeout' || !move ? match.engine.timeout(seat, rngFor(match, 'move')) : move.play(seat, rngFor(match, 'move'));
    for (const line of lines) log(table, line);
    match.last = { seat, n: match.n, move: move ? move.json : JSON.stringify(null) };
    match.n += 1;
    if (side) return;
    startTurn(table, match);
    const next = match.engine.toMove();
    match.botAt = next.some((index) => seatOf(table, index).bot) ? now() + TUNING.botDelayMs : null;
  }
  function forfeitSeat(table: Table, seat: number, why: string): void {
    const match = matchOf(table), leaver = seatOf(table, seat);
    if (leaver.left) return;
    leaver.left = true;
    match.engine.forfeit(seat);
    log(table, `{${seat}} ${why}`);
    match.n += 1;
    startTurn(table, match);
    match.botAt = match.engine.toMove().some((index) => seatOf(table, index).bot) ? now() + TUNING.botDelayMs : null;
    if (!leaver.bot) seated.delete(leaver.id);
  }

  /** Do everything that is due at this table now: bot moves, clocks that ran out, absent players, a finished game, a reset. */
  async function pump(table: Table): Promise<void> {
    if (table.pumping) return;
    table.pumping = true;
    try {
      let changed = false;
      for (let guard = 0; guard < 200 && table.status === 'playing'; guard++) {
        const match = matchOf(table);
        if (match.engine.outcome()) { await finish(table); changed = true; break; }
        const t = now(), toMove = match.engine.toMove();
        const gone = table.seats.findIndex((seat) => !seat.bot && !seat.left && seat.away > 0 && t - seat.away >= TUNING.awayForfeitMs);
        if (gone >= 0) { forfeitSeat(table, gone, 'did not come back and forfeits'); changed = true; continue; }
        // With no real player left at the table the game is simply cleared.
        if (!table.seats.some((seat) => !seat.bot && !seat.left)) { reset(table); changed = true; break; }
        const bot = toMove.find((index) => seatOf(table, index).bot);
        if (bot !== undefined && match.botAt !== null && t >= match.botAt) { applyMove(table, bot, match.engine.botMove(bot, rngFor(match, 'bot'))); changed = true; continue; }
        if (t >= match.deadline && toMove.length) {
          for (const index of toMove) {
            const seat = seatOf(table, index);
            if (seat.bot) { applyMove(table, index, match.engine.botMove(index, rngFor(match, 'bot'))); continue; }
            seat.misses = (seat.misses ?? 0) + 1;
            if (seat.misses >= TUNING.missesToForfeit) forfeitSeat(table, index, 'missed three turns and forfeits'); else applyMove(table, index, null, { auto: 'timeout' });
            break;
          }
          changed = true; continue;
        }
        break;
      }
      if (table.status === 'over' && now() - table.endedAt >= TUNING.resetMs) { reset(table); changed = true; }
      if (changed) broadcast(table);
    } finally { table.pumping = false; schedule(table); }
  }
  /** Back to an open table. The people still connected keep their seats; bots and leavers go. */
  function reset(table: Table): void {
    for (const seat of table.seats) if (!seat.bot && (seat.left || !connected(table, seat.id))) seated.delete(seat.id);
    table.seats = table.seats.filter((seat) => !seat.bot && !seat.left && connected(table, seat.id)).map((seat) => ({ id: seat.id, name: seat.name, bot: false, away: 0 }));
    table.status = 'open'; table.match = null; table.result = null; table.endedAt = 0;
  }

  /** A finished table that nobody is playing at any more: the next people who come may sit at once instead of waiting for the reset. */
  const abandoned = (table: Table) => table.status === 'over' && !table.seats.some((seat) => !seat.bot && !seat.left);

  /** The match is over: say so, and record what it earned — once, in one saved transaction. */
  async function finish(table: Table): Promise<void> {
    const match = matchOf(table), outcome = match.engine.outcome(), t = now();
    table.status = 'over'; table.endedAt = t;
    // pump only calls this once the rules say the game is over; the original read `outcome.reason` here and threw.
    if (!outcome) throw new Error(`Table ${table.key} finished without an outcome`);
    const humans = table.seats.map((seat, index) => ({ seat, index })).filter(({ seat }) => !seat.bot);
    // Moves a player really made: one the clock made for them does not count as playing.
    const calledOff = ['forfeit', 'resign', 'time'].includes(outcome.reason) && humans.some(({ seat }) => (seat.moves ?? 0) < TUNING.minMovesEach);
    const per: Record<string, TableResultMine> = {};
    const result: TableResult = { text: calledOff ? 'The game was called off before it really began. Nothing counts.' : withNames(outcome.text, names(table)), calledOff, winners: calledOff ? [] : outcome.winners, per };
    table.result = result;
    log(table, result.text);
    const game = table.place.game, label = table.game.label;
    try {
      await ctx.store.transact((db) => {
        const g = growthOf(ctx, db), book = g.tables, day = lagosTime(t).day;
        count(g, t, table.cityId, `table.${calledOff ? 'abandoned' : 'finished'}.${game}`);
        if (calledOff) return;
        if (!isRecord(book.pairs) || book.pairs.day !== day) book.pairs = { day, counts: {} };
        const ratings = ratingsForCity(g, table.cityId), pairs = book.pairs;
        const pairKey = (a: string, b: string) => [a, b].sort().join('|');
        // A game counts for a player when at least one real opponent is someone they have not yet played the day's limit against.
        const fresh = (id: string) => humans.some(({ seat }) => seat.id !== id && (pairs.counts[pairKey(id, seat.id)] ?? 0) < TABLE_REWARDS.pairGamesPerDay);
        const counted: Record<string, boolean> = Object.fromEntries(humans.map(({ seat }) => [seat.id, humans.length > 1 && fresh(seat.id)]));
        for (let a = 0; a < humans.length; a++) for (let b = a + 1; b < humans.length; b++) {
          const key = pairKey(humans[a]?.seat.id ?? '', humans[b]?.seat.id ?? '');
          if (Object.keys(pairs.counts).length < 20000 || Object.hasOwn(pairs.counts, key)) pairs.counts[key] = (pairs.counts[key] ?? 0) + 1;
        }
        // A rating moves only in a two-player game between two real players that counted.
        let changes: [number, number] | null = null;
        const [first, second] = humans;
        if (first && second && table.seats.length === 2 && humans.length === 2 && counted[first.seat.id]) {
          const record = (id: string) => ((ratings[id] ||= {})[game] ||= { rating: RATING.start, played: 0, won: 0 });
          const a = record(first.seat.id), b = record(second.seat.id);
          const score = outcome.draw ? 0.5 : outcome.winners.includes(first.index) ? 1 : 0;
          const moved = eloChange(a, b, score);
          changes = moved;
          for (const [rating, human, change] of [[a, first, moved[0]], [b, second, moved[1]]] as const) {
            rating.rating = Math.max(RATING.floor, rating.rating + change); rating.played += 1; if (!outcome.draw && outcome.winners.includes(human.index)) rating.won += 1;
          }
        }
        humans.forEach(({ seat, index }, i) => {
          const player = playerOf(g, seat.id), won = outcome.winners.includes(index);
          const entry = { cityId: table.cityId, id: match.id, game, label, won, human: humans.length > 1, counted: counted[seat.id] === true };
          const change = changes?.[i], rated = ratings[seat.id]?.[game];
          per[seat.id] = { won, draw: outcome.draw, human: entry.human, counted: entry.counted, ...(changes && rated && change !== undefined ? { rating: rated.rating, change } : {}) };
          if (!player) return;
          player.table = { cityId: table.cityId, game, label, won, at: t };
          if (!Array.isArray(player.wins)) player.wins = [];
          if (player.wins.length < 12) player.wins.push(entry);
        });
        count(g, t, table.cityId, humans.length > 1 ? 'table.human' : 'table.bot');
      });
    } catch (error) {
      // The write failed, so nothing was recorded: the table says so instead of promising a reward.
      table.result = { ...result, text: `${result.text} (The result could not be saved, so it does not count.)`, per: {} };
      ctx.core.log?.(`Table result not saved: ${String(messageOf(error) ?? error).split('\n')[0]?.slice(0, 120)}`);
    }
  }

  // ---- what a socket may ask ------------------------------------------------------------------------
  const limit = (ws: WsConnection) => { if (!ctx.allow(`tables:${ws.session.id}`, 240)) throw refuse('rate_limited', 'You are doing that too quickly. Wait a moment.'); };
  function attach(ws: WsConnection, table: Table): void {
    if (!table.sockets.has(ws) && table.sockets.size >= TUNING.maxSockets) throw refuse('table_crowded', 'Too many people are watching this table. Try again in a moment.');
    for (const other of tables.values()) if (other !== table && other.sockets.delete(ws)) settleAway(other, ws.session.id);
    table.sockets.add(ws);
    const seat = table.seats[seatIndex(table, ws.session.id)];
    if (seat) seat.away = 0;
  }
  function settleAway(table: Table, id: string): void {
    const index = seatIndex(table, id);
    if (index < 0 || connected(table, id)) return;
    if (table.status === 'playing') { seatOf(table, index).away = now(); schedule(table); }
    else { table.seats.splice(index, 1); seated.delete(id); if (abandoned(table)) reset(table); }
    broadcast(table);
  }
  /** Is this player's stored life standing in the table's venue right now? Read-only. */
  const atVenue = (ws: WsConnection, table: Table) => ctx.store.read((db) => { const state = ctx.core.sessionOf(ws, db)?.cities?.[table.cityId]?.state; return ready(state) && canOccupyVenue(state, table.place.venue); });

  /** The frames a table socket sends are any JSON object: every field is untrusted and read through tableOf and the checks below. */
  type Frame = Record<string, unknown>;
  const api = {
    /** Is this player seated at a table? (The room module does not move a seated player to another group.) */
    isSeated: (id: string): boolean => seated.has(id),
    list(ws: WsConnection, message: Frame): TablesFrame {
      // Reading the list changes nothing and is bounded by the host's own per-identity limit.
      const cityId = ctx.cityIds.find((item) => item === message.cityId);
      if (cityId === undefined) throw refuse('invalid_city', 'That city is not available.');
      const venue = typeof message.venue === 'string' ? message.venue : null;
      ws.tablesVenue = venue ? `${cityId}:${venue}` : null;
      return { type: 'tables', cityId, venue, tables: places(cityId).filter((place) => !venue || place.venue === venue).map((place) => summary(tableOf(cityId, place.id, ws.session.id))) };
    },
    watch(ws: WsConnection, message: Frame): void {
      limit(ws);
      const table = tableOf(message.cityId, message.table, ws.session.id);
      attach(ws, table);
      broadcast(table);
    },
    unwatch(ws: WsConnection): void { for (const table of tables.values()) if (table.sockets.delete(ws)) settleAway(table, ws.session.id); },
    async sit(ws: WsConnection, message: Frame): Promise<void> {
      limit(ws);
      const table = tableOf(message.cityId, message.table, ws.session.id), id = ws.session.id;
      if (seatIndex(table, id) >= 0) { attach(ws, table); broadcast(table); return; } // coming back to your own seat
      if (abandoned(table)) reset(table);
      if (table.status !== 'open') throw refuse('game_on', 'A game is on at this table. Watch it, or sit when it ends.');
      if (seated.has(id)) throw refuse('already_seated', 'You are sitting at another table. Leave it first.');
      if (table.seats.length >= Math.min(table.place.seats, table.game.seats.max)) throw refuse('table_full', 'Every seat at this table is taken.');
      if (table.seats.some((seat) => ctx.checks?.blocked?.(id, seat.id) === true)) throw refuse('table_closed', 'You cannot sit at this table right now.');
      if (table.place.venue !== PHONE_VENUE && !(await atVenue(ws, table))) throw refuse('not_here', `Go to ${venueName(table.cityId, table.place.venue)} to sit at this table. You can watch from anywhere.`);
      if (table.status !== 'open' || seatIndex(table, id) >= 0 || seated.has(id) || table.seats.length >= Math.min(table.place.seats, table.game.seats.max)) throw refuse('table_changed', 'The table changed while you were sitting down. Try again.');
      attach(ws, table);
      table.seats.push({ id, name: ws.session.name, bot: false, away: 0 });
      seated.set(id, table.key);
      broadcast(table);
    },
    options(ws: WsConnection, message: Frame): void {
      limit(ws);
      const table = tableOf(message.cityId, message.table, ws.session.id);
      if (table.status !== 'open') throw refuse('game_on', 'The rules cannot change during a game.');
      if (table.seats.find((seat) => !seat.bot)?.id !== ws.session.id) throw refuse('not_host', 'Whoever sat down first chooses the table’s rules.');
      table.options = table.game.cleanOptions({ ...table.options, ...(isRecord(message.options) ? message.options : {}) });
      broadcast(table);
    },
    async start(ws: WsConnection, message: Frame): Promise<{ humans: number }> {
      limit(ws);
      const table = tableOf(message.cityId, message.table, ws.session.id), id = ws.session.id;
      if (table.status === 'playing') throw refuse('game_on', 'A game is already on.');
      // A finished or called-off match does not hold the table: whoever is still seated may start the next one without leaving.
      const mine = table.seats[seatIndex(table, id)];
      if (!mine || (table.status === 'over' && mine.left)) throw refuse('not_seated', 'Sit down first.');
      if (table.status === 'over') { attach(ws, table); reset(table); }
      const max = Math.min(table.place.seats, table.game.seats.max);
      const bots = typeof message.bots === 'number' && Number.isInteger(message.bots) ? Math.max(0, Math.min(message.bots, max - table.seats.length, BOT_NAMES.length)) : 0;
      if (table.seats.length + bots < table.game.seats.min) throw refuse('need_players', `This game needs ${table.game.seats.min} players. Wait for someone, or play with a bot.`);
      for (let i = 0; i < bots; i++) table.seats.push({ id: `bot-${i}`, name: `${BOT_NAMES[i]} (bot)`, bot: true, away: 0 });
      const seed = `${ctx.randomId()}${ctx.randomId()}`;
      const matchId = ctx.randomId();
      const engine = table.game.start(table.seats.length, makeRng(`${seed}|deal`), table.options);
      const match: Match = { id: matchId, seed, n: 0, log: [], last: null, deadline: 0, turnStart: 0, allowedMs: 0, botAt: null, engine };
      startTurn(table, match);
      table.match = match; table.status = 'playing'; table.result = null;
      for (const seat of table.seats) { seat.misses = 0; seat.moves = 0; seat.left = false; }
      match.botAt = engine.toMove().some((index) => seatOf(table, index).bot) ? now() + TUNING.botDelayMs : null;
      log(table, `${table.game.label} begins: ${names(table).join(', ')}.`);
      const humans = table.seats.filter((seat) => !seat.bot).length;
      ctx.store.transact((db) => count(growthOf(ctx, db), now(), table.cityId, `table.started.${table.place.game}`), { durable: false }).catch(() => {});
      broadcast(table);
      await pump(table);
      return { humans };
    },
    async move(ws: WsConnection, message: Frame): Promise<void> {
      limit(ws);
      const table = tableOf(message.cityId, message.table, ws.session.id), id = ws.session.id, match = table.match;
      const seat = seatIndex(table, id);
      if (table.status !== 'playing' || !match) throw refuse('no_game', 'There is no game on at this table.');
      if (seat < 0 || seatOf(table, seat).left) throw refuse('not_seated', 'You are watching this game, not playing it.');
      const n = message.n;
      if (typeof n !== 'number' || !Number.isInteger(n)) throw refuse('invalid_move', 'That move was not understood.');
      let move: ParsedMove;
      try { move = match.engine.parseMove(message.move); } catch (error) { if (error instanceof RulesError) throw refuse('invalid_move', error.message); throw error; }
      // A retry of the move just made: answer with the state as it is and apply nothing.
      if (n === match.n - 1 && match.last?.seat === seat && match.last.n === n && match.last.move === move.retryKey) { ctx.send(ws, { ...stateFor(table, id), repeat: true }); return; }
      if (n !== match.n && !move.side) throw refuse('stale_move', 'The game moved on before that reached the table. Look again and play.');
      // A side move (resign, offer a draw) may come from any seat at any time; every other move only from a seat whose turn it is.
      if (!move.side && !match.engine.toMove().includes(seat)) throw refuse('not_your_turn', 'It is not your turn.');
      try { applyMove(table, seat, move); } catch (error) {
        if (error instanceof RulesError) {
          // A move that arrived after the mover's clock ran out was charged and found the game over: say so to everyone.
          if (match.engine.outcome()) { broadcast(table); await pump(table); }
          throw refuse('illegal_move', error.message);
        }
        throw error;
      }
      const mover = seatOf(table, seat);
      if (!move.side) { mover.misses = 0; mover.moves = (mover.moves ?? 0) + 1; }
      attach(ws, table);
      broadcast(table);
      await pump(table);
    },
    async leave(ws: WsConnection, message: Frame): Promise<void> {
      const table = tableOf(message.cityId, message.table, ws.session.id), id = ws.session.id, seat = seatIndex(table, id);
      if (seat < 0) { table.sockets.delete(ws); return; }
      if (table.status === 'playing' && !seatOf(table, seat).left) { forfeitSeat(table, seat, 'left the table'); broadcast(table); await pump(table); }
      else if (table.status === 'open') { table.seats.splice(seat, 1); seated.delete(id); broadcast(table); }
      else { seated.delete(id); seatOf(table, seat).left = true; if (abandoned(table)) reset(table); broadcast(table); }
    },
    /** Play again: the table opens with the people still here. */
    again(ws: WsConnection, message: Frame): void {
      limit(ws);
      const table = tableOf(message.cityId, message.table, ws.session.id);
      if (table.status !== 'over') throw refuse('game_on', 'The game is not over yet.');
      reset(table);
      broadcast(table); schedule(table);
    },
    /** A socket closed: it stops watching; a player with no other connection to the table is away (and may come back). */
    drop(ws: WsConnection): void { for (const table of tables.values()) if (table.sockets.delete(ws)) settleAway(table, ws.session.id); },
    /** Everything due now, at every table. Run on the server's heartbeat and by tests. */
    async pumpAll(): Promise<void> {
      for (const [key, table] of tables) {
        if (table.status !== 'open') await pump(table);
        // A Phone table nobody sits at or watches is forgotten, so the map holds only tables someone is using.
        else if (table.place.venue === PHONE_VENUE && !table.seats.length && !table.sockets.size) { if (table.timer) clearTimeout(table.timer); tables.delete(key); }
      }
    },
    /**
     * Apply the caller's finished games to their life: what a win pays and what counts for missions.
     * Runs inside the caller's store transaction; each pending result leaves the queue in that same
     * transaction, so it can be applied once only.
     */
    claim(g: GrowthCollection, session: SessionRecord, state: LifeState, cityId: CityId) {
      const player = playerOf(g, session.publicId, { create: false }), results: { game: ResultGameId; label: string; won: boolean; code: string }[] = [];
      for (const result of takePendingTableResults(player, cityId)) {
        const done = ctx.act(state, { type: 'growth.table-result', cityId, payload: { game: result.game, label: result.label, won: result.won, human: result.human, counted: result.counted },
          stateGuard: 'the pending table result is removed from the queue in this same transaction' });
        results.push({ game: result.game, label: result.label, won: result.won, code: done.code });
      }
      return { ok: true as const, code: 'claimed' as const, results, material: results.length > 0, ...(results.length ? { state } : {}) };
    },
    /** The caller's ratings, for their own screen. */
    ratings(g: GrowthCollection, id: string, cityId: CityId = 'lagos'): Partial<Record<TableGameId, TableRating>> {
      return Object.fromEntries(Object.entries(ratingsForCity(g, cityId)[id] ?? {}).map(([game, rating]) => [game, { rating: rating.rating, played: rating.played, won: rating.won, provisional: rating.played < RATING.provisionalGames }]));
    },
  };
  ctx.on?.('heartbeat', () => { void api.pumpAll(); });
  return api;
}
