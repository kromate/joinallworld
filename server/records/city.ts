// OWNER: politics — the seats a city's residents vote for, ready for the archive, and the one call routes make to keep the record up to date.
import { civicTitle } from '../../src/game/cities/terminology.ts';
import { SEAT_TITLES } from '../../src/game/content/politics.ts';
import type { CityId } from '../../src/types/protocol.ts';
import { govOfId, peekPolitics, seatsOf } from '../politics/data.ts';
import type { Db, RouteContext } from '../types.ts';
import { archiveTerms, termsPending } from './archive.ts';
import type { SeatToArchive } from './archive.ts';
import { peekRecords, recordsOf } from './store.ts';

export function seatsToArchive(db: Db, cityId: CityId, cityName: string): SeatToArchive[] {
  return seatsOf(cityId, cityName).map((seat) => ({ tier: seat.tier, id: seat.id, name: seat.name, title: seat.tier === 'city' ? civicTitle(cityId) : SEAT_TITLES[seat.tier], gov: govOfId(db, seat.id) }));
}

/** When each city was last looked at by a throttled call (in memory: after a restart the first call looks). */
const looked = new Map<string, number>();
const THROTTLE_MS = 60000;

/**
 * Write any ended term of this city's three seats that the record lacks. Call it inside a write. Cheap when there is nothing to write.
 * `throttle` is for the frequent callers (the civic pulse): the city's ballots are then looked at once a minute at most. A call that is
 * about to prune ballots (a candidacy) does not throttle.
 */
export function archiveCity(ctx: Pick<RouteContext, 'collection' | 'now'>, db: Db, cityId: CityId, cityName: string, throttle = false): number {
  const now = ctx.now();
  if (throttle) {
    const last = looked.get(cityId);
    if (last !== undefined && now >= last && now - last < THROTTLE_MS) return 0;
    looked.set(cityId, now);
  }
  const seats = seatsToArchive(db, cityId, cityName);
  if (!termsPending(peekRecords(db), seats, now)) return 0;
  return archiveTerms(recordsOf(ctx, db), peekPolitics(db), seats, now);
}
