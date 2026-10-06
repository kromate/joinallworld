// OWNER: politics — what the sitting officeholders' levies add to a purchase, and where the money goes. Design: docs/POLITICS.md.
import { LEVERS, leversOf } from '../../src/game/content/politics.ts';
import type { CityId } from '../../src/types/protocol.ts';
import type { Db, GovScope, RouteContext } from '../types.ts';
import { peekPolitics, peekScope, politicsOf, scopeRecord, seatsOf } from './data.ts';
import { credit, leverValue, levyOn, totalLevy } from './rules.ts';
import type { Levy } from './rules.ts';

export type LevyKind = 'sale' | 'trade';

const isGov = (value: unknown): value is GovScope['gov'] => value !== null && typeof value === 'object' && !Array.isArray(value) && 'elections' in value && typeof value.elections === 'object' && value.elections !== null;

/** The ballots a seat is decided by: a city's are in its civic record, a state's and the nation's in the politics collection. */
function govFor(db: Db, politics: ReturnType<typeof peekPolitics>, tier: string, scopeId: string, cityId: CityId): GovScope | null {
  const gov: unknown = tier === 'city' ? db.civic?.cities?.[cityId]?.gov : peekScope(politics, scopeId).gov;
  return isGov(gov) ? { gov } : null;
}

/** The levies in force now on this kind of purchase in this city. Reads only: nothing is created. Empty when no officeholder has set one. */
export function leviesFor(db: Db, cityId: CityId, kind: LevyKind, now: number): Levy[] {
  const politics = peekPolitics(db), levies: Levy[] = [];
  for (const seat of seatsOf(cityId, cityId)) {
    const gov = govFor(db, politics, seat.tier, seat.id, cityId);
    if (!gov) continue;
    const scope = peekScope(politics, seat.id);
    for (const lever of leversOf(seat.tier)) {
      if (LEVERS[lever].on !== kind) continue;
      const percent = leverValue(scope, gov, now, lever);
      if (percent > 0) levies.push({ scopeId: seat.id, lever, percent, label: LEVERS[lever].label });
    }
  }
  return levies;
}

/** Pay each levy of `amount` into its treasury. The buyer has already been charged `totalLevy(amount, levies)`. */
export function payLevies(ctx: Pick<RouteContext, 'collection'>, db: Db, levies: readonly Levy[], amount: number, now: number, what: string): void {
  if (totalLevy(amount, levies) <= 0) return;
  const politics = politicsOf(ctx, db);
  for (const levy of levies) credit(scopeRecord(politics, levy.scopeId), now, 'levy', levyOn(amount, levy.percent), `${levy.label} on ${what}`);
}

export { totalLevy };
