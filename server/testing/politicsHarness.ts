// OWNER: politics — the shared set-up of the politics tests: a server on a Monday morning, players with work behind them, and a way to seat an officeholder.
import assert from 'node:assert/strict';
import { fixture } from '../test-fixture.ts';
import { JOURNEY_TIME } from './cityJourney.ts';
import { lagosTime } from '../../src/game/clock.ts';
import type { PoliticsResponse } from '../../src/types/politics.ts';
import type { LifeState } from '../../src/types/life.ts';
import type { Database } from '../types.ts';
import { emptyPolitics } from '../politics/data.ts';
import { cityOf, emptyCivic } from '../civic/data.ts';
import { snapshot } from '../test-fixture.ts';

export type Fixture = Awaited<ReturnType<typeof fixture>>;
export type Device = Awaited<ReturnType<Fixture['device']>>;
export type Answer = Record<string, unknown> & { status: number; state?: LifeState; politics?: PoliticsResponse; code?: string; amount?: number }
export const DAY = 86400000;
export const object = (value: unknown): Record<string, unknown> => { assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>; };

export async function harness(t: Parameters<typeof fixture>[0]) {
  const f = await fixture(t);
  f.advance(JOURNEY_TIME - f.now());
  const send = async (path: string, init: RequestInit, device?: Device): Promise<Answer> => {
    const response = await fetch(f.base + path, { ...init, headers: { 'Content-Type': 'application/json', ...(device ? { Cookie: device.cookie } : {}) } });
    return { ...object(await response.json()), status: response.status } as Answer;
  };
  const post = (path: string, body: object, device?: Device) => send(path, { method: 'POST', body: JSON.stringify(body) }, device);
  const get = (path: string, device?: Device) => send(path, {}, device);
  const edit = (device: Device, change: (state: LifeState) => void) => f.server.store.transact((db) => { const state = db.sessions[device.cookie.slice(4)]?.cities.lagos?.state; assert.ok(state); change(state); });
  /** A player in the Lagos market with money earned from work, two paid days behind them and four days lived. */
  async function player(name: string): Promise<Device> {
    const device = await f.device(name);
    await f.request('/api/life?city=lagos', null, device.cookie);
    await edit(device, (state) => {
      state.cash = 100000; state.ledger = []; state.ledgerDays = []; state.location = 'market'; state.social.earned = 30000; state.needs.hunger = 30;
      state.civic.since = JOURNEY_TIME - 4 * DAY; state.civic.work = { days: 3, last: Math.floor((JOURNEY_TIME - DAY) / DAY) };
    });
    await f.request('/api/social/me', null, device.cookie);
    return device;
  }
  /** Seat `device` in a seat's current term as if it had won with `votes` votes last week. */
  const elect = (device: Device, scope: 'city:lagos' | 'state:lagos' | 'nation:ng', votes: number) => f.server.store.transact((db) => {
    const week = lagosTime(f.now()).week - 1, election = { candidates: { [device.id]: { name: 'Winner', slogan: 'Fair deal', at: JOURNEY_TIME - 8 * DAY } }, votes: Object.fromEntries(Array.from({ length: votes }, (_, index) => [`voter-${index}`, device.id])) };
    if (scope === 'city:lagos') { cityOf(db.civic ||= emptyCivic(), 'lagos').gov.elections[week] = election; return; }
    const politics = (db.politics ||= emptyPolitics());
    const record = (politics.scopes[scope] ||= { treasury: { balance: 0, ledger: [] } });
    (record.gov ||= { elections: {}, announcements: [] }).elections[week] = election;
  });
  const overview = async (device?: Device): Promise<PoliticsResponse> => (await get('/api/politics/overview?city=lagos', device)) as unknown as PoliticsResponse;
  const stored = async (): Promise<Database> => { await f.flush(); return f.server.store.read((db) => snapshot(db)); };
  return { f, post, get, edit, player, elect, overview, stored };
}

