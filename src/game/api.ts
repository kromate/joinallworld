/**
 * OWNER: foundation — the stable surface of the core systems.
 * Feature systems import core behaviour from here (never from systems/*.js directly) and
 * reach other feature systems only through registry emit()/modify().
 */
export { credit, debit, canAfford, canCredit } from './systems/wallet.ts';
export { NEEDS, changeNeeds, addMoodlet, removeMoodlet, moodOf, feelingsOf } from './systems/needs.ts';
export { SKILLS, MAX_LEVEL, addSkillXp, skillLevel, setSkillLevel, xpForLevel } from './systems/skills.ts';
export { countItem, hasItems, addItem, removeItems } from './systems/inventory.ts';
export { arrive, spotsOf, defaultSpot, findActivity, blockReason } from './systems/activities.ts';
