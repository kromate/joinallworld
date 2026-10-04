// OWNER: growth — the game tables against a real server and real sockets: sitting, a whole game of
// Whot between two players and against a bot, what each socket is and is not sent, exactly-once
// moves, reconnecting, the clock, and what a result pays (the daily and per-pair caps).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.js';
import { TUNING } from './growth/tables.js';
import { TABLE_REWARDS } from '../src/game/content/growth.js';
import { TABLES } from '../src/tables/places.js';

const DAY = 86400000;
TUNING.botDelayMs = 0; // bots answer at once, so a test never waits on a timer

async function harness(t) {
  const f = await fixture(t, { publicOrigin: 'https://play.example' });
  const json = async (res) => ({ status: res.status, ...(await res.json()) });
  const post = async (path, body, who) => json(await f.request(path, body, who.cookie));
  const life = async (who) => (await json(await f.request('/api/life?city=lagos', null, who.cookie))).state;
  /** A player with a life (new lives stand in Freedom Park) and one socket. */
  async function player(name) {
    const who = await f.device(name);
    await life(who);
    await post('/api/growth/hello', { cityId: 'lagos' }, who);
    return connect(who);
  }
  async function connect(who) {
    const sock = await f.socket(who);
    const peer = { who, ws: sock.ws, state: null, errors: [], all: [], lists: 0, waiting: [] };
    sock.ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      peer.all.push(message);
      if (message.type === 'table-state') peer.state = message;
      if (message.type === 'error') peer.errors.push(message);
      if (message.type === 'tables') { peer.lists += 1; peer.list = message; for (const done of peer.waiting.splice(0)) done(); }
    });
    return peer;
  }
  const send = (peer, type, body = {}) => peer.ws.send(JSON.stringify({ type, cityId: 'lagos', table: 'park-bench', ...body }));
  /** Wait until the server has handled everything this socket sent (messages of one socket are handled in order). */
  const settled = (peer) => new Promise((done) => { peer.waiting.push(done); peer.ws.send(JSON.stringify({ type: 'table-list', cityId: 'lagos', venue: 'park' })); });
  const all = async (...peers) => { for (const peer of peers) await settled(peer); };
  const act = async (peer, type, body, ...others) => { send(peer, type, body); await all(peer, ...others); return peer.state; };
  /** The move a careful player makes: the first card that may be played (naming a shape for a Whot), otherwise the market. */
  const choose = (view) => (view.playable.length ? { t: 'play', i: view.playable[0], ...(view.hand[view.playable[0]].s === 'whot' ? { shape: 'circle' } : {}) } : { t: 'draw' });
  /** Play until the game is over (or `moves` moves were made). Every peer must be seated. */
  async function playOn(peers, moves = Infinity) {
    for (let made = 0; made < moves && peers[0].state.table.status === 'playing'; made++) {
      const mover = peers.find((peer) => peer.state.toMove.includes(peer.state.you));
      assert.ok(mover, 'someone seated is to move');
      await act(mover, 'table-move', { n: mover.state.n, move: choose(mover.state.view) }, ...peers.filter((peer) => peer !== mover));
      assert.deepEqual(mover.errors, [], JSON.stringify(mover.errors.at(-1)));
    }
  }
  /** Play until both have really moved twice (a Hold On or a Suspension can give one player several turns in a row). */
  async function bothMoveTwice(a, b) {
    const made = new Map([[a, 0], [b, 0]]);
    while (a.state.table.status === 'playing' && Math.min(...made.values()) < 2) {
      const mover = a.state.toMove.includes(a.state.you) ? a : b;
      await playOn([mover, mover === a ? b : a], 1);
      made.set(mover, made.get(mover) + 1);
    }
  }
  const claim = (peer) => post('/api/growth/tables/claim', { cityId: 'lagos' }, peer.who);
  const wins = async (peer) => (await life(peer.who)).ledger.filter((line) => line.reason.startsWith('Table win'));
  return { f, post, life, player, connect, send, settled, all, act, playOn, bothMoveTwice, claim, wins };
}

test('tables: sit at a table in your venue, watch from anywhere, one seat per player, and the first to sit sets the rules', async (t) => {
  const { act, player, all } = await harness(t);
  const ada = await player('Ada'), bola = await player('Bola'), chidi = await player('Chidi');
  await all(ada);
  assert.deepEqual(ada.list.tables.map((table) => [table.id, table.gameLabel, table.status, table.seats.length, table.max]), [['park-bench', 'Whot', 'open', 0, 4], ['park-goal', 'Penalties', 'open', 0, 2]]);
  assert.ok(TABLES.some((table) => table.venue === 'amala-shitta') && TABLES.some((table) => table.venue === 'viewing-centre'), 'the buka and the viewing centre have tables too');
  // Nobody is at the buka: sitting there is refused with the reason, watching is allowed.
  await act(ada, 'table-sit', { table: 'buka-corner' });
  assert.deepEqual([ada.errors.at(-1).code, /Go to .* to sit at this table/.test(ada.errors.at(-1).reason)], ['not_here', true]);
  await act(ada, 'table-watch', { table: 'buka-corner' });
  assert.deepEqual([ada.state.table.id, ada.state.you, ada.state.view], ['buka-corner', null, null]);
  for (const bad of [{ table: 'nope' }, { table: 7 }, { cityId: 'atlantis' }]) { const before = ada.errors.length; await act(ada, 'table-sit', bad); assert.equal(ada.errors.length, before + 1, JSON.stringify(bad)); }

  let state = await act(ada, 'table-sit', {}, bola);
  assert.deepEqual([state.you, state.host, state.table.seats.map((seat) => [seat.name, seat.bot])], [0, true, [['Ada', false]]]);
  await act(ada, 'table-sit', { table: 'park-bench' });
  assert.equal(ada.state.table.seats.length, 1, 'sitting again is the same seat');
  await act(bola, 'table-sit', {}, ada);
  assert.deepEqual(ada.state.table.seats.map((seat) => seat.name), ['Ada', 'Bola']);
  // The rules: only the host, only before a game, only known options and values.
  await act(bola, 'table-options', { options: { hand: 6 } });
  assert.equal(bola.errors.at(-1).code, 'not_host');
  await act(ada, 'table-options', { options: { hand: 4, defend: 'stack', market: 'sideways', cheat: true } }, bola);
  assert.deepEqual([ada.state.table.options, bola.state.table.options], [{ hand: 4, defend: 'stack', market: 'count' }, { hand: 4, defend: 'stack', market: 'count' }]);
  assert.deepEqual(ada.state.optionList.map((option) => [option.name, option.value]), [['hand', 4], ['defend', 'stack'], ['market', 'count']]);
  // Chidi only watches: he is counted, gets the watcher's view, and cannot start or move.
  await act(chidi, 'table-watch', {}, ada);
  assert.deepEqual([chidi.state.you, ada.state.table.watching], [null, 1]);
  await act(chidi, 'table-start', {});
  assert.equal(chidi.errors.at(-1).code, 'not_seated');
  // A game needs two.
  await act(bola, 'table-leave', {}, ada);
  await act(ada, 'table-start', {});
  assert.deepEqual([ada.errors.at(-1).code, ada.state.table.status], ['need_players', 'open']);
});

test('tables: a whole game of Whot between two real sockets — hidden hands, an illegal move refused, exactly-once moves, a reconnect, the result paid once', async (t) => {
  const { f, act, all, player, connect, playOn, claim, wins, life, send } = await harness(t);
  const ada = await player('Ada'), bola = await player('Bola'), chidi = await player('Chidi');
  await act(ada, 'table-sit', {}); await act(bola, 'table-sit', {}, ada); await act(chidi, 'table-watch', {});
  await act(ada, 'table-start', {}, bola, chidi);
  assert.deepEqual([ada.state.table.status, ada.state.you, bola.state.you, ada.state.toMove, ada.state.n], ['playing', 0, 1, [0], 0]);
  assert.ok(ada.state.clock.deadline === f.now() + 30000 && ada.state.clock.seconds === 30);

  // WHAT EACH SOCKET IS SENT. Its own hand; counts for everyone else; a watcher no hand at all.
  const hands = { ada: ada.state.view.hand, bola: bola.state.view.hand };
  assert.deepEqual([hands.ada.length, hands.bola.length, ada.state.view.counts, chidi.state.view.hand, chidi.state.view.playable], [5, 5, [5, 5], null, []]);
  const key = (card) => `"s":"${card.s}","n":${card.n}}`;
  const leaks = (peer, cards) => { const top = key(peer.state.view.top); return cards.filter((card) => card.s !== 'whot' && key(card) !== top).some((card) => peer.all.some((message) => message.type === 'table-state' && JSON.stringify(message).includes(key(card)))); };
  assert.equal(leaks(bola, hands.ada) || leaks(ada, hands.bola) || leaks(chidi, [...hands.ada, ...hands.bola]), false, 'no socket was ever sent a card from another hand');
  assert.equal(bola.all.concat(ada.all, chidi.all).some((message) => /"hands"|"market":\[|"seed"/.test(JSON.stringify(message))), false, 'nor the market’s order, nor the seed');
  assert.deepEqual(bola.state.view.playable, [], 'only the seat to move is told what it may play');

  // AN ILLEGAL MOVE is refused in words and changes nothing; so is a move out of turn, a stale number and nonsense.
  const n0 = ada.state.n, unplayable = ada.state.view.hand.findIndex((card, index) => !ada.state.view.playable.includes(index));
  if (unplayable >= 0) { await act(ada, 'table-move', { n: n0, move: { t: 'play', i: unplayable } }); assert.deepEqual([ada.errors.at(-1).code, /does not go on|Name the shape/.test(ada.errors.at(-1).reason)], ['illegal_move', true]); }
  await act(bola, 'table-move', { n: n0, move: { t: 'draw' } });
  assert.equal(bola.errors.at(-1).code, 'not_your_turn');
  await act(ada, 'table-move', { n: n0 + 5, move: { t: 'draw' } });
  assert.equal(ada.errors.at(-1).code, 'stale_move');
  for (const move of [null, 'draw', { t: 'steal' }, { t: 'play', i: 99 }, { t: 'play', i: -1 }]) { await act(ada, 'table-move', { n: n0, move }); assert.match(ada.errors.at(-1).code, /invalid_move|illegal_move/); }
  await act(chidi, 'table-move', { n: n0, move: { t: 'draw' } });
  assert.equal(chidi.errors.at(-1).code, 'not_seated');
  assert.deepEqual([ada.state.n, ada.state.view.hand, bola.state.view.counts], [n0, hands.ada, [5, 5]], 'nothing moved');
  ada.errors.length = 0; bola.errors.length = 0;

  // EXACTLY ONCE. Ada goes to market, and the same message is sent three more times (a retry on a bad network).
  const draw = { n: n0, move: { t: 'draw' } };
  await act(ada, 'table-move', draw, bola);
  for (let i = 0; i < 3; i++) await act(ada, 'table-move', draw, bola);
  assert.deepEqual([ada.state.n, ada.state.view.hand.length, ada.state.view.counts, ada.errors, ada.all.filter((message) => message.repeat).length], [n0 + 1, 6, [6, 5], [], 3], 'one card was drawn, not four; the repeats were answered with the state');

  // RECONNECT. Bola's connection dies mid-game; a new socket takes the same seat with the same cards.
  await playOn([bola, ada], 3);
  const before = { hand: bola.state.view.hand, n: bola.state.n };
  bola.ws.terminate();
  await new Promise((done) => setTimeout(done, 30));
  await all(ada);
  assert.equal(ada.state.table.seats[1].away, true, 'the table shows Bola as away, and keeps his seat');
  const back = await connect(bola.who);
  await act(back, 'table-sit', {}, ada);
  assert.deepEqual([back.state.you, back.state.view.hand, back.state.n, ada.state.table.seats[1].away], [1, before.hand, before.n, false]);

  // Play it out.
  await playOn([ada, back]);
  const result = ada.state.result;
  assert.deepEqual([ada.state.table.status, result.calledOff, result.winners.length <= 1, typeof result.text], ['over', false, true, 'string']);
  assert.ok(ada.state.view.shown.length === 2, 'the hands are laid on the table once it is over');
  const winner = result.winners[0] === 0 ? ada : back, loser = winner === ada ? back : ada;
  if (result.winners.length) {
    assert.deepEqual([winner.state.result.mine.won, winner.state.result.mine.human, winner.state.result.mine.counted, loser.state.result.mine.won], [true, true, true, false]);
    assert.deepEqual([winner.state.result.mine.change, loser.state.result.mine.change, winner.state.result.mine.rating], [20, -20, 1220], 'a first rated game between two new players');
    assert.equal(chidi.state.result.mine, null, 'a watcher has no result');
    // THE RESULT IS PAID ONCE, by the winner's own claim; the loser is paid nothing; a second claim finds nothing.
    const cash = (await life(winner.who)).cash;
    const first = await claim(winner);
    assert.deepEqual([first.results.map((item) => [item.game, item.won, item.code]), first.ratings.whot.rating, first.ratings.whot.provisional], [[['whot', true, 'paid']], 1220, true]);
    assert.deepEqual([(await claim(winner)).results, (await life(winner.who)).cash - cash, (await wins(winner)).length], [[], TABLE_REWARDS.win, 1]);
    assert.deepEqual([(await claim(loser)).results.map((item) => item.code), (await wins(loser)).length], [['counted'], 0]);
  }
  // Play again: the table opens with the people still here; the watcher can now sit.
  send(ada, 'table-again'); await all(ada, back, chidi);
  assert.deepEqual([ada.state.table.status, ada.state.table.seats.map((seat) => seat.name).sort(), ada.state.view, ada.state.result], ['open', ['Ada', 'Bola'], null, null]);
  await act(chidi, 'table-sit', {}, ada);
  assert.equal(ada.state.table.seats.length, 3);
});

test('tables: against a bot — labelled as one, plays by itself, pays nothing, and only the first bot game of a day counts for missions', async (t) => {
  const { act, player, playOn, claim, wins } = await harness(t);
  const ada = await player('Ada');
  const codes = [];
  for (let round = 0; round < 2; round++) {
    await act(ada, 'table-sit', {});
    await act(ada, 'table-start', { bots: 9 });
    assert.deepEqual(ada.state.table.seats.map((seat) => [seat.name, seat.bot]), [['Ada', false], ['Mama Put (bot)', true], ['Oga Landlord (bot)', true], ['Sisi Eko (bot)', true]], 'bots fill the table, up to its size, and say what they are');
    assert.deepEqual(ada.state.toMove, [0], 'the bots have moved; it is Ada’s turn again or still');
    await playOn([ada]);
    assert.deepEqual([ada.state.table.status, ada.state.result.mine.human, ada.state.result.mine.counted, ada.state.result.mine.rating], ['over', false, false, undefined]);
    assert.ok(ada.state.log.length > 3 && ada.state.log.some((line) => /\(bot\) (played|went to market|picked)/.test(line)));
    codes.push((await claim(ada)).results[0].code);
    await act(ada, 'table-again', {});
  }
  assert.deepEqual([codes, (await wins(ada)).length], [['counted', 'for_fun'], 0]);
});

test('tables: the clock plays for a seat that does not move, three misses forfeit, and a game abandoned before it began is called off', async (t) => {
  const { f, act, all, player, claim, playOn, bothMoveTwice, wins } = await harness(t);
  const ada = await player('Ada'), bola = await player('Bola');
  await act(ada, 'table-sit', {}); await act(bola, 'table-sit', {}, ada);
  await act(ada, 'table-start', {}, bola);
  const tick = async (ms) => { f.advance(ms); f.server.beat(); await new Promise((done) => setTimeout(done, 20)); await all(ada, bola); };
  // 29 seconds: nothing. 31 seconds: Ada's turn is played for her (she goes to market).
  await tick(29000);
  assert.deepEqual([ada.state.n, ada.state.view.counts], [0, [5, 5]]);
  await tick(2000);
  assert.deepEqual([ada.state.n, ada.state.view.counts, ada.state.toMove, ada.state.log.at(-1)], [1, [6, 5], [1], 'Ada ran out of time']);
  // Whenever it is Bola's turn he plays; whenever it is Ada's she lets the clock run. Her third miss forfeits — and as she
  // never made two real moves, the game is called off: nothing counts for anyone.
  for (let guard = 0; guard < 40 && ada.state.table.status === 'playing'; guard++) {
    if (ada.state.toMove.includes(1)) await playOn([bola, ada], 1); else await tick(31000);
  }
  assert.equal(ada.state.table.status, 'over');
  if (ada.state.result.winners.length === 0) {
    assert.deepEqual([ada.state.result.calledOff, ada.state.result.mine], [true, null]);
    assert.match(ada.state.result.text, /called off/);
    assert.ok(ada.state.log.some((line) => line === 'Ada missed three turns and forfeits'));
    assert.deepEqual([(await claim(bola)).results, (await claim(ada)).results], [[], []]);
  } else { await claim(bola); await claim(ada); } // Bola emptied his hand first: an ordinary win
  // A proper game that one player then leaves: the other wins, and it counts.
  await act(ada, 'table-again', {}, bola);
  await act(bola, 'table-sit', {}, ada); await act(ada, 'table-sit', {}, bola);
  await act(ada, 'table-start', {}, bola);
  await bothMoveTwice(ada, bola);
  if (ada.state.table.status === 'playing') {
    await act(bola, 'table-leave', {}, ada);
    assert.deepEqual([ada.state.table.status, ada.state.result.calledOff, ada.state.result.mine?.won], ['over', false, true]);
    assert.match(ada.state.result.text, /Bola left the table\. Ada wins\./);
    assert.deepEqual([(await claim(ada)).results.map((item) => item.code), (await wins(ada)).length], [['paid'], 1]);
  }
  // A table left alone resets by itself after a while.
  await tick(TUNING.resetMs + 1000);
  assert.equal(ada.state.table.status, 'open');
});

test('tables: four paid wins a day and three counted games a day against the same player, however many are played', async (t) => {
  const { f, act, player, claim, bothMoveTwice, wins, post } = await harness(t);
  const ada = await player('Ada'), bola = await player('Bola'), chidi = await player('Chidi');
  /** A short proper game: two moves each, then the opponent leaves and Ada wins. */
  async function beat(opponent) {
    await act(ada, 'table-again', {}, opponent).catch(() => {});
    ada.errors.length = 0;
    await act(ada, 'table-sit', {}, opponent); await act(opponent, 'table-sit', {}, ada);
    await act(ada, 'table-start', {}, opponent);
    await bothMoveTwice(ada, opponent);
    if (ada.state.table.status === 'playing') await act(opponent, 'table-leave', {}, ada);
    const mine = ada.state.result.mine;
    return mine ? [mine.counted, (await claim(ada)).results[0]?.code, mine.won] : null;
  }
  const outcomes = [];
  for (const opponent of [bola, bola, bola, bola, chidi, chidi]) { outcomes.push((await beat(opponent)) ?? [null, 'lost']); await claim(opponent); }
  // A game can also end by the cards before anyone leaves; those Ada lost are not in the list. What she won follows the caps:
  // against Bola only the first three games count, and after four paid wins a counted win pays nothing.
  let paid = 0, bolaGames = 0;
  const games = [bola, bola, bola, bola, chidi, chidi];
  outcomes.forEach(([counted, code, won], index) => {
    const expectCounted = games[index] === bola ? bolaGames++ < TABLE_REWARDS.pairGamesPerDay : true;
    assert.equal(counted, expectCounted, `game ${index + 1} counted`);
    assert.equal(code, !counted ? 'for_fun' : won && paid < TABLE_REWARDS.paidWinsPerDay ? 'paid' : 'counted', `game ${index + 1}`);
    if (code === 'paid') paid += 1;
  });
  assert.equal(outcomes.length, 6);
  // (Almost always the opponent leaves and Ada wins all six; a game the cards ended first is checked by the loop above.)
  if (outcomes.every(([, , won]) => won)) assert.deepEqual(outcomes.map(([, code]) => code), ['paid', 'paid', 'paid', 'for_fun', 'paid', 'counted']);
  assert.deepEqual([(await wins(ada)).length, TABLE_REWARDS.paidWinsPerDay, TABLE_REWARDS.pairGamesPerDay], [paid, 4, 3]);
  // The next Lagos day both limits start again.
  f.advance(DAY);
  const next = await beat(bola);
  assert.deepEqual([next[0], next[1]], [true, next[2] ? 'paid' : 'counted']);
  // A table can be shared as an invitation: the link lands beside it.
  const shared = await post('/api/growth/share', { cityId: 'lagos', kind: 'table', table: 'park-bench' }, ada.who);
  assert.deepEqual([shared.share.facts.tableId, shared.share.facts.game, shared.share.facts.venue], ['park-bench', 'Whot', 'Freedom Park']);
  const html = await (await fetch(`${f.base}${shared.share.path}`)).text();
  assert.ok(html.includes(`url=/?join=${ada.who.id}&amp;ref=${shared.share.code}&amp;table=park-bench`) && html.includes('Come and play Whot with Ada'));
  assert.equal((await post('/api/growth/share', { cityId: 'lagos', kind: 'table', table: '../x' }, ada.who)).status, 400);
});

test('tables: a penalty shoot-out between two real sockets and against a bot — secret choices, both revealed together, paid like any win', async (t) => {
  const { act, all, player, connect, claim, wins } = await harness(t);
  const goal = { table: 'park-goal' };
  const ada = await player('Ada'), bola = await player('Bola'), chidi = await player('Chidi');
  await act(ada, 'table-sit', goal); await act(bola, 'table-sit', goal, ada); await act(chidi, 'table-watch', goal);
  await act(chidi, 'table-sit', goal);
  assert.equal(chidi.errors.at(-1).code, 'table_full', 'a shoot-out is for two');
  await act(ada, 'table-start', goal, bola, chidi);
  assert.deepEqual([ada.state.toMove, ada.state.view.kicker, ada.state.clock.seconds], [[0, 1], 0, 15]);
  // Bola (in goal) chooses first. Nobody — not Ada, not the watcher — is sent his choice.
  await act(bola, 'table-move', { ...goal, n: bola.state.n, move: { z: 2 } }, ada, chidi);
  assert.deepEqual([bola.state.view.mine, ada.state.view.mine, chidi.state.view.mine, ada.state.view.chosen, ada.state.toMove, ada.state.log.at(-1)], [2, null, null, [false, true], [0], 'Bola is ready']);
  assert.equal(ada.all.concat(chidi.all).some((message) => /"picks"|"mine":2/.test(JSON.stringify(message))), false);
  // A second choice for the same kick is refused; so is a side that does not exist.
  await act(bola, 'table-move', { ...goal, n: bola.state.n, move: { z: 0 } });
  assert.equal(bola.errors.at(-1).code, 'not_your_turn');
  await act(ada, 'table-move', { ...goal, n: ada.state.n, move: { z: 7 } });
  assert.equal(ada.errors.at(-1).code, 'invalid_move');
  // Ada shoots left: a goal, shown to everyone at the same moment.
  await act(ada, 'table-move', { ...goal, n: ada.state.n, move: { z: 0 } }, bola, chidi);
  for (const peer of [ada, bola, chidi]) assert.deepEqual([peer.state.view.goals, peer.state.view.history, peer.state.view.kicker, peer.state.log.at(-1)], [[1, 0], [{ kicker: 0, shot: 0, dive: 2, goal: true }], 1, 'GOAL! Ada shot left, Bola went right. 1–0']);
  // Reconnect in the middle of a shoot-out: same seat, same score.
  ada.ws.terminate();
  await new Promise((done) => setTimeout(done, 30));
  const back = await connect(ada.who);
  await act(back, 'table-sit', goal, bola);
  assert.deepEqual([back.state.you, back.state.view.goals], [0, [1, 0]]);
  // Ada always scores (left against right), Bola is always saved (centre against centre): 3–0 after three each ends it early.
  for (let guard = 0; guard < 12 && back.state.table.status === 'playing'; guard++) {
    const adaKicks = back.state.view.kicker === 0;
    await act(back, 'table-move', { ...goal, n: back.state.n, move: { z: adaKicks ? 0 : 1 } }, bola);
    await act(bola, 'table-move', { ...goal, n: bola.state.n, move: { z: adaKicks ? 2 : 1 } }, back, chidi);
  }
  assert.deepEqual([back.state.table.status, back.state.view.goals, back.state.result.mine.won, bola.state.result.mine.won, back.state.result.mine.change], ['over', [3, 0], true, false, 20]);
  assert.match(back.state.result.text, /Ada wins the shoot-out 3–0/);
  assert.deepEqual([(await claim(back)).results.map((item) => [item.game, item.code]), (await wins(back)).map((line) => line.reason)], [[['penalty', 'paid']], ['Table win: Penalties']]);
  // Against the house keeper: it chooses by itself, and the game pays nothing.
  const dayo = await player('Dayo');
  const sand = { table: 'beach-goal' };
  await act(dayo, 'table-watch', sand);
  assert.equal(dayo.state.table.venueLabel.length > 0, true);
  await act(dayo, 'table-sit', sand);
  assert.equal(dayo.errors.at(-1).code, 'not_here', 'the beach table is at the beach');
  await act(back, 'table-leave', goal); await act(bola, 'table-leave', goal); // the two get up, so the goal is free
  await act(dayo, 'table-watch', goal); await act(dayo, 'table-again', goal);
  await act(dayo, 'table-sit', goal); await act(dayo, 'table-start', { ...goal, bots: 1 });
  assert.deepEqual([dayo.state.table.seats.map((seat) => seat.bot), dayo.state.toMove], [[false, true], [0]], 'the bot has already chosen');
  for (let guard = 0; guard < 40 && dayo.state.table.status === 'playing'; guard++) await act(dayo, 'table-move', { ...goal, n: dayo.state.n, move: { z: guard % 3 } });
  assert.deepEqual([dayo.state.table.status, dayo.state.result.mine.human, (await claim(dayo)).results.map((item) => item.code), (await wins(dayo)).length], ['over', false, ['counted'], 0]);
});
