/**
 * OWNER: foundation (core — do not edit from a feature branch)
 * Nine skills with XP → level.
 *
 * State key: skills ({ [skill]: xp }, xp ≥ 0).
 * Use through api.js: addSkillXp, skillLevel, setSkillLevel.
 * Rate hook: every XP gain is multiplied by modify('skills.xpRate', 1, { skill }) — traits and
 * perks change learning speed by contributing that modifier, never by editing this file.
 * The level curve is an original beta value: level L needs 50·L·(L+1) XP (100, 300, 600 … 5500).
 */
import { emit, modify } from '../registry.js';
import { finite, isRecord } from '../util.js';

export const SKILLS = Object.freeze(['cooking', 'charisma', 'fitness', 'coding', 'music', 'hustle', 'dance', 'comedy', 'photography']);
export const MAX_LEVEL = 10;
export const xpForLevel = (level) => 50 * level * (level + 1);
const MAX_XP = xpForLevel(MAX_LEVEL);

export function levelForXp(xp) {
  let level = 0;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level += 1;
  return level;
}
export const skillLevel = (state, skill) => levelForXp(state.skills[skill] ?? 0);

/** Grant XP (after the rate modifier). Returns the new level, or -1 for an unknown skill. */
export function addSkillXp(state, skill, amount, ctx) {
  if (!Object.hasOwn(state.skills, skill) || !finite(amount) || amount <= 0) return -1;
  const before = skillLevel(state, skill);
  const rate = Math.max(0, modify(state, 'skills.xpRate', 1, { skill }, ctx));
  state.skills[skill] = Math.min(MAX_XP, state.skills[skill] + amount * rate);
  const level = skillLevel(state, skill);
  if (level > before) emit(state, 'skill.levelup', { skill, level }, ctx);
  return level;
}

/** Raise a skill to at least `level` (birth lottery, rewards). Never lowers it. */
export function setSkillLevel(state, skill, level) {
  if (!Object.hasOwn(state.skills, skill) || !Number.isInteger(level) || level < 0) return false;
  state.skills[skill] = Math.max(state.skills[skill], xpForLevel(Math.min(level, MAX_LEVEL)));
  return true;
}

export default {
  id: 'skills',
  stateKeys: ['skills'],
  sanitize(input, state) {
    state.skills = {};
    for (const skill of SKILLS) {
      const xp = isRecord(input.skills) ? input.skills[skill] : undefined;
      state.skills[skill] = finite(xp) && xp >= 0 ? Math.min(xp, MAX_XP) : 0;
    }
  },
  actions: {},
  advance() {},
  view(state) {
    return Object.fromEntries(SKILLS.map((skill) => {
      const xp = state.skills[skill], level = levelForXp(xp);
      const floor = xpForLevel(level), next = level < MAX_LEVEL ? xpForLevel(level + 1) : null;
      return [skill, { xp, level, next, progress: next ? (xp - floor) / (next - floor) : 1 }];
    }));
  },
};
