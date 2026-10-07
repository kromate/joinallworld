/**
 * OWNER: career
 * Work dilemmas: choosing which one comes up after a shift, and settling the player's answer. Pure: nothing here reads or writes a
 * life. The career system (systems/career.ts) rolls one at the end of a shift and applies an outcome; this file decides what it is.
 *
 * Switched on by the host (src/game/features.ts). Off, nothing in this file is reached. It is part of the lazy `dilemmas` chunk (src/game/dilemma-pack.ts): the engine never imports it.
 *
 *   eligibleDilemmas(stats, seen, placeKind)  every dilemma that fits this player now, never one of the last few seen when another fits
 *   pickDilemma(stats, seed, seen, placeKind) one of them, by weight, from a seed
 *   resolveDilemma(dilemma, choiceId, stats, seed)  what the choice does: deterministic from the seed, and always inside the bounds below
 *
 * BOUNDS (the content is held to them in dilemmas.test.ts, and the resolver enforces them whatever the content says)
 *   money   a quarter of one shift's pay at the player's level, either way; a gain with no risk is also at most ₦150; never more than the cash held
 *   needs   the result stays 0–100 (a delta is only as large as the need can move)
 *   skills  at most one shift's XP in a skill, never negative; only existing skill ids
 *   tag     a short id or nothing
 */
import { DILEMMAS, MAX_DILEMMA_XP, MAX_MONEY_SHARE, MAX_SAFE_GAIN } from './content/dilemmas.ts';
import { JOBS } from './content/jobs.ts';
import { clamp, finite, isId, isRecord, makeRng } from './util.ts';
import type { DilemmaChoice, DilemmaDefinition, DilemmaEffects, DilemmaOutcome, DilemmaStats } from '../types/content.ts';
import type { JobId, NeedId, NeedMap, SkillId, SkillMap } from '../types/life.ts';

const NEED_IDS: readonly NeedId[] = ['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder'];
const SKILL_IDS: readonly SkillId[] = ['cooking', 'charisma', 'fitness', 'coding', 'music', 'hustle', 'dance', 'comedy', 'photography'];
/** What the starter job pays: the figure used when a player has no job any more (the smallest pay there is). */
const FALLBACK_PAY = 300;

/** What one shift pays this job at this level (never below zero). */
export function shiftPay(job: JobId | null, level: number): number {
  const found = job ? JOBS[job] : undefined;
  if (!found) return FALLBACK_PAY;
  if (found.track) {
    const rung = found.ladder[clamp(Math.floor(finite(level) ? level : 1), 1, found.ladder.length) - 1];
    return Math.max(0, rung?.pay ?? found.ladder[0]?.pay ?? FALLBACK_PAY);
  }
  return Math.max(0, found.shift.reward ?? FALLBACK_PAY);
}

/** The most a dilemma may move money for this player, either way: a quarter of one shift's pay. */
export const moneyCap = (job: JobId | null, level: number): number => Math.floor(shiftPay(job, level) * MAX_MONEY_SHARE);

export const choiceOf = (dilemma: DilemmaDefinition, choiceId: unknown): DilemmaChoice | undefined => (typeof choiceId === 'string' ? dilemma.choices.find((item) => item.id === choiceId) : undefined);

/** What a choice is worth on average: its own money plus the chance of its bad outcome times that outcome's extra money. */
export function expectedMoney(choice: DilemmaChoice): number {
  const base = choice.effects.money ?? 0;
  return choice.risk ? base + (clamp(choice.risk.chance, 0, 100) / 100) * (choice.risk.bad.money ?? 0) : base;
}

/** True when the dilemma's `when` holds for these stats. */
function whenHolds(dilemma: DilemmaDefinition, stats: DilemmaStats): boolean {
  const when = dilemma.when;
  if (!when) return true;
  if (when.minLevel !== undefined && stats.level < when.minLevel) return false;
  if (when.maxLevel !== undefined && stats.level > when.maxLevel) return false;
  if (when.minCash !== undefined && stats.cash < when.minCash) return false;
  if (when.maxCash !== undefined && stats.cash > when.maxCash) return false;
  if (when.skill && (stats.skills[when.skill.id] ?? 0) < when.skill.min) return false;
  if (when.need) {
    const have = stats.needs[when.need.id] ?? 0;
    if (when.need.below !== undefined && have >= when.need.below) return false;
    if (when.need.above !== undefined && have <= when.need.above) return false;
  }
  if (when.tag && !stats.tags?.includes(when.tag)) return false;
  if (when.notTag && stats.tags?.includes(when.notTag)) return false;
  return true;
}

/** True when the job and the place of the dilemma (each only when it names any) fit. */
function fits(dilemma: DilemmaDefinition, stats: DilemmaStats, placeKind: string | null): boolean {
  if (dilemma.jobs && (!stats.job || !dilemma.jobs.includes(stats.job))) return false;
  if (dilemma.places && (!placeKind || !dilemma.places.includes(placeKind))) return false;
  return whenHolds(dilemma, stats);
}

/**
 * Every dilemma that fits, in catalogue order. The ones seen lately are left out, unless that would leave none (a small pool still gets asked).
 */
export function eligibleDilemmas(stats: DilemmaStats, seen: readonly string[], placeKind: string | null, pool: readonly DilemmaDefinition[] = DILEMMAS): DilemmaDefinition[] {
  const fitting = pool.filter((item) => fits(item, stats, placeKind));
  const fresh = fitting.filter((item) => !seen.includes(item.id));
  return fresh.length ? fresh : fitting;
}

/** One dilemma from the eligible ones, chosen by weight from the seed; null when none fits. */
export function pickDilemma(stats: DilemmaStats, seed: number, seen: readonly string[], placeKind: string | null, pool: readonly DilemmaDefinition[] = DILEMMAS): DilemmaDefinition | null {
  const options = eligibleDilemmas(stats, seen, placeKind, pool);
  if (!options.length) return null;
  const total = options.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (total <= 0) return options[0] ?? null;
  let roll = makeRng(`dilemma-pick:${seed}`)() * total;
  for (const item of options) {
    roll -= Math.max(0, item.weight);
    if (roll < 0) return item;
  }
  return options.at(-1) ?? null;
}

/** Sums effect maps over the known ids only, finite amounts only. */
function sumMaps<Id extends string>(ids: readonly Id[], ...maps: (Partial<Record<Id, number>> | undefined)[]): Partial<Record<Id, number>> {
  const out: Partial<Record<Id, number>> = {};
  for (const map of maps) {
    if (!isRecord(map)) continue;
    for (const id of ids) {
      const amount = (map as Record<string, unknown>)[id];
      if (finite(amount)) out[id] = (out[id] ?? 0) + amount;
    }
  }
  return out;
}

/**
 * What the player's answer does. Deterministic: the same dilemma, choice, stats and seed always give the same outcome (the risk is rolled from the seed, never
 * from the clock or the engine's dice). A bad outcome adds the risk's extra effects to the choice's own. Throws for a choice the dilemma does not have: callers check
 * with choiceOf first.
 */
export function resolveDilemma(dilemma: DilemmaDefinition, choiceId: string, stats: DilemmaStats, seed: number): DilemmaOutcome {
  const choice = choiceOf(dilemma, choiceId);
  if (!choice) throw new TypeError(`No choice ${String(choiceId)} in dilemma ${dilemma.id}`);
  const risk = choice.risk;
  const bad = risk ? makeRng(`dilemma-roll:${seed}:${dilemma.id}:${choice.id}`)() * 100 < clamp(finite(risk.chance) ? risk.chance : 0, 0, 100) : false;
  const parts: DilemmaEffects[] = bad && risk ? [choice.effects, risk.bad] : [choice.effects];

  // Money: a quarter of the shift pay either way; a gain with no risk is small; never more than the cash held.
  const cap = moneyCap(stats.job, stats.level);
  const gainCap = risk ? cap : Math.min(cap, MAX_SAFE_GAIN);
  const wanted = Math.round(parts.reduce((sum, part) => sum + (finite(part.money) ? part.money : 0), 0));
  const money = Math.max(-Math.max(0, Math.floor(finite(stats.cash) ? stats.cash : 0)), clamp(wanted, -cap, gainCap));

  // Needs: the change is only as large as the need can move, so the need stays 0–100.
  const rawNeeds = sumMaps(NEED_IDS, ...parts.map((part) => part.needs));
  const needs: NeedMap = {};
  for (const id of NEED_IDS) {
    const delta = rawNeeds[id];
    if (delta === undefined) continue;
    const have = clamp(finite(stats.needs[id]) ? stats.needs[id] : 0, 0, 100);
    const moved = Math.round(clamp(have + delta, 0, 100) - have);
    if (moved) needs[id] = moved;
  }

  // Skills: XP only goes up, and is at most one shift's worth in a skill.
  const rawSkills = sumMaps(SKILL_IDS, ...parts.map((part) => part.skills));
  const skills: SkillMap = {};
  for (const id of SKILL_IDS) {
    const amount = rawSkills[id];
    if (amount === undefined) continue;
    const xp = Math.round(clamp(amount, 0, MAX_DILEMMA_XP));
    if (xp > 0) skills[id] = xp;
  }

  // The tag of a bad outcome wins; otherwise the choice's own.
  const tag = [...parts].reverse().map((part) => part.tag).find((value) => isId(value)) ?? null;

  return { dilemma: dilemma.id, choice: choice.id, bad, money, needs, skills, tag, result: bad && risk ? risk.result : choice.result };
}

// The record a life keeps (emptyBook, markSeen, markMemory, cleanBook) is in src/game/dilemma-book.ts, which the engine always loads; re-exported for callers of this file.
export { cleanBook, emptyBook, markMemory, markSeen } from './dilemma-book.ts';
