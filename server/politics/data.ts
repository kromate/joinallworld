// OWNER: politics — the shared record: one scope per seat (a city, a state, the nation), the parties and who belongs to them.
// Portable: plain objects only, reached through ctx.collection(db, 'politics') by the routes. Design: docs/POLITICS.md.
//
// db.politics = {
//   v: 1, seq,
//   scopes:  { [scopeId]: { gov?, decree?, treasury: { balance, ledger }, drawn? } }
//              scopeId is `city:<id>`, `state:<id>` or `nation:<id>`. A state's and the nation's ballots live in `gov` here;
//              a city's stay in its civic record, so this scope only holds its decree and treasury.
//   parties: { [partyId]: { id, name, motto, colour, founder, at } }
//   members: { [playerId]: partyId }
// }
// Only public ids and public names are stored — never a session secret.
import { cityCatalogueEntry } from '../../src/game/cities/registry.ts';
import type { CityId } from '../../src/types/protocol.ts';
import type { TierId } from '../../src/types/politics.ts';
import type { Db, GovScope, PoliticsCollection, PoliticsScopeRecord, RouteContext } from '../types.ts';

export const COUNTRY = { id: 'ng', name: 'Nigeria' };

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export const emptyPolitics = (): PoliticsCollection => ({ v: 1, seq: 0, scopes: {}, parties: {}, members: {} });
const emptyScope = (): PoliticsScopeRecord => ({ treasury: { balance: 0, ledger: [] } });

/** The collection, created or repaired in place so damaged data cannot crash a route. */
export function politicsOf(ctx: Pick<RouteContext, 'collection'>, db: Db): PoliticsCollection {
  const found = ctx.collection(db, 'politics', emptyPolitics()) as Partial<PoliticsCollection>;
  if (!whole(found.seq)) found.seq = 0;
  if (!record(found.scopes)) found.scopes = {};
  if (!record(found.parties)) found.parties = {};
  if (!record(found.members)) found.members = {};
  found.v = 1;
  return found as PoliticsCollection;
}
/** The collection as a read sees it: nothing is created. */
export const peekPolitics = (db: Db): PoliticsCollection => {
  const found = db.politics;
  return record(found) && record(found.scopes) && record(found.parties) && record(found.members) ? found : emptyPolitics();
};

/** One seat's record, created or repaired in place. */
export function scopeRecord(politics: PoliticsCollection, id: string): PoliticsScopeRecord {
  const existing = politics.scopes[id];
  const found = record(existing) ? existing : (politics.scopes[id] = emptyScope());
  if (!record(found.treasury)) found.treasury = { balance: 0, ledger: [] };
  if (!whole(found.treasury.balance)) found.treasury.balance = 0;
  if (!Array.isArray(found.treasury.ledger)) found.treasury.ledger = [];
  return found;
}
/** A seat's record as a read sees it: nothing is created. */
export const peekScope = (politics: PoliticsCollection, id: string): PoliticsScopeRecord => (record(politics.scopes[id]) ? politics.scopes[id] as PoliticsScopeRecord : emptyScope());

export interface Seat { tier: TierId; id: string; name: string }

/** The three seats a resident of `cityId` votes for, narrowest first. A city outside the catalogue (a test's) has no state seat. */
export function seatsOf(cityId: CityId, cityName: string): Seat[] {
  const entry = cityCatalogueEntry(cityId);
  return [
    { tier: 'city', id: `city:${cityId}`, name: cityName },
    ...(entry ? [{ tier: 'state' as const, id: `state:${entry.state.id}`, name: entry.state.name }] : []),
    { tier: 'nation', id: `nation:${COUNTRY.id}`, name: COUNTRY.name },
  ];
}

/** The ballots of a state or national seat: created or repaired in place. */
export function govOfScope(scope: PoliticsScopeRecord): GovScope {
  if (!record(scope.gov)) scope.gov = { elections: {}, announcements: [] };
  if (!record(scope.gov.elections)) scope.gov.elections = {};
  if (!Array.isArray(scope.gov.announcements)) scope.gov.announcements = [];
  return { gov: scope.gov };
}

/** The ballots of a seat as a read sees them: nothing is created, so a read of an empty seat writes nothing. */
export const peekGov = (scope: PoliticsScopeRecord): GovScope => (scope.gov ? govOfScope(scope) : { gov: { elections: {}, announcements: [] } });
