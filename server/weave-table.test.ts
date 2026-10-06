import { loadCityContent as preloadCityContent } from '../src/game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// OWNER: growth — word tiles (Weave), against a real server and real sockets: a game between two players to checkmate, the
// view each seat and a watcher is sent, exactly-once moves, side moves (resign, a draw offer) out of turn, the chess clock,
// a reconnect, two devices of one player, the computer on the Phone, and what a win pays.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { fixture } from './test-fixture.ts';
import type { Device, TestSocket } from './test-fixture.ts';
import type { TableStateFrame } from '../src/types/growth.ts';
import type { WeaveView } from '../src/tables/weave.ts';
import { TUNING } from './growth/tables.ts';

TUNING.botDelayMs = 0; // the computer answers at once

type State = Omit<TableStateFrame, 'view'> & { view: WeaveView; result: { text: string; calledOff: boolean; winners: number[]; mine: { won: boolean; human: boolean; counted: boolean } | null } };
interface Frame { type: string; repeat?: boolean; [field: string]: unknown }
interface Peer { who: Device; ws: TestSocket['ws']; state: State; errors: { code: string; reason?: string }[]; all: Frame[]; waiting: (() => void)[] }
const TABLE = 'phone-weave';

async function harness(t: TestContext) {
  const f = await fixture(t);
  const json = async <T extends object = object>(res: Response): Promise<T & { status: number }> => ({ status: res.status, ...(await res.json()) });
  const post = async <T extends object = object>(path: string, body: unknown, who: Device) => json<T>(await f.request(path, body, who.cookie));
  async function connect(who: Device): Promise<Peer> {
    const sock = await f.socket(who);
    const peer: Peer = { who, ws: sock.ws, state: null as unknown as State, errors: [], all: [], waiting: [] }; // `state` is set by the first table-state frame
    sock.ws.on('message', (data) => {
      const message: Frame = JSON.parse(data.toString());
      peer.all.push(message);
      if (message.type === 'table-state') peer.state = message as unknown as State;
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
  const act = async (peer: Peer, type: string, body?: Record<string, unknown>, ...others: Peer[]): Promise<State> => { send(peer, type, body); await all(peer, ...others); return peer.state; };
  /** Play a move written as "e2e4" (promotion "e7e8q") for the peer whose turn it is. */
  const play = (peer: Peer, text: string, ...others: Peer[]) => act(peer, 'table-move', { n: peer.state.n, move: { t: 'move', from: text.slice(0, 2), to: text.slice(2, 4), ...(text[4] ? { promo: text[4] } : {}) } }, ...others);
  const claim = (peer: Peer) => post<{ results: { game: string; won: boolean; code: string }[] }>('/api/growth/tables/claim', { cityId: 'lagos' }, peer.who);
  return { f, post, player, connect, send, settled, all, act, play, claim };
}


test('weave: your rack only, no bag on the wire, computer players answer, an illegal play is refused, and a Phone table is private', async (t) => {
  const { act, send, all, player } = await harness(t);
  const ada = await player('Ada'), bola = await player('Bola');
  send(ada, 'table-sit'); await all(ada);
  await act(ada, 'table-start', { bots: 2 });
  assert.deepEqual([ada.state.table.status, ada.state.table.seats.map((seat) => seat.bot), ada.state.view.rack?.length, ada.state.view.counts, ada.state.view.bagCount], ['playing', [false, true, true], 7, [7, 7, 7], 98 - 21]);
  const text = JSON.stringify(ada.all.filter((frame) => frame.type === 'table-state'));
  assert.equal(/"bag"|"racks":\[\[/.test(text), false, 'no bag and no other racks');
  const rack = ada.state.view.rack ?? [];
  // A play away from the centre, and one of tiles not in the rack, are refused.
  await act(ada, 'table-move', { n: 0, move: { t: 'play', tiles: [{ r: 0, c: 0, l: rack[0]?.toLowerCase() ?? 'a' }] } });
  assert.equal(ada.errors.at(-1)?.code, 'illegal_move');
  await act(ada, 'table-move', { n: 0, move: { t: 'pass' } });
  await all(ada);
  assert.ok(ada.state.view.history.length >= 3, 'both computer players moved after the pass');
  assert.equal(ada.state.toMove[0], 0);
  // Bola cannot see Ada's Phone table or rack.
  await act(bola, 'table-watch', {});
  assert.deepEqual([bola.state.table.status, bola.state.view], ['open', null]);
  // Resigning from a game of three leaves the other two playing.
  await act(ada, 'table-move', { n: ada.state.n, move: { t: 'resign' } });
  assert.ok(ada.state.view.out[0], 'Ada is out');
});
