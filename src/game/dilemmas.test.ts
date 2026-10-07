import { loadCityContent as preloadCityContent } from './cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// OWNER: career + social — tests for work dilemmas (src/game/dilemmas.ts, content/dilemmas.ts, systems/career.ts) and the place actions
// of regulars (place-actions.ts, systems/social.ts). Both live behind the `dilemmas` switch (src/game/features.ts), off by default.
// Pattern and rules: see "HOW TO TEST" at the top of src/game/registry.ts.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, advanceLife, viewLife } from '../life.ts';
import { rebuildCatalogue } from './systems/activities.ts';
import { makeContext, isId } from './util.ts';
import { lagosTime } from './clock.ts';
import './dilemma-pack.ts'; // installs the kit, as the servers do
import { setFeature, dilemmasEnabled, flagFromEnv, dilemmaKit } from './features.ts';
import { skillLevel } from './api.ts';
import { DILEMMAS, dilemmaById, DILEMMA_CHANCE, MAX_DILEMMA_XP, MAX_MONEY_SHARE, MAX_SAFE_GAIN, SEEN_KEPT } from './content/dilemmas.ts';
import { JOBS } from './content/jobs.ts';
import { DAILY_INTERACTIONS, NPC_ACTIONS, COUPON_MAX_SAVING } from './content/npcs.ts';
import { PLACE_ACTIONS } from './content/place-actions.ts';
import { NEED_IDS, SKILL_IDS } from '../types/life.ts';
import { eligibleDilemmas, pickDilemma, resolveDilemma, expectedMoney, moneyCap, shiftPay, cleanBook, markSeen, emptyBook } from './dilemmas.ts';
import { placeKindOf, placeActionsFor, isAfterService } from './place-actions.ts';
import { activityId } from './systems/social.ts';
import { NPCS } from './cities/lagos/regulars.ts';
import type { DilemmaDefinition, DilemmaStats } from '../types/content.ts';
import type { ActionBody, ActionType } from '../types/actions.ts';
import type { JobId, LifeState } from '../types/life.ts';

const MONDAY_9AM = Date.UTC(2026, 0, 5, 8); // 09:00 in Lagos
const SUNDAY_9AM = Date.UTC(2026, 0, 4, 8); // 09:00 in Lagos, before the first service ends
const SUNDAY_11AM = Date.UTC(2026, 0, 4, 10); // 11:00 in Lagos, half an hour after the first service ends
const at = (now: number, seed = 'dilemma-test') => makeContext({ now, cityId: 'lagos', seed });
const today = lagosTime(MONDAY_9AM).day;

/** Turns the switch on or off and rebuilds the cached activity catalogue to match. */
function setSwitch(on: boolean): void { setFeature('dilemmas', on); rebuildCatalogue('lagos'); }
afterEach(() => setSwitch(false));

function need<T>(value: T | null | undefined, what = 'expected a value'): T { assert.ok(value !== null && value !== undefined, what); return value; }
const send = (state: LifeState, type: string, payload: Record<string, unknown>, now: number, seed = 'send') => dispatch(state, { type, payload } as ActionBody<ActionType>, at(now, seed));
const entryPay = (id: JobId): number => { const job = JOBS[id]; return job.track ? need(job.ladder[0]).pay : need(job.shift.reward); };
const statsOf = (state: LifeState, tags: string[] = []): DilemmaStats => ({
  job: state.job, level: state.career.level, cash: state.cash, needs: { ...state.needs },
  skills: Object.fromEntries(SKILL_IDS.map((id) => [id, skillLevel(state, id)])) as DilemmaStats['skills'], tags,
});
const PLAIN: DilemmaStats = {
  job: 'tech', level: 1, cash: 100000, tags: [],
  needs: { hunger: 50, energy: 50, fun: 50, social: 50, hygiene: 50, bladder: 50 },
  skills: { cooking: 1, charisma: 1, fitness: 1, coding: 1, music: 1, hustle: 1, dance: 1, comedy: 1, photography: 1 },
};
const jobIds = Object.keys(JOBS) as JobId[];

test('the switch is off by default and only 1/true/on/yes turn it on', () => {
  assert.equal(dilemmasEnabled(), false);
  assert.deepEqual(['1', 'true', 'ON', ' yes '].map(flagFromEnv), [true, true, true, true]);
  assert.deepEqual(['', '0', 'no', 'false', undefined, 1].map(flagFromEnv), [false, false, false, false, false, false]);
});

test('content: every dilemma names real jobs, has two or three choices and keeps inside its money bounds', () => {
  assert.ok(DILEMMAS.length >= 36 && DILEMMAS.length <= 48, `${DILEMMAS.length} dilemmas`);
  assert.equal(new Set(DILEMMAS.map((item) => item.id)).size, DILEMMAS.length, 'ids are unique');
  for (const item of DILEMMAS) {
    assert.ok(isId(item.id) && item.beta === true && item.weight > 0, item.id);
    assert.ok(item.prompt.en && item.prompt.pcm, `${item.id} has both wordings`);
    assert.ok(item.choices.length >= 2 && item.choices.length <= 3, `${item.id} choices`);
    assert.equal(new Set(item.choices.map((choice) => choice.id)).size, item.choices.length, `${item.id} choice ids`);
    const jobs = item.jobs ?? jobIds;
    for (const job of jobs) assert.ok(JOBS[job], `${item.id}: ${job} is a real job`);
    const cap = Math.floor(Math.min(...jobs.map(entryPay)) * MAX_MONEY_SHARE);
    for (const choice of item.choices) {
      const label = `${item.id}/${choice.id}`;
      assert.ok(choice.label.en && choice.label.pcm && choice.result.en && choice.result.pcm, `${label} wording`);
      const effects = [choice.effects, ...(choice.risk ? [choice.risk.bad] : [])];
      const bad = choice.risk?.bad.money ?? 0, own = choice.effects.money ?? 0;
      assert.ok(Math.abs(own) <= cap && Math.abs(bad) <= cap && Math.abs(own + bad) <= cap, `${label} money stays within a quarter of the entry pay (${cap})`);
      if (!choice.risk) assert.ok(own <= MAX_SAFE_GAIN, `${label} a safe gain is small`);
      if (choice.risk) assert.ok(choice.risk.chance > 0 && choice.risk.chance < 100 && choice.risk.result.en && choice.risk.result.pcm, `${label} risk`);
      if (choice.shady) {
        assert.ok(choice.risk, `${label} shady choices carry a risk`);
        assert.ok(expectedMoney(choice) <= 0, `${label} a shady choice is a losing bet (expected ${expectedMoney(choice)})`);
        assert.ok(bad < 0, `${label} going badly costs money`);
      }
      for (const effect of effects) {
        for (const id of Object.keys(effect.needs ?? {})) assert.ok((NEED_IDS as readonly string[]).includes(id), `${label} need ${id}`);
        for (const [id, xp] of Object.entries(effect.skills ?? {})) { assert.ok((SKILL_IDS as readonly string[]).includes(id), `${label} skill ${id}`); assert.ok(xp >= 0 && xp <= MAX_DILEMMA_XP, `${label} xp`); }
        if (effect.tag !== undefined) assert.ok(isId(effect.tag), `${label} tag`);
      }
    }
  }
  for (const job of jobIds) assert.ok(DILEMMAS.filter((item) => !item.jobs || item.jobs.includes(job)).length >= 5, `${job} has at least five dilemmas`);
});

test('resolver: deterministic, and money, needs and skills stay inside the bounds for every choice and many seeds', () => {
  for (const item of DILEMMAS) {
    for (const choice of item.choices) {
      for (const job of item.jobs ?? jobIds) {
        for (const level of [1, 6]) {
          const cap = moneyCap(job, level);
          for (const cash of [0, 40, 100000]) {
            for (let seed = 0; seed < 12; seed++) {
              const stats: DilemmaStats = { ...PLAIN, job, level, cash, needs: { ...PLAIN.needs, hunger: 2, energy: 99 } };
              const one = resolveDilemma(item, choice.id, stats, seed * 7919);
              assert.deepEqual(one, resolveDilemma(item, choice.id, stats, seed * 7919), 'same inputs, same outcome');
              assert.ok(one.money <= cap && one.money >= -cap && one.money >= -cash, `${item.id}/${choice.id} money ${one.money} (cap ${cap}, cash ${cash})`);
              if (!choice.risk) assert.ok(one.money <= Math.min(cap, MAX_SAFE_GAIN));
              if (!choice.risk) assert.equal(one.bad, false);
              for (const [id, delta] of Object.entries(one.needs)) { const after = stats.needs[id as keyof typeof stats.needs] + delta; assert.ok(after >= 0 && after <= 100, `${item.id} need ${id} -> ${after}`); }
              for (const xp of Object.values(one.skills)) assert.ok(xp > 0 && xp <= MAX_DILEMMA_XP);
              assert.ok(one.tag === null || isId(one.tag));
            }
          }
        }
      }
    }
  }
});

test('resolver: a risky choice goes badly about as often as it says', () => {
  const item = need(DILEMMAS.find((candidate) => candidate.choices.some((choice) => choice.risk)));
  const choice = need(item.choices.find((candidate) => candidate.risk)), risk = need(choice.risk);
  let bad = 0; const runs = 2000;
  for (let seed = 0; seed < runs; seed++) if (resolveDilemma(item, choice.id, PLAIN, seed).bad) bad++;
  assert.ok(Math.abs((bad / runs) * 100 - risk.chance) < 5, `${bad}/${runs} against ${risk.chance}%`);
  assert.throws(() => resolveDilemma(item, 'no-such-choice', PLAIN, 1), TypeError);
});

test('resolver: clamps what a careless dilemma asks for', () => {
  const words = { en: 'x', pcm: 'x' };
  const greedy: DilemmaDefinition = {
    id: 'greedy', prompt: words, weight: 1, beta: true,
    choices: [
      { id: 'safe', label: words, result: words, effects: { money: 999999, needs: { hunger: 500, fun: -500 }, skills: { coding: 9999, charisma: -5 }, tag: 'Not An Id!' } },
      { id: 'risky', label: words, result: words, effects: { money: 999999 }, risk: { chance: 100, bad: { money: -999999 }, result: words } },
    ],
  };
  const safe = resolveDilemma(greedy, 'safe', { ...PLAIN, cash: 5000 }, 3);
  assert.equal(safe.money, MAX_SAFE_GAIN);
  assert.deepEqual(safe.needs, { hunger: 50, fun: -50 });
  assert.deepEqual(safe.skills, { coding: MAX_DILEMMA_XP });
  assert.equal(safe.tag, null);
  const risky = resolveDilemma(greedy, 'risky', { ...PLAIN, cash: 50 }, 3);
  assert.equal(risky.bad, true);
  assert.ok(risky.money >= -50 && risky.money <= 0, `never more than the cash held (${risky.money})`);
  assert.equal(shiftPay('tech', 1), 3600);
  assert.equal(moneyCap('tech', 1), 900);
  assert.equal(moneyCap(null, 1), Math.floor(300 * MAX_MONEY_SHARE));
});

test('picking: deterministic, fits the job and place, avoids the last few seen, null when nothing fits', () => {
  const stats = { ...PLAIN, job: 'trading' as JobId };
  const first = need(pickDilemma(stats, 11, [], 'market'));
  assert.equal(pickDilemma(stats, 11, [], 'market')?.id, first.id);
  for (let seed = 0; seed < 60; seed++) {
    const picked = need(pickDilemma(stats, seed, [], 'market'));
    assert.ok(!picked.jobs || picked.jobs.includes('trading'), picked.id);
    assert.ok(!picked.places || picked.places.includes('market'), picked.id);
  }
  const fitting = eligibleDilemmas(stats, [], 'market');
  assert.ok(fitting.length >= 2);
  const seen = fitting.slice(0, -1).map((item) => item.id);
  for (let seed = 0; seed < 30; seed++) assert.equal(need(pickDilemma(stats, seed, seen, 'market')).id, need(fitting.at(-1)).id, 'only the unseen one is offered');
  assert.equal(eligibleDilemmas(stats, fitting.map((item) => item.id), 'market').length, fitting.length, 'a small pool is still asked');
  assert.equal(pickDilemma(stats, 1, [], null, []), null);
  const book = emptyBook();
  for (let i = 0; i < SEEN_KEPT + 4; i++) markSeen(book, `id-${i}`);
  assert.equal(book.seen.length, SEEN_KEPT);
});

test('the saved record: junk is dropped, a well-formed record survives (ids are checked where used), and nothing worth keeping leaves the key absent', () => {
  assert.equal(cleanBook(undefined), undefined);
  assert.equal(cleanBook('x'), undefined);
  assert.equal(cleanBook({ pending: { id: 'Bad Id!', seed: -1 }, seen: ['Bad Id!', 4], memory: ['Bad Tag!', 7] }), undefined);
  const real = need(DILEMMAS[0]);
  assert.deepEqual(cleanBook({ pending: { id: real.id, seed: 5 }, seen: [real.id, 'gone', 4], memory: ['kind', 'Not ok'] }), { pending: { id: real.id, seed: 5 }, seen: [real.id, 'gone'], memory: ['kind'] });
});

test('switch off: no place actions, no dilemma, no new keys in the state or the view, and the action is refused', () => {
  setSwitch(false);
  const player = createLife({ t: MONDAY_9AM, job: 'tech', location: 'market', spot: 'people' }, at(MONDAY_9AM));
  assert.equal('dilemmas' in player.career, false);
  assert.equal('coupon' in player.social, false);
  assert.equal('dilemma' in viewLife(player, at(MONDAY_9AM)).career, false);
  const refused = send(player, 'career.dilemma', { choice: 'x' }, MONDAY_9AM);
  assert.equal(refused.ok, false); assert.equal(refused.code, 'dilemmas_off');
  const here = need(viewLife(player, at(MONDAY_9AM)).social.here.find((npc) => npc.id === 'iya-bose'));
  assert.deepEqual(here.actions.map((action) => action.id), NPC_ACTIONS.map((action) => action.id));
  assert.ok(here.actions.every((action) => !('pcmLabel' in action)));
  assert.equal(send(player, 'activity', { id: activityId('iya-bose', 'haggle') }, MONDAY_9AM).ok, false);
  for (let i = 0; i < 40; i++) {
    const worker = createLife({ t: MONDAY_9AM, job: 'tech', cash: 500, location: 'cchub', spot: 'work', needs: { hunger: 90, energy: 90 } }, at(MONDAY_9AM, `off-${i}`));
    send(worker, 'activity', { id: JOBS.tech.shift.id }, MONDAY_9AM, `off-${i}`);
    advanceLife(worker, JOBS.tech.shift.duration, at(MONDAY_9AM + JOBS.tech.shift.duration * 1000, `off-${i}`));
    assert.equal(worker.completedShifts, 1);
    assert.equal('dilemmas' in worker.career, false, 'a shift writes nothing new while the switch is off');
  }
});

test('an old save without the new fields loads unchanged, with the switch on or off', () => {
  for (const on of [false, true]) {
    setSwitch(on);
    const old = createLife({ t: MONDAY_9AM, job: 'tech', career: { level: 2, performance: 40, shifts: 3, auto: true }, social: { rel: { 'iya-bose': { p: 5, npc: true } } } }, at(MONDAY_9AM));
    assert.equal(old.career.level, 2);
    assert.equal('dilemmas' in old.career, false);
    assert.equal('coupon' in old.social, false);
    assert.equal('tags' in need(old.social.rel['iya-bose']), false);
    const junk = createLife({ job: 'tech', career: { dilemmas: { pending: 'x', seen: 9 } }, social: { coupon: { pct: 900, day: 'x' }, rel: { 'iya-bose': { p: 1, npc: true, tags: ['Bad Tag', 'ok', 4] } } } }, at(MONDAY_9AM));
    assert.equal('dilemmas' in junk.career, false);
    assert.equal('coupon' in junk.social, false);
    assert.deepEqual(junk.social.rel['iya-bose']?.tags, ['ok']);
  }
});

/** Works one shift on a Monday morning and returns the life. */
function workShift(job: 'tech' | 'community-helper', seed: string, saved: Record<string, unknown> = {}): LifeState {
  const def = JOBS[job];
  const state = createLife({ t: MONDAY_9AM, job, cash: 1000, location: def.workplace.venue, spot: def.workplace.spot, needs: { hunger: 90, energy: 90 }, ...saved }, at(MONDAY_9AM, seed));
  const started = send(state, 'activity', { id: def.shift.id }, MONDAY_9AM, seed); assert.equal(started.ok, true, `${job} shift starts: ${started.ok ? '' : started.reason}`);
  advanceLife(state, def.shift.duration, at(MONDAY_9AM + def.shift.duration * 1000, seed));
  assert.equal(state.completedShifts, 1);
  return state;
}

test('switch on: a finished shift sometimes leaves one dilemma waiting, at about the set chance, never two', () => {
  setSwitch(true);
  for (const job of ['tech', 'community-helper'] as const) {
    let waiting = 0; const runs = 200;
    for (let i = 0; i < runs; i++) {
      const state = workShift(job, `roll-${job}-${i}`);
      const pending = state.career.dilemmas?.pending;
      if (!pending) continue;
      waiting++;
      const picked = need(dilemmaById(pending.id));
      assert.ok(!picked.jobs || picked.jobs.includes(job), `${job} got ${pending.id}`);
      assert.deepEqual(state.career.dilemmas?.seen, [pending.id]);
      assert.match(state.message, /Something came up at work/);
      assert.deepEqual(viewLife(state, at(MONDAY_9AM)).career.dilemma, { id: pending.id }, 'the view carries the id; the words are the card\'s to fetch');
    }
    assert.ok(Math.abs((waiting / runs) * 100 - DILEMMA_CHANCE) < 12, `${job}: ${waiting}/${runs} shifts left a dilemma`);
  }
  const base = need(Array.from({ length: 80 }, (_, i) => workShift('tech', `again-${i}`)).find((state) => state.career.dilemmas?.pending));
  const kept = need(base.career.dilemmas?.pending);
  const next = workShift('tech', 'again-2', { career: { level: 1, performance: 0, shifts: 0, dilemmas: base.career.dilemmas } });
  assert.deepEqual(next.career.dilemmas?.pending, kept, 'with one waiting a second shift leaves it alone');
});

test('switch on: answering a dilemma settles exactly what the resolver says, once', () => {
  setSwitch(true);
  for (const item of DILEMMAS.filter((candidate) => !candidate.jobs || candidate.jobs.includes('tech'))) {
    for (const choice of item.choices) {
      const state = createLife({ t: MONDAY_9AM, job: 'tech', cash: 2000, career: { level: 1, performance: 10, shifts: 1, dilemmas: { pending: { id: item.id, seed: 77 }, seen: [item.id], memory: [] } } }, at(MONDAY_9AM));
      assert.deepEqual(state.career.dilemmas?.pending, { id: item.id, seed: 77 });
      const before = { cash: state.cash, needs: { ...state.needs }, ledger: state.ledger.length };
      const expected = resolveDilemma(item, choice.id, statsOf(state), 77);
      const result = send(state, 'career.dilemma', { choice: choice.id }, MONDAY_9AM);
      assert.equal(result.ok, true, `${item.id}/${choice.id}`);
      assert.equal(result.code, expected.bad ? 'went_badly' : 'resolved');
      assert.equal(state.cash, before.cash + expected.money, `${item.id}/${choice.id} cash`);
      assert.equal(state.ledger.length, before.ledger + (expected.money ? 1 : 0), 'one ledger line when money moves');
      for (const id of NEED_IDS) assert.equal(state.needs[id], before.needs[id] + (expected.needs[id] ?? 0), `${item.id}/${choice.id} ${id}`);
      assert.equal(state.message, expected.result.en);
      assert.equal(state.career.dilemmas?.pending, null);
      assert.deepEqual(state.career.dilemmas?.memory, expected.tag ? [expected.tag] : []);
      assert.equal(viewLife(state, at(MONDAY_9AM)).career.dilemma, null);
      assert.equal(send(state, 'career.dilemma', { choice: choice.id }, MONDAY_9AM).code, 'no_dilemma', 'it cannot be answered twice');
    }
  }
  const waiting = createLife({ t: MONDAY_9AM, job: 'tech', career: { dilemmas: { pending: { id: need(DILEMMAS[0]).id, seed: 1 }, seen: [], memory: [] } } }, at(MONDAY_9AM));
  assert.equal(send(waiting, 'career.dilemma', { choice: 'not-a-choice' }, MONDAY_9AM).code, 'invalid_choice');
  assert.equal(send(waiting, 'career.dilemma', {}, MONDAY_9AM).code, 'invalid_choice');
  assert.ok(waiting.career.dilemmas?.pending, 'a refused answer keeps the dilemma waiting');
});

test('a saved dilemma can never pay more than a quarter of a shift, however the life was edited', () => {
  setSwitch(true);
  for (const item of DILEMMAS) {
    for (const choice of item.choices) {
      const state = createLife({ t: MONDAY_9AM, job: 'community-helper', cash: 10, career: { dilemmas: { pending: { id: item.id, seed: 3 }, seen: [], memory: [] } } }, at(MONDAY_9AM));
      const before = state.cash;
      send(state, 'career.dilemma', { choice: choice.id }, MONDAY_9AM);
      assert.ok(state.cash >= 0 && state.cash - before <= moneyCap('community-helper', 1), `${item.id}/${choice.id} cash ${state.cash}`);
    }
  }
});

const regular = (id: string) => need(NPCS[id], id);
const hereOf = (state: LifeState, now: number, id: string) => need(viewLife(state, at(now)).social.here.find((npc) => npc.id === id), `${id} is here`);

test('place actions: the market offers Haggle, a church regular only offers the greeting just after a service, elders get respect', () => {
  setSwitch(true);
  const market = createLife({ t: MONDAY_9AM, location: 'market', spot: 'people' }, at(MONDAY_9AM));
  for (const id of ['iya-bose', 'emeka']) assert.ok(hereOf(market, MONDAY_9AM, id).actions.some((action) => action.id === 'haggle' && action.pcmLabel === 'Bargain Price'), `${id} haggles`);
  assert.equal(hereOf(market, MONDAY_9AM, 'iya-bose').actions.slice(0, NPC_ACTIONS.length).map((action) => action.id).join(), NPC_ACTIONS.map((action) => action.id).join(), 'the usual actions come first');

  const church = (now: number) => createLife({ t: now, location: 'church', spot: 'people' }, at(now));
  assert.ok(!hereOf(church(SUNDAY_9AM), SUNDAY_9AM, 'sister-grace').actions.some((action) => action.id === 'after-service'), 'before the service ends');
  assert.ok(!hereOf(church(MONDAY_9AM), MONDAY_9AM, 'sister-grace').actions.some((action) => action.id === 'after-service'), 'on a Monday');
  assert.ok(hereOf(church(SUNDAY_11AM), SUNDAY_11AM, 'sister-grace').actions.some((action) => action.id === 'after-service'), 'just after the service');
  assert.ok(hereOf(church(SUNDAY_11AM), SUNDAY_11AM, 'usher-ben').actions.some((action) => action.id === 'after-service'));
  const early = send(church(SUNDAY_9AM), 'activity', { id: activityId('sister-grace', 'after-service') }, SUNDAY_9AM);
  assert.equal(early.ok, false); assert.equal(early.code, 'not_now');
  assert.equal(send(church(SUNDAY_11AM), 'activity', { id: activityId('sister-grace', 'after-service') }, SUNDAY_11AM).ok, true);

  const mosque = (now: number) => createLife({ t: now, location: 'mosque', spot: 'people' }, at(now));
  const friday2pm = Date.UTC(2026, 0, 9, 13, 20);
  assert.ok(hereOf(mosque(friday2pm), friday2pm, 'alhaji-sani').actions.some((action) => action.id === 'after-service'), 'Friday after prayers');
  assert.ok(!hereOf(mosque(SUNDAY_11AM), SUNDAY_11AM, 'alhaji-sani').actions.some((action) => action.id === 'after-service'));

  assert.deepEqual(['market', 'church', 'mosque', 'viewing', 'hospital', 'office', 'salon'].map((kind) => PLACE_ACTIONS.some((action) => action.places?.includes(kind))), Array(7).fill(true));
  assert.equal(placeKindOf('lagos', 'church'), 'church');
  assert.equal(placeKindOf('lagos', 'mosque'), 'mosque');
  assert.equal(placeKindOf('lagos', 'no-such-venue'), null);
  assert.equal(isAfterService('market', SUNDAY_11AM), false);
  assert.ok(placeActionsFor(regular('iya-bose'), 'market', null).some((action) => action.id === 'respect'), 'Iya is an elder title');
  for (const [id, kind, action] of [['oga-tunde', 'viewing', 'argue-football'], ['mama-bisi', 'salon', 'dryer-gist'], ['nurse-kemi', 'hospital', 'queue'], ['mrs-okafor', 'office', 'queue']] as const) {
    assert.ok(placeActionsFor(regular(id), kind, null).some((item) => item.id === action), `${id} offers ${action}`);
  }
});

test('place actions count against the daily limit with the usual ones', () => {
  setSwitch(true);
  const state = createLife({ t: MONDAY_9AM, location: 'market', spot: 'people' }, at(MONDAY_9AM));
  const plan = ['hello', 'haggle', 'gist', 'respect'];
  assert.equal(plan.length, DAILY_INTERACTIONS);
  for (const [i, action] of plan.entries()) {
    const now = MONDAY_9AM + i * 120000;
    const started = send(state, 'activity', { id: activityId('iya-bose', action) }, now, `limit-${i}`);
    assert.equal(started.ok, true, `${action}: ${started.ok ? '' : started.reason}`);
    advanceLife(state, 60, at(now + 60000, `limit-${i}`));
  }
  const blocked = send(state, 'activity', { id: activityId('iya-bose', 'haggle') }, MONDAY_9AM + 900000);
  assert.equal(blocked.ok, false); assert.equal(blocked.code, 'npc_daily_limit');
  assert.equal(send(state, 'activity', { id: activityId('emeka', 'haggle') }, MONDAY_9AM + 900000).ok, true, 'another regular is unaffected');
});

/** Haggles with Iya Bose from fresh lives until one ends with (or without) a coupon; the chance is 40% before charisma and closeness. */
function haggle(seedBase: string, wantLanded: boolean): LifeState {
  for (let i = 0; i < 300; i++) {
    const state = createLife({ t: MONDAY_9AM, cash: 5000, location: 'market', spot: 'people' }, at(MONDAY_9AM, `${seedBase}${i}`));
    assert.equal(send(state, 'activity', { id: activityId('iya-bose', 'haggle') }, MONDAY_9AM, `${seedBase}${i}`).ok, true);
    advanceLife(state, 60, at(MONDAY_9AM + 60000, `${seedBase}${i}`));
    if (Boolean(state.social.coupon) === wantLanded) return state;
  }
  throw new Error('no seed gave that outcome');
}

test('haggling: a success writes a coupon and the memory tag, a failure writes neither, and a grocery order uses the coupon once', () => {
  setSwitch(true);
  const failed = haggle('lose-', false);
  assert.equal('coupon' in failed.social, false);
  assert.equal('tags' in need(failed.social.rel['iya-bose']), false);
  assert.match(failed.message, /was not moved this time/);

  const won = haggle('win-', true);
  assert.deepEqual(won.social.coupon, { pct: 10, day: today });
  assert.deepEqual(won.social.rel['iya-bose']?.tags, ['haggled']);
  assert.match(won.message, /10% off your next grocery order today/);

  const rice = { id: 'rice', packs: 2 }; // 2 × ₦600
  const first = send(won, 'home.grocery-buy', rice, MONDAY_9AM + 120000);
  assert.equal(first.ok, true, first.ok ? '' : first.reason);
  assert.equal(5000 - won.cash, 1200 - 120, 'ten percent off');
  assert.equal('coupon' in won.social, false, 'the coupon is spent');
  const cashAfterFirst = won.cash;
  assert.equal(send(won, 'home.grocery-buy', rice, MONDAY_9AM + 180000).ok, true);
  assert.equal(cashAfterFirst - won.cash, 1200, 'the next order is full price');
});

test('a coupon is worth at most ₦300, only on the day it was earned, and only while the switch is on', () => {
  setSwitch(true);
  const big = createLife({ t: MONDAY_9AM, cash: 100000, social: { coupon: { pct: 50, day: today } } }, at(MONDAY_9AM));
  assert.deepEqual(big.social.coupon, { pct: 50, day: today });
  assert.equal(send(big, 'home.grocery-buy', { id: 'veg-oil', packs: 10 }, MONDAY_9AM).ok, true); // 10 × 800 = 8000
  assert.equal(100000 - big.cash, 8000 - COUPON_MAX_SAVING, 'the saving is capped');
  const stale = createLife({ t: MONDAY_9AM, cash: 5000, social: { coupon: { pct: 10, day: today - 1 } } }, at(MONDAY_9AM));
  assert.equal(send(stale, 'home.grocery-buy', { id: 'rice', packs: 1 }, MONDAY_9AM).ok, true);
  assert.equal(5000 - stale.cash, 600, 'yesterday’s coupon does nothing');
  setSwitch(false);
  const off = createLife({ t: MONDAY_9AM, cash: 5000, social: { coupon: { pct: 10, day: today } } }, at(MONDAY_9AM));
  assert.equal(send(off, 'home.grocery-buy', { id: 'rice', packs: 1 }, MONDAY_9AM).ok, true);
  assert.equal(5000 - off.cash, 600, 'switched off, a saved coupon does nothing');
});

test('the engine never imports the lazy kit, and a switch that is on does nothing without it', async () => {
  const here = new URL('.', import.meta.url);
  const { readFileSync } = await import('node:fs');
  const eager = ['features.ts', 'dilemma-book.ts', 'systems/career.ts', 'systems/social.ts', 'systems/activities.ts', 'content/npcs.ts'];
  for (const file of eager) {
    const code = readFileSync(new URL(file, here), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const match of code.matchAll(/^\s*(?:import|export)\s+(type\s+)?[^'";]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)) {
      if (match[1]) continue;
      const specifier = match[2] ?? match[3] ?? '';
      assert.ok(!/(^|\/)(dilemma-pack|dilemmas|place-actions)\.ts$/.test(specifier), `${file} imports ${specifier}`);
    }
  }
  assert.equal(typeof dilemmaKit, 'function');
});

test('a waiting dilemma that the kit no longer has is shown by id, cannot be answered, and does not hold the place', () => {
  setSwitch(true);
  const state = createLife({ t: MONDAY_9AM, job: 'tech', career: { dilemmas: { pending: { id: 'removed-long-ago', seed: 4 }, seen: [], memory: [] } } }, at(MONDAY_9AM));
  assert.deepEqual(state.career.dilemmas?.pending, { id: 'removed-long-ago', seed: 4 });
  assert.deepEqual(viewLife(state, at(MONDAY_9AM)).career.dilemma, { id: 'removed-long-ago' });
  assert.equal(send(state, 'career.dilemma', { choice: 'x' }, MONDAY_9AM).code, 'no_dilemma');
  const replaced = Array.from({ length: 80 }, (_, i) => workShift('tech', `gone-${i}`, { career: { level: 1, performance: 0, shifts: 0, dilemmas: { pending: { id: 'removed-long-ago', seed: 4 }, seen: [], memory: [] } } }))
    .find((life) => life.career.dilemmas?.pending?.id !== 'removed-long-ago');
  assert.ok(replaced, 'a finished shift replaces it with one that exists');
  assert.ok(dilemmaById(need(replaced.career.dilemmas?.pending).id));
});
