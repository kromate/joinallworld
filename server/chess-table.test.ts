import { loadCityContent as preloadCityContent } from '../src/game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// OWNER: growth — chess at a table, against a real server and real sockets: a game between two players to checkmate, the
// view each seat and a watcher is sent, exactly-once moves, side moves (resign, a draw offer) out of turn, the chess clock,
// a reconnect, two devices of one player, the computer on the Phone, and what a win pays.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { fixture } from './test-fixture.ts';
import type { Device, TestSocket } from './test-fixture.ts';
import type { TableStateFrame } from '../src/types/growth.ts';
import type { ChessView } from '../src/tables/chess.ts';
import { TUNING } from './growth/tables.ts';

TUNING.botDelayMs = 0; // the computer answers at once

type State = Omit<TableStateFrame, 'view'> & { view: ChessView; result: { text: string; calledOff: boolean; winners: number[]; mine: { won: boolean; human: boolean; counted: boolean } | null } };
interface Frame { type: string; repeat?: boolean; [field: string]: unknown }
interface Peer { who: Device; ws: TestSocket['ws']; state: State; errors: { code: string; reason?: string }[]; all: Frame[]; waiting: (() => void)[]; stateWaiters: { test(state: State): boolean; resolve(): void }[] }
const TABLE = 'park-chess';

async function harness(t: TestContext) {
  const f = await fixture(t);
  const json = async <T extends object = object>(res: Response): Promise<T & { status: number }> => ({ status: res.status, ...(await res.json()) });
  const post = async <T extends object = object>(path: string, body: unknown, who: Device) => json<T>(await f.request(path, body, who.cookie));
  async function connect(who: Device): Promise<Peer> {
    const sock = await f.socket(who);
    const peer: Peer = { who, ws: sock.ws, state: null as unknown as State, errors: [], all: [], waiting: [], stateWaiters: [] }; // `state` is set by the first table-state frame
    sock.ws.on('message', (data) => {
      const message: Frame = JSON.parse(data.toString());
      peer.all.push(message);
      if (message.type === 'table-state') {
        peer.state = message as unknown as State;
        for (let i = peer.stateWaiters.length - 1; i >= 0; i--) {
          const waiter = peer.stateWaiters[i];
          if (waiter?.test(peer.state)) { peer.stateWaiters.splice(i, 1); waiter.resolve(); }
        }
      }
      if (message.type === 'error') peer.errors.push(message as unknown as Peer['errors'][number]);
      if (message.type === 'tables') for (const done of peer.waiting.splice(0)) done();
    });
    return peer;
  }
  async function player(name: string): Promise<Peer> {
    const who = await f.device(name);
    await f.request('/api/life?city=lagos', null, who.cookie);
    await post('/api/growth/hello', { cityId: 'lagos' }, who);
    return connect(who);
  }
  const send = (peer: Peer, type: string, body: Record<string, unknown> = {}) => peer.ws.send(JSON.stringify({ type, cityId: 'lagos', table: TABLE, ...body }));
  const settled = (peer: Peer) => new Promise<void>((done) => { peer.waiting.push(done); peer.ws.send(JSON.stringify({ type: 'table-list', cityId: 'lagos', venue: 'park' })); });
  const all = async (...peers: Peer[]) => { for (const peer of peers) await settled(peer); };
  /** Wait for the authoritative table-state broadcast, with a timeout only to fail a broken test. */
  const stateUntil = (peer: Peer, predicate: (state: State) => boolean): Promise<void> => {
    if (peer.state && predicate(peer.state)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout>;
      const waiter = { test: predicate, resolve: () => { clearTimeout(timeout); resolve(); } };
      timeout = setTimeout(() => {
        const index = peer.stateWaiters.indexOf(waiter);
        if (index >= 0) peer.stateWaiters.splice(index, 1);
        reject(new Error('Table state broadcast did not arrive'));
      }, 2000);
      peer.stateWaiters.push(waiter);
    });
  };
  const act = async (peer: Peer, type: string, body?: Record<string, unknown>, ...others: Peer[]): Promise<State> => { send(peer, type, body); await all(peer, ...others); return peer.state; };
  /** Play a move written as "e2e4" (promotion "e7e8q") for the peer whose turn it is. */
  const play = (peer: Peer, text: string, ...others: Peer[]) => act(peer, 'table-move', { n: peer.state.n, move: { t: 'move', from: text.slice(0, 2), to: text.slice(2, 4), ...(text[4] ? { promo: text[4] } : {}) } }, ...others);
  const claim = (peer: Peer) => post<{ results: { game: string; won: boolean; code: string }[] }>('/api/growth/tables/claim', { cityId: 'lagos' }, peer.who);
  return { f, post, player, connect, send, settled, all, stateUntil, act, play, claim };
}

test('chess: two players play to checkmate; each sees the board, only the mover sees legal moves, a watcher cannot move, and a win is paid once', async (t) => {
  const { act, play, player, all, claim, send } = await harness(t);
  const ada = await player('Ada'), bola = await player('Bola'), chidi = await player('Chidi');
  await act(ada, 'table-sit', {}); await act(bola, 'table-sit', {}, ada);
  await act(chidi, 'table-watch', {});
  assert.deepEqual([ada.state.table.game, ada.state.table.max, ada.state.optionList.map((option) => option.name)], ['chess', 2, ['clock', 'colour', 'level']]);
  await act(ada, 'table-start', {}, bola, chidi);
  assert.deepEqual([ada.state.table.status, ada.state.you, bola.state.you, chidi.state.you], ['playing', 0, 1, null]);
  assert.deepEqual([ada.state.view.you, bola.state.view.you, chidi.state.view.you], ['w', 'b', null]);
  assert.equal(ada.state.view.legal.length, 20, 'White has twenty first moves');
  assert.deepEqual([bola.state.view.legal, chidi.state.view.legal], [[], []], 'the seat that is not to move, and a watcher, are not sent legal moves');
  assert.deepEqual(chidi.state.view.board.filter(Boolean).length, 32);

  // A watcher cannot move; Black cannot move out of turn; an illegal move is refused with a sentence and changes nothing.
  await act(chidi, 'table-move', { n: 0, move: { t: 'move', from: 'e2', to: 'e4' } });
  assert.equal(chidi.errors.at(-1)?.code, 'not_seated');
  await act(bola, 'table-move', { n: 0, move: { t: 'move', from: 'e7', to: 'e5' } }, ada);
  assert.equal(bola.errors.at(-1)?.code, 'not_your_turn');
  await act(ada, 'table-move', { n: 0, move: { t: 'move', from: 'e2', to: 'e5' } });
  assert.equal(ada.errors.at(-1)?.code, 'illegal_move');
  await act(ada, 'table-move', { n: 0, move: { t: 'nonsense' } });
  assert.equal(ada.errors.at(-1)?.code, 'invalid_move');
  assert.equal(ada.state.n, 0);

  // Fool's mate. A retry of the move just made is applied once; a wrong number is stale.
  await play(ada, 'f2f3', bola, chidi);
  send(ada, 'table-move', { n: 0, move: { t: 'move', from: 'f2', to: 'f3' } }); await all(ada);
  assert.deepEqual([ada.state.n, ada.state.view.history], [1, ['f3']]);
  assert.equal(ada.all.at(-2)?.repeat === true || ada.all.some((frame) => frame.repeat === true), true, 'the retry is answered as a repeat');
  await act(ada, 'table-move', { n: 5, move: { t: 'move', from: 'g2', to: 'g4' } });
  assert.ok(['stale_move', 'not_your_turn'].includes(ada.errors.at(-1)?.code ?? ''));
  await play(bola, 'e7e5', ada, chidi);
  await play(ada, 'g2g4', bola, chidi);
  await play(bola, 'd8h4', ada, chidi);
  assert.deepEqual([ada.state.table.status, ada.state.result.winners, ada.state.view.history.at(-1)], ['over', [1], 'Qh4#']);
  assert.match(ada.state.result.text, /Bola wins by checkmate/);
  assert.deepEqual([bola.state.result.mine?.won, ada.state.result.mine?.won, chidi.state.result.mine], [true, false, null]);
  assert.deepEqual((await claim(bola)).results.map((item) => [item.game, item.code]), [['chess', 'paid']]);
  assert.deepEqual((await claim(bola)).results, []);
  assert.deepEqual((await claim(ada)).results.map((item) => item.code), ['counted']);
});

test('chess: resign and a draw offer are made out of turn, a draw needs the other player, and the clock is the table’s own', async (t) => {
  const { f, act, play, player, all, stateUntil, claim } = await harness(t);
  const ada = await player('Ada'), bola = await player('Bola');
  await act(ada, 'table-sit', {}); await act(bola, 'table-sit', {}, ada);
  await act(ada, 'table-options', { options: { clock: '5+3', colour: 'black' } }, bola);
  assert.deepEqual([ada.state.table.options, bola.state.table.options.clock], [{ clock: '5+3', colour: 'black', level: 'medium' }, '5+3']);
  await act(ada, 'table-start', {}, bola);
  // The host chose Black, so Bola (seat 1) is White and is to move.
  assert.deepEqual([ada.state.view.you, bola.state.view.you, ada.state.toMove, ada.state.view.turn], ['b', 'w', [1], 'w']);
  assert.equal(ada.state.clock?.seconds, 300);
  await play(bola, 'e2e4', ada);
  await play(ada, 'e7e5', bola);
  // Bola is to move; Ada (not to move) offers a draw. It does not change the turn or the number of the move.
  const before = bola.state.n;
  await act(ada, 'table-move', { n: ada.state.n, move: { t: 'offer-draw' } }, bola);
  assert.deepEqual([bola.state.view.drawOffer, bola.state.toMove, bola.state.clock?.deadline === ada.state.clock?.deadline], ['b', [1], true]);
  assert.equal(bola.state.n, before + 1);
  // The offerer cannot accept her own offer; Bola declines by playing on.
  await act(ada, 'table-move', { n: ada.state.n, move: { t: 'accept-draw' } }, bola);
  assert.ok(ada.errors.length > 0);
  await play(bola, 'g1f3', ada);
  assert.equal(ada.state.view.drawOffer, null, 'moving declines the offer');
  await play(ada, 'b8c6', bola);
  await play(bola, 'f1c4', ada);
  // Time passes on Ada’s clock: she is to move and does not. She has 5 minutes and the 3 seconds each of her two moves earned.
  const tick = async (ms: number, waitForFinish = false) => {
    // A non-expired pump checks the clock synchronously. For expiration, wait for the state frame
    // that is broadcast only after finish() commits the result, rather than sleeping a guessed interval.
    const finished = waitForFinish ? stateUntil(ada, state => state.cityId === 'lagos' && state.table.id === TABLE && state.table.status === 'over' && state.result !== null) : null;
    f.advance(ms); f.server.beat();
    if (finished) await finished;
    await all(ada, bola);
  };
  await tick(305000);
  assert.equal(ada.state.table.status, 'playing');
  await tick(2000, true);
  assert.deepEqual([ada.state.table.status, ada.state.result.winners], ['over', [1]]);
  assert.match(ada.state.result.text, /time/i);
  // Both had really played twice, so it counts.
  assert.deepEqual((await claim(bola)).results.map((item) => item.code), ['paid']);
});

test('chess: resigning before a real game began is called off; a resignation after two moves each counts', async (t) => {
  const { act, play, player, claim } = await harness(t);
  const ada = await player('Ada'), bola = await player('Bola');
  await act(ada, 'table-sit', {}); await act(bola, 'table-sit', {}, ada);
  await act(ada, 'table-start', {}, bola);
  await act(bola, 'table-move', { n: bola.state.n, move: { t: 'resign' } }, ada);
  assert.deepEqual([ada.state.table.status, ada.state.result.calledOff], ['over', true]);
  assert.deepEqual([(await claim(ada)).results, (await claim(bola)).results], [[], []]);
  await act(ada, 'table-again', {}, bola);
  await act(ada, 'table-start', {}, bola);
  for (const [who, move] of [[ada, 'e2e4'], [bola, 'e7e5'], [ada, 'g1f3'], [bola, 'b8c6']] as const) await play(who, move, who === ada ? bola : ada);
  await act(bola, 'table-move', { n: bola.state.n, move: { t: 'resign' } }, ada);
  assert.deepEqual([ada.state.table.status, ada.state.result.calledOff, ada.state.result.winners], ['over', false, [0]]);
  assert.deepEqual((await claim(ada)).results.map((item) => item.code), ['paid']);
});

test('chess: two devices of one player see the same game, and a player who comes back to the table gets the same seat', async (t) => {
  const { act, play, player, connect, all } = await harness(t);
  const ada = await player('Ada'), bola = await player('Bola');
  await act(ada, 'table-sit', {}); await act(bola, 'table-sit', {}, ada);
  await act(ada, 'table-start', {}, bola);
  const phone = await connect(ada.who);
  await act(phone, 'table-watch', {});
  assert.deepEqual([phone.state.you, phone.state.view.legal.length], [0, 20]);
  await play(phone, 'd2d4', ada, bola);
  assert.deepEqual([ada.state.view.history, bola.state.view.history], [['d4'], ['d4']], 'the move made on one device shows on the other');
  // Her first socket drops; the second keeps the seat. Then both go: she is away, and comes back to her seat.
  ada.ws.close(); await new Promise((done) => setTimeout(done, 60)); await all(bola);
  assert.equal(bola.state.table.seats[0]?.away, false);
  phone.ws.close(); await new Promise((done) => setTimeout(done, 60)); await all(bola);
  assert.equal(bola.state.table.seats[0]?.away, true);
  const back = await connect(ada.who);
  await act(back, 'table-watch', {}, bola);
  assert.deepEqual([back.state.you, back.state.view.history, bola.state.table.seats[0]?.away], [0, ['d4'], false]);
});

test('chess: on the Phone it is you against the computer, anywhere; nobody else can see it; the computer is labelled as one and plays by itself', async (t) => {
  const { act, send, all, player, claim } = await harness(t);
  const ada = await player('Ada'), bola = await player('Bola');
  // Not at a venue with a chess table: the Phone table needs no venue.
  send(ada, 'table-sit', { table: 'phone-chess' }); await all(ada);
  assert.deepEqual([ada.errors, ada.state.table.venueLabel, ada.state.you], [[], 'Your Phone', 0]);
  await act(ada, 'table-options', { table: 'phone-chess', options: { level: 'easy' } });
  await act(ada, 'table-start', { table: 'phone-chess', bots: 1 });
  assert.deepEqual([ada.state.table.status, ada.state.table.seats.map((seat) => [seat.bot, /\(bot\)$/.test(seat.name)]), ada.state.view.legal.length], ['playing', [[false, false], [true, true]], 20]);
  await act(ada, 'table-move', { table: 'phone-chess', n: 0, move: { t: 'move', from: 'e2', to: 'e4' } });
  await all(ada);
  assert.ok(ada.state.view.history.length >= 2, 'the computer replied by itself');
  // Bola's Phone table is her own, and is empty.
  await act(bola, 'table-watch', { table: 'phone-chess' });
  assert.deepEqual([bola.state.table.status, bola.state.table.seats.length, bola.state.you], ['open', 0, null]);
  // Resigning at once is called off; a bot game never pays.
  await act(ada, 'table-move', { table: 'phone-chess', n: ada.state.n, move: { t: 'resign' } });
  assert.equal(ada.state.table.status, 'over');
  assert.deepEqual((await claim(ada)).results.map((item) => item.code).filter((code) => code === 'paid'), []);
});

test('Whot and penalties on the Phone: a private game against the computer, like chess and Weave, with no venue', async (t) => {
  const { act, send, all, player, claim } = await harness(t);
  const ada = await player('Ada'), bola = await player('Bola');
  for (const [table, game, label] of [['phone-whot', 'whot', 'Whot on your Phone'], ['phone-penalty', 'penalty', 'Penalties on your Phone']] as const) {
    send(ada, 'table-sit', { table }); await all(ada);
    assert.deepEqual([ada.errors, ada.state.table.venueLabel, ada.state.table.label, ada.state.table.game, ada.state.you], [[], 'Your Phone', label, game, 0], table);
    await act(ada, 'table-start', { table, bots: 1 });
    assert.deepEqual([ada.state.table.status, ada.state.table.seats.map((seat) => seat.bot)], ['playing', [false, true]], table);
    // Nobody else can see it: Bola's Phone table of the same game is her own, and empty.
    await act(bola, 'table-watch', { table });
    assert.deepEqual([bola.state.table.status, bola.state.table.seats.length, bola.state.you], ['open', 0, null], table);
    await act(ada, 'table-leave', { table });
    assert.deepEqual((await claim(ada)).results.map((item) => item.code).filter((code) => code === 'paid'), [], 'a game against the computer pays nothing');
  }
  send(ada, 'table-sit', { table: 'phone-nothing' }); await all(ada);
  assert.equal(ada.errors.at(-1)?.code, 'unknown_table');
});
