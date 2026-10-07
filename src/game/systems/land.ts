import { LEFT_OUT, PLAYS } from '../profile.ts';
import { canAfford, debit } from '../api.ts';
import { busy, fail, isRecord, naira, ok } from '../util.ts';
import { landPrice } from '../land.ts';
import type { LifeContext, LifeState } from '../../types/life.ts';
import type { SystemDefinition } from '../../types/registry.ts';

/** Only the land service calls this inside its receipt and paid-journal transaction. */
function pay(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext) {
  const blocked = busy(state, 'Finish your current action before buying land.');
  if (blocked) return blocked;
  const anchor = payload.anchor, own = state.estate.plot;
  if (state.estate.living !== 'own' || !own || !isRecord(anchor) || anchor.lga !== own.lga || anchor.estate !== own.estate || anchor.plot !== own.plot) return fail(state, 'not_owned_home', 'Go to your owned home before buying adjoining land.');
  const price = landPrice(state.estate.city, own.lga);
  if (price === null || payload.price !== price) return fail(state, 'land_price_changed', 'The land price changed. Preview it again.');
  if (!canAfford(state, price)) return fail(state, 'insufficient_funds', `This plot costs ${naira(price)}.`);
  debit(state, price, 'Adjoining land purchase', ctx);
  state.message = `You paid ${naira(price)} for adjoining land. Ownership is being confirmed.`;
  return ok(state, 'land_paid');
}

export default {
  id: 'land', stateKeys: [], sanitize() {},
  ...(PLAYS ? { actions: { 'estate.land-pay': { serverOnly: true, run: pay, refusal: 'Land purchases are confirmed by the server.' } } } : LEFT_OUT),
} satisfies SystemDefinition<'land'>;
