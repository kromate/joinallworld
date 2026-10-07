import { AVATAR_WEARABLE_IDS } from '../../types/avatar.ts';
import { AVATAR_STARTER_WEARABLES } from '../../types/avatar.ts';
export { AVATAR_STARTER_WEARABLES } from '../../types/avatar.ts';
import type { AvatarWearableId } from '../../types/avatar.ts';

/** Original in-game naira prices. Basic clothing and modest head/body coverings remain free. */
export const AVATAR_WEARABLE_PRICES = /*#__PURE__*/ (() => {
const prices = {
  'hijab-drape': 0, 'hijab-wrap': 1500, turban: 0, 'gele-fan': 0, 'gele-rose': 3000,
  'neck-scarf': 0, 'shoulder-wrap': 1500,
  'chain-thin': 1500, 'chain-cuban': 6000, 'chain-pendant': 4000, beads: 1500, coral: 2500,
  wristwatch: 0, bangles: 1500, agbada: 6000, kaftan: 0, abaya: 0, 'buba-iro': 4000,
  'school-uniform': 0, 'work-uniform': 0, slippers: 0, sandals: 1000, sneakers: 1500,
} satisfies Record<AvatarWearableId, number>;

if (AVATAR_WEARABLE_IDS.some(id => (prices[id] === 0) !== AVATAR_STARTER_WEARABLES.includes(id))) throw Error('Starter wardrobe prices do not match the free catalogue');

return prices;
})();
