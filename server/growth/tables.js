/**
 * OWNER: growth
 * The table service: every game table in every venue, the matches played at them, and what a
 * finished match records. The server is the only judge: it holds each match's full state, applies
 * every move through the game's own rules (src/tables/<game>.js), plays the bots, keeps the clock
 * on its own time, and sends each seat only what the rules' `view` says that seat may see.
 *
 * A TABLE is a place in a venue (src/tables/places.js). You sit only while your stored life is in
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
 * caps of src/game/content/growth.js; the same two players' games count three times a day.
 */
import { lagosTime } from '../../src/game/clock.js';
import { makeRng } from '../../src/game/util.js';
import { TABLE_REWARDS } from '../../src/game/content/growth.js';
import { venueLabel } from '../../src/game/content/venues.js';
import { TABLES, BOT_NAMES, tableById } from '../../src/tables/places.js';
import { GAMES } from '../../src/tables/games.js';
import { RulesError, RATING, cleanOptions, eloChange, withNames } from '../../src/tables/rules.js';
import { canOccupyVenue } from '../protocol.js';
import { growthOf, playerOf } from './data.js';
import { count } from './metrics.js';

/** Timings. A test may shorten them; nothing else should. */
export const TUNING = { botDelayMs: 900, awayForfeitMs: 120000, resetMs: 45000, missesToForfeit: 3, maxSockets: 40, logLines: 30, minMovesEach: 2 };
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const refuse = (code, reason) => Object.assign(new Error(code), { reason });
const ready = (state) => Boolean(state) && !(state.onboarding?.required === true && state.onboarding.done !== true);
const services = new WeakMap();

export function tablesService(ctx) {
  const cached = services.get(ctx);
  if (cached) return cached;
  const now = () => ctx.now();
  /** @type {Map<string, object>} `${cityId}:${tableId}` → table */
  const tables = new Map();
  /** publicId → the key of the table that player is seated at */
  const seated = new Map();

  function tableOf(cityId, id) {
    if (!ctx.cityIds.includes(cityId)) throw refuse('invalid_city', 'That city is not available.');
    const place = typeof id === 'string' ? tableById(id) : null;
    if (!place || !Object.hasOwn(GAMES, place.game)) throw refuse('unknown_table', 'That table does not exist.');
    const key = `${cityId}:${place.id}`;
    if (!tables.has(key)) {
      const rules = GAMES[place.game];
      tables.set(key, { key, cityId, place, rules, status: 'open', seats: [], options: cleanOptions(rules, {}), match: null, sockets: new Set(), timer: null, result: null, endedAt: 0 });
    }
    return tables.get(key);
  }
  const seatIndex = (table, id) => table.seats.findIndex((seat) => !seat.bot && seat.id === id);
  const names = (table) => table.seats.map((seat) => seat.name);
  const connected = (table, id) => [...table.sockets].some((ws) => ws.session.id === id && ctx.core.isOpen(ws));

  /** What anyone may know about a table: who sits, whether a game is on. Never a card. */
  function summary(table) {
    return { id: table.place.id, venue: table.place.venue, venueLabel: venueLabel(table.place.venue, table.cityId), game: table.place.game, gameLabel: table.rules.label, label: table.place.label,
      status: table.status, max: Math.min(table.place.seats, table.rules.seats.max), min: table.rules.seats.min, options: table.options,
      seats: table.seats.map((seat) => ({ name: seat.name, bot: seat.bot, ...(seat.bot ? {} : { id: seat.id, away: seat.away > 0 }), ...(seat.left ? { left: true } : {}) })),
      watching: new Set([...table.sockets].map((ws) => ws.session.id).filter((id) => seatIndex(table, id) < 0)).size };
  }
  /** The table as one player (or a watcher) may see it. */
  function stateFor(table, id) {
    const seat = seatIndex(table, id), match = table.match;
    return { type: 'table-state', cityId: table.cityId, table: summary(table), you: seat >= 0 ? seat : null, host: table.seats.find((item) => !item.bot)?.id === id,
      n: match?.n ?? 0, view: match ? table.rules.view(match.state, seat >= 0 ? seat : null) : null, log: match?.log ?? [],
      toMove: match && table.status === 'playing' ? table.rules.toMove(match.state) : [], clock: match && table.status === 'playing' ? { deadline: match.deadline, now: now(), seconds: table.rules.turnSeconds } : null,
      result: table.result ? { text: table.result.text, calledOff: table.result.calledOff, winners: table.result.winners, mine: table.result.per[id] ?? null } : null,
      optionList: Object.entries(table.rules.options).map(([name, option]) => ({ name, label: option.label, values: option.values, names: option.names ?? option.values.map(String), value: table.options[name] })) };
  }
  function broadcast(table) {
    for (const ws of table.sockets) { if (ctx.core.isOpen(ws)) ctx.send(ws, stateFor(table, ws.session.id)); else table.sockets.delete(ws); }
    // Sockets that asked for a venue's list are told that it changed (no table data in the nudge).
    for (const ws of ctx.core.sockets()) if (ws.tablesVenue === `${table.cityId}:${table.place.venue}` && !table.sockets.has(ws) && ctx.core.isOpen(ws)) ctx.send(ws, { type: 'tables-changed', cityId: table.cityId, venue: table.place.venue });
  }

  // ---- the clock ----------------------------------------------------------------------------------
  function schedule(table) {
    if (table.timer) { clearTimeout(table.timer); table.timer = null; }
    let due = Infinity;
    if (table.status === 'playing') due = Math.min(table.match.deadline, table.match.botAt ?? Infinity, ...table.seats.filter((seat) => seat.away > 0 && !seat.left).map((seat) => seat.away + TUNING.awayForfeitMs));
    else if (table.status === 'over') due = table.endedAt + TUNING.resetMs;
    if (due === Infinity) return;
    // The delay is at least a quarter second of real time, so a clock that is not the wall clock (a test's) cannot spin.
    table.timer = setTimeout(() => { table.timer = null; void pump(table); }, Math.max(250, Math.min(due - now(), 60000)));
    table.timer.unref?.();
  }
  const rngFor = (match, salt) => makeRng(`${match.seed}|${match.n}|${salt}`);
  function log(table, text) { const lines = table.match.log; lines.push(withNames(text, names(table))); if (lines.length > TUNING.logLines) lines.shift(); }

  function applyMove(table, seat, move, { auto = false } = {}) {
    const match = table.match;
    const line = auto ? null : table.rules.describe(match.state, seat, move);
    const before = match.state;
    match.state = auto === 'timeout' ? table.rules.timeout(before, seat, rngFor(match, 'move')) : table.rules.apply(before, seat, move, rngFor(match, 'move'));
    if (line) log(table, line); else log(table, `{${seat}} ran out of time`);
    for (const extra of table.rules.report?.(before, match.state) ?? []) log(table, extra);
    match.last = { seat, n: match.n, move: JSON.stringify(move ?? null) };
    match.n += 1;
    match.deadline = now() + table.rules.turnSeconds * 1000;
    const next = table.rules.toMove(match.state);
    match.botAt = next.some((index) => table.seats[index].bot) ? now() + TUNING.botDelayMs : null;
  }
  function forfeitSeat(table, seat, why) {
    const match = table.match;
    if (table.seats[seat].left) return;
    table.seats[seat].left = true;
    match.state = table.rules.forfeit(match.state, seat);
    log(table, `{${seat}} ${why}`);
    match.n += 1;
    match.deadline = now() + table.rules.turnSeconds * 1000;
    match.botAt = table.rules.toMove(match.state).some((index) => table.seats[index].bot) ? now() + TUNING.botDelayMs : null;
    if (!table.seats[seat].bot) seated.delete(table.seats[seat].id);
  }

  /** Do everything that is due at this table now: bot moves, clocks that ran out, absent players, a finished game, a reset. */
  async function pump(table) {
    if (table.pumping) return;
    table.pumping = true;
    try {
      let changed = false;
      for (let guard = 0; guard < 200 && table.status === 'playing'; guard++) {
        const match = table.match;
        if (table.rules.outcome(match.state)) { await finish(table); changed = true; break; }
        const t = now(), toMove = table.rules.toMove(match.state);
        const gone = table.seats.findIndex((seat) => !seat.bot && !seat.left && seat.away > 0 && t - seat.away >= TUNING.awayForfeitMs);
        if (gone >= 0) { forfeitSeat(table, gone, 'did not come back and forfeits'); changed = true; continue; }
        // With no real player left at the table the game is simply cleared.
        if (!table.seats.some((seat) => !seat.bot && !seat.left)) { reset(table); changed = true; break; }
        const bot = toMove.find((index) => table.seats[index].bot);
        if (bot !== undefined && match.botAt !== null && t >= match.botAt) { applyMove(table, bot, table.rules.parseMove(table.rules.bot(match.state, bot, rngFor(match, 'bot')))); changed = true; continue; }
        if (t >= match.deadline && toMove.length) {
          for (const index of toMove) {
            const seat = table.seats[index];
            if (seat.bot) { applyMove(table, index, table.rules.parseMove(table.rules.bot(match.state, index, rngFor(match, 'bot')))); continue; }
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
  function reset(table) {
    for (const seat of table.seats) if (!seat.bot && (seat.left || !connected(table, seat.id))) seated.delete(seat.id);
    table.seats = table.seats.filter((seat) => !seat.bot && !seat.left && connected(table, seat.id)).map((seat) => ({ id: seat.id, name: seat.name, bot: false, away: 0 }));
    table.status = 'open'; table.match = null; table.result = null; table.endedAt = 0;
  }

  /** The match is over: say so, and record what it earned — once, in one saved transaction. */
  async function finish(table) {
    const match = table.match, outcome = table.rules.outcome(match.state), t = now();
    table.status = 'over'; table.endedAt = t;
    const humans = table.seats.map((seat, index) => ({ seat, index })).filter(({ seat }) => !seat.bot);
    // Moves a player really made: one the clock made for them does not count as playing.
    const calledOff = outcome.reason === 'forfeit' && humans.some(({ seat }) => (seat.moves ?? 0) < TUNING.minMovesEach);
    const per = {};
    table.result = { text: calledOff ? 'The game was called off before it really began. Nothing counts.' : withNames(outcome.text, names(table)), calledOff, winners: calledOff ? [] : outcome.winners, per };
    log(table, table.result.text);
    const game = table.place.game, label = table.rules.label;
    try {
      await ctx.store.transact((db) => {
        const g = growthOf(ctx, db), book = g.tables, day = lagosTime(t).day;
        count(g, t, `table.${calledOff ? 'abandoned' : 'finished'}.${game}`);
        if (calledOff) return;
        if (!isRecord(book.ratings)) book.ratings = {};
        if (!isRecord(book.pairs) || book.pairs.day !== day) book.pairs = { day, counts: {} };
        const pairKey = (a, b) => [a, b].sort().join('|');
        // A game counts for a player when at least one real opponent is someone they have not yet played the day's limit against.
        const fresh = (id) => humans.some(({ seat }) => seat.id !== id && (book.pairs.counts[pairKey(id, seat.id)] ?? 0) < TABLE_REWARDS.pairGamesPerDay);
        const counted = Object.fromEntries(humans.map(({ seat }) => [seat.id, humans.length > 1 && fresh(seat.id)]));
        for (let a = 0; a < humans.length; a++) for (let b = a + 1; b < humans.length; b++) {
          const key = pairKey(humans[a].seat.id, humans[b].seat.id);
          if (Object.keys(book.pairs.counts).length < 20000 || Object.hasOwn(book.pairs.counts, key)) book.pairs.counts[key] = (book.pairs.counts[key] ?? 0) + 1;
        }
        // A rating moves only in a two-player game between two real players that counted.
        let changes = null;
        if (table.seats.length === 2 && humans.length === 2 && counted[humans[0].seat.id]) {
          const record = (id) => ((book.ratings[id] ||= {})[game] ||= { rating: RATING.start, played: 0, won: 0 });
          const [a, b] = humans.map(({ seat }) => record(seat.id));
          const score = outcome.draw ? 0.5 : outcome.winners.includes(humans[0].index) ? 1 : 0;
          changes = eloChange(a, b, score);
          [a, b].forEach((rating, i) => { rating.rating = Math.max(RATING.floor, rating.rating + changes[i]); rating.played += 1; if (!outcome.draw && outcome.winners.includes(humans[i].index)) rating.won += 1; });
        }
        humans.forEach(({ seat, index }, i) => {
          const player = playerOf(g, seat.id), won = outcome.winners.includes(index);
          const result = { id: match.id, game, label, won, human: humans.length > 1, counted: counted[seat.id] };
          per[seat.id] = { won, draw: outcome.draw, human: result.human, counted: result.counted, ...(changes ? { rating: book.ratings[seat.id][game].rating, change: changes[i] } : {}) };
          if (!player) return;
          player.table = { game, label, won, at: t };
          if (!Array.isArray(player.wins)) player.wins = [];
          if (player.wins.length < 12) player.wins.push(result);
        });
        count(g, t, humans.length > 1 ? 'table.human' : 'table.bot');
      });
    } catch (error) {
      // The write failed, so nothing was recorded: the table says so instead of promising a reward.
      table.result = { ...table.result, text: `${table.result.text} (The result could not be saved, so it does not count.)`, per: {} };
      ctx.core.log?.(`Table result not saved: ${String(error?.message ?? error).split('\n')[0].slice(0, 120)}`);
    }
  }

  // ---- what a socket may ask ------------------------------------------------------------------------
  const limit = (ws) => { if (!ctx.allow(`tables:${ws.session.id}`, 240)) throw refuse('rate_limited', 'You are doing that too quickly. Wait a moment.'); };
  function attach(ws, table) {
    if (!table.sockets.has(ws) && table.sockets.size >= TUNING.maxSockets) throw refuse('table_crowded', 'Too many people are watching this table. Try again in a moment.');
    for (const other of tables.values()) if (other !== table && other.sockets.delete(ws)) settleAway(other, ws.session.id);
    table.sockets.add(ws);
    const seat = table.seats[seatIndex(table, ws.session.id)];
    if (seat) seat.away = 0;
  }
  function settleAway(table, id) {
    const index = seatIndex(table, id);
    if (index < 0 || connected(table, id)) return;
    if (table.status === 'playing') { table.seats[index].away = now(); schedule(table); }
    else { table.seats.splice(index, 1); seated.delete(id); }
    broadcast(table);
  }
  /** Is this player's stored life standing in the table's venue right now? Read-only. */
  const atVenue = (ws, table) => ctx.store.read((db) => { const state = ctx.core.sessionOf(ws, db)?.cities?.[table.cityId]?.state; return ready(state) && canOccupyVenue(state, table.place.venue); });

  const api = {
    list(ws, message) {
      // Reading the list changes nothing and is bounded by the host's own per-identity limit.
      if (!ctx.cityIds.includes(message.cityId)) throw refuse('invalid_city', 'That city is not available.');
      const venue = typeof message.venue === 'string' ? message.venue : null;
      ws.tablesVenue = venue ? `${message.cityId}:${venue}` : null;
      return { type: 'tables', cityId: message.cityId, venue, tables: TABLES.filter((place) => Object.hasOwn(GAMES, place.game) && (!venue || place.venue === venue)).map((place) => summary(tableOf(message.cityId, place.id))) };
    },
    watch(ws, message) {
      limit(ws);
      const table = tableOf(message.cityId, message.table);
      attach(ws, table);
      broadcast(table);
    },
    unwatch(ws) { for (const table of tables.values()) if (table.sockets.delete(ws)) settleAway(table, ws.session.id); },
    async sit(ws, message) {
      limit(ws);
      const table = tableOf(message.cityId, message.table), id = ws.session.id;
      if (seatIndex(table, id) >= 0) { attach(ws, table); broadcast(table); return; } // coming back to your own seat
      if (table.status !== 'open') throw refuse('game_on', 'A game is on at this table. Watch it, or sit when it ends.');
      if (seated.has(id)) throw refuse('already_seated', 'You are sitting at another table. Leave it first.');
      if (table.seats.length >= Math.min(table.place.seats, table.rules.seats.max)) throw refuse('table_full', 'Every seat at this table is taken.');
      if (table.seats.some((seat) => ctx.checks?.blocked?.(id, seat.id) === true)) throw refuse('table_closed', 'You cannot sit at this table right now.');
      if (!(await atVenue(ws, table))) throw refuse('not_here', `Go to ${venueLabel(table.place.venue, table.cityId)} to sit at this table. You can watch from anywhere.`);
      if (table.status !== 'open' || seatIndex(table, id) >= 0 || seated.has(id) || table.seats.length >= Math.min(table.place.seats, table.rules.seats.max)) throw refuse('table_changed', 'The table changed while you were sitting down. Try again.');
      attach(ws, table);
      table.seats.push({ id, name: ws.session.name, bot: false, away: 0 });
      seated.set(id, table.key);
      broadcast(table);
    },
    options(ws, message) {
      limit(ws);
      const table = tableOf(message.cityId, message.table);
      if (table.status !== 'open') throw refuse('game_on', 'The rules cannot change during a game.');
      if (table.seats.find((seat) => !seat.bot)?.id !== ws.session.id) throw refuse('not_host', 'Whoever sat down first chooses the table’s rules.');
      table.options = cleanOptions(table.rules, { ...table.options, ...(isRecord(message.options) ? message.options : {}) });
      broadcast(table);
    },
    async start(ws, message) {
      limit(ws);
      const table = tableOf(message.cityId, message.table), id = ws.session.id;
      if (table.status !== 'open') throw refuse('game_on', 'A game is already on.');
      if (seatIndex(table, id) < 0) throw refuse('not_seated', 'Sit down first.');
      const max = Math.min(table.place.seats, table.rules.seats.max);
      const bots = Number.isInteger(message.bots) ? Math.max(0, Math.min(message.bots, max - table.seats.length, BOT_NAMES.length)) : 0;
      if (table.seats.length + bots < table.rules.seats.min) throw refuse('need_players', `This game needs ${table.rules.seats.min} players. Wait for someone, or play with a bot.`);
      for (let i = 0; i < bots; i++) table.seats.push({ id: `bot-${i}`, name: `${BOT_NAMES[i]} (bot)`, bot: true, away: 0 });
      const seed = `${ctx.randomId()}${ctx.randomId()}`;
      const match = { id: ctx.randomId(), seed, n: 0, log: [], last: null, deadline: now() + table.rules.turnSeconds * 1000, botAt: null, state: null };
      match.state = table.rules.start(table.seats.length, makeRng(`${seed}|deal`), table.options);
      table.match = match; table.status = 'playing'; table.result = null;
      for (const seat of table.seats) { seat.misses = 0; seat.moves = 0; seat.left = false; }
      match.botAt = table.rules.toMove(match.state).some((index) => table.seats[index].bot) ? now() + TUNING.botDelayMs : null;
      log(table, `${table.rules.label} begins: ${names(table).join(', ')}.`);
      const humans = table.seats.filter((seat) => !seat.bot).length;
      ctx.store.transact((db) => count(growthOf(ctx, db), now(), `table.started.${table.place.game}`), { durable: false }).catch(() => {});
      broadcast(table);
      await pump(table);
      return { humans };
    },
    async move(ws, message) {
      limit(ws);
      const table = tableOf(message.cityId, message.table), id = ws.session.id, match = table.match;
      const seat = seatIndex(table, id);
      if (table.status !== 'playing' || !match) throw refuse('no_game', 'There is no game on at this table.');
      if (seat < 0 || table.seats[seat].left) throw refuse('not_seated', 'You are watching this game, not playing it.');
      if (!Number.isInteger(message.n)) throw refuse('invalid_move', 'That move was not understood.');
      let move;
      try { move = table.rules.parseMove(message.move); } catch (error) { if (error instanceof RulesError) throw refuse('invalid_move', error.message); throw error; }
      // A retry of the move just made: answer with the state as it is and apply nothing.
      if (message.n === match.n - 1 && match.last?.seat === seat && match.last.n === message.n && match.last.move === JSON.stringify(move)) { ctx.send(ws, { ...stateFor(table, id), repeat: true }); return; }
      if (message.n !== match.n) throw refuse('stale_move', 'The game moved on before that reached the table. Look again and play.');
      if (!table.rules.toMove(match.state).includes(seat)) throw refuse('not_your_turn', 'It is not your turn.');
      try { applyMove(table, seat, move); } catch (error) { if (error instanceof RulesError) throw refuse('illegal_move', error.message); throw error; }
      table.seats[seat].misses = 0;
      table.seats[seat].moves = (table.seats[seat].moves ?? 0) + 1;
      attach(ws, table);
      broadcast(table);
      await pump(table);
    },
    async leave(ws, message) {
      const table = tableOf(message.cityId, message.table), id = ws.session.id, seat = seatIndex(table, id);
      if (seat < 0) { table.sockets.delete(ws); return; }
      if (table.status === 'playing' && !table.seats[seat].left) { forfeitSeat(table, seat, 'left the table'); broadcast(table); await pump(table); }
      else if (table.status === 'open') { table.seats.splice(seat, 1); seated.delete(id); broadcast(table); }
      else { seated.delete(id); table.seats[seat].left = true; broadcast(table); }
    },
    /** Play again: the table opens with the people still here. */
    again(ws, message) {
      limit(ws);
      const table = tableOf(message.cityId, message.table);
      if (table.status !== 'over') throw refuse('game_on', 'The game is not over yet.');
      reset(table);
      broadcast(table); schedule(table);
    },
    /** A socket closed: it stops watching; a player with no other connection to the table is away (and may come back). */
    drop(ws) { for (const table of tables.values()) if (table.sockets.delete(ws)) settleAway(table, ws.session.id); },
    /** Everything due now, at every table. Run on the server's heartbeat and by tests. */
    async pumpAll() { for (const table of tables.values()) if (table.status !== 'open') await pump(table); },
  };
  ctx.on?.('heartbeat', () => { void api.pumpAll(); });

  /**
   * Apply the caller's finished games to their life: what a win pays and what counts for missions.
   * Runs inside the caller's store transaction; each pending result leaves the queue in that same
   * transaction, so it can be applied once only.
   */
  api.claim = (g, session, state, cityId) => {
    const player = playerOf(g, session.publicId, { create: false }), results = [];
    for (const result of (player?.wins ?? []).splice(0, 12)) {
      const done = ctx.act(state, { type: 'growth.table-result', cityId, payload: { game: result.game, label: result.label, won: result.won, human: result.human, counted: result.counted },
        stateGuard: 'the pending table result is removed from the queue in this same transaction' });
      results.push({ game: result.game, label: result.label, won: result.won, code: done.code });
    }
    return { ok: true, code: 'claimed', results, material: results.length > 0, ...(results.length ? { state } : {}) };
  };
  /** The caller's ratings, for their own screen. */
  api.ratings = (g, id) => Object.fromEntries(Object.entries(g.tables?.ratings?.[id] ?? {}).map(([game, rating]) => [game, { rating: rating.rating, played: rating.played, won: rating.won, provisional: rating.played < RATING.provisionalGames }]));

  services.set(ctx, api);
  return api;
}
