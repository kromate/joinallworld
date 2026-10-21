// OWNER: minigames — the mini-games on the page (docs/MINI-GAMES.md): the haggle's offers and replay, the seasons' tabs and countdown, the skit and the cards drawn
// without throwing in every pose and place, and that all three apps are lazy, so none of it is in the first download.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENTS } from '../../../telemetry/events.ts';
import { BACKDROPS, POSES, addActor, newSkit, setPose, setCaption, setTitle } from '../../../minigames/skit.ts';
import type { Skit } from '../../../minigames/skit.ts';
import type { HaggleBest, HaggleTalkView, JambCard, NyscCard, NyscView, SeasonsView } from '../../../types/minigames.ts';
import { GRADE_WORDS, MEMORY_WORDS, STEP, clock, naira, nextStep, offerChoices, readTyped, replayMs, savedLine, secondsLeft, shownAt, timeline } from './haggleModel.ts';
import { answersFor, campProgress, dutyToday, mockClock, mockSeconds, tabsFor } from './seasonsModel.ts';
import { drawSkit } from './skitDraw.ts';
import { drawJamb, drawNysc } from './seasonCards.ts';
import { fit } from './haggleCard.ts';
import { wrap } from './cardKit.ts';

/** A canvas context that accepts every call and remembers the text it was asked to draw. */
function fakeContext() {
  const texts: string[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(_, key: string) {
      if (key === 'measureText') return (text: string) => ({ width: text.length * 14 });
      if (key === 'fillText' || key === 'strokeText') return (text: string) => { texts.push(text) };
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: () => undefined });
      return key in target ? target[key] : () => undefined;
    },
    set(_, key: string, value: unknown) { target[key] = value; return true },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

const talk = (over: Partial<HaggleTalkView> = {}): HaggleTalkView => ({ item: 'ankara', label: 'Ankara wax print', list: 2000, ask: 2000, roundsLeft: 4, state: 'open', deal: null, dealUntil: null, lines: [], saved: 0, grade: null, ...over });
const best: HaggleBest = { trader: 'Alhaja Sade', stall: 'Balogun Market', city: 'lagos', item: 'Ankara wax print', list: 2000, price: 1640, saved: 360, grade: 'sharp', at: 1,
  lines: [{ who: 'trader', text: 'Welcome, welcome! Ankara wax print na ₦2,000. Make your offer, we go talk.' }, { who: 'you', text: 'I can pay ₦1,500.' }, { who: 'trader', text: 'Better, but small small. ₦1,800 for Ankara wax print, e fit work.' }, { who: 'you', text: 'I can pay ₦1,640.' }, { who: 'trader', text: 'Deal! Ankara wax print for ₦1,640. You don win me today, I hold am for you.' }] };

test('the haggle: offers worth a tap sit under the ask in steps of ten; a typed offer is whole naira', () => {
  assert.deepEqual(offerChoices(2000, 2000), [1600, 1700, 1800, 1900, 1920], 'four shares of the list, and a small step under the ask');
  for (const ask of [2000, 1850, 1700, 1600, 1000, 90]) {
    const choices = offerChoices(ask * 1, ask);
    assert.ok(choices.every((value) => value < ask && value >= STEP && value % STEP === 0), `${ask}: ${choices}`);
    assert.deepEqual(choices, [...new Set(choices)].sort((a, b) => a - b));
  }
  assert.deepEqual(offerChoices(1000, 10), []);
  assert.equal(readTyped('₦1,700'), 1700);
  assert.equal(readTyped(' 1700 '), 1700);
  assert.equal(readTyped('17.5'), null);
  assert.equal(readTyped('five'), null);
  assert.equal(readTyped('5'), null);
  assert.equal(readTyped('99999999'), null);
  assert.equal(naira(1640), '₦1,640');
});

test('the haggle: what to do next, the held price\'s clock, the words for memory and grade', () => {
  assert.equal(nextStep(undefined), 'open');
  assert.equal(nextStep(talk()), 'offer');
  assert.equal(nextStep(talk({ state: 'final' })), 'final');
  assert.equal(nextStep(talk({ state: 'deal', deal: 1700 })), 'buy');
  assert.equal(nextStep(talk({ state: 'bought', deal: 1700 })), 'done');
  assert.equal(secondsLeft(10_000, 4_000), 6);
  assert.equal(secondsLeft(10_000, 20_000), 0);
  assert.equal(secondsLeft(null, 0), 0);
  assert.equal(clock(65), '1:05');
  assert.deepEqual(Object.keys(MEMORY_WORDS).sort(), ['again', 'new', 'regular', 'returning']);
  assert.match(MEMORY_WORDS.again, /last prices/);
  assert.deepEqual(Object.keys(GRADE_WORDS).sort(), ['fair', 'floor', 'good', 'sharp']);
  assert.equal(savedLine(best), 'Saved ₦360 on the ankara wax print');
  assert.equal(savedLine({ saved: 0, item: 'Cap' }), 'Paid the list price for the cap');
});

test('the haggle replay: each line appears after the one before it, then the card holds', () => {
  const steps = timeline(best.lines);
  assert.equal(steps.length, best.lines.length);
  assert.ok(steps.every((step, at) => at === 0 || step.at > steps[at - 1]!.at));
  assert.equal(shownAt(best.lines, 0), 0);
  assert.equal(shownAt(best.lines, steps[1]!.at), 2);
  assert.equal(shownAt(best.lines, replayMs(best.lines)), best.lines.length);
  assert.ok(replayMs(best.lines) > steps.at(-1)!.at, 'the result is held after the last line');
  assert.ok(replayMs(best.lines) < 30_000);
});

test('the haggle card fits the talk above its result, newest lines first to go, and draws without trouble', () => {
  const { ctx, texts } = fakeContext();
  const lines = Array.from({ length: 6 }, (_, n) => ({ who: n % 2 ? 'you' as const : 'trader' as const, text: `Line number ${n} ${'word '.repeat(12)}` }));
  const kept = fit(ctx, lines);
  assert.ok(kept.length >= 1 && kept.length <= lines.length);
  assert.deepEqual(kept, lines.slice(lines.length - kept.length), 'the latest lines are the ones kept');
  assert.deepEqual(wrap(ctx, 'a b c', 1000), ['a b c']);
  assert.ok(wrap(ctx, 'word '.repeat(100), 200, 3).length <= 3);
  assert.ok(texts.length >= 0);
});

test('the seasons: nothing outside Nigeria, only a season that is open or joined, the camp\'s day count and the mock\'s countdown', () => {
  const nysc = (over: Partial<NyscView> = {}): NyscView => ({ on: false, batch: '2026-C', joined: false, day: 0, camp: null, platoon: null, stages: [], dutyToday: false, passingOut: 'locked', card: null, earned: 0, ...over });
  const jamb = (on: boolean, joined = false): SeasonsView['jamb'] => ({ on, year: '2027', joined, day: 0, practice: null, mock: { state: 'locked', questions: [], endsAt: null, minutes: 20, result: null }, streak: 0, resultsDay: 7, resultsReady: false, card: null, earned: 0, caps: { practiceDay: 250, mock: 1000 } });
  const view = (nigeria: boolean, n: NyscView, j: SeasonsView['jamb']): SeasonsView => ({ nigeria, city: 'lagos', nysc: n, jamb: j });
  assert.deepEqual(tabsFor(null), []);
  assert.deepEqual(tabsFor(view(false, nysc({ on: true }), jamb(true))), [], 'for Nigeria only');
  assert.deepEqual(tabsFor(view(true, nysc(), jamb(false))), [], 'both switched off');
  assert.deepEqual(tabsFor(view(true, nysc({ on: true }), jamb(false))), ['nysc']);
  assert.deepEqual(tabsFor(view(true, nysc(), jamb(false, true))), ['jamb'], 'a joined season stays');
  assert.deepEqual(tabsFor(view(true, nysc({ on: true }), jamb(true))), ['nysc', 'jamb']);
  assert.equal(campProgress(nysc()), '');
  assert.equal(campProgress(nysc({ joined: true, day: 8 })), 'Day 9 of 21');
  assert.equal(campProgress(nysc({ joined: true, day: 21 })), 'Passing out parade');
  assert.equal(campProgress(nysc({ joined: true, day: 25, passingOut: 'done' })), 'You have passed out');
  const stages = [{ id: 'registration' as const, title: 'W1', blurb: '', opensDay: 0, open: true, done: false, duties: [{ id: 'documents', title: 'D', scene: '', options: [], done: true }, { id: 'medicals', title: 'M', scene: '', options: [], done: false }] },
    { id: 'platoon' as const, title: 'W2', blurb: '', opensDay: 7, open: false, done: false, duties: [{ id: 'formation', title: 'F', scene: '', options: [], done: false }] }];
  assert.deepEqual(dutyToday(nysc({ joined: true, stages })), { stage: 'registration', duty: 'medicals' });
  assert.equal(dutyToday(nysc({ joined: true, stages, dutyToday: true })), null, 'one a day');
  assert.equal(dutyToday(nysc()), null);
  assert.equal(mockSeconds({ endsAt: 100_000 }, 40_000), 60);
  assert.equal(mockSeconds({ endsAt: 100_000 }, 200_000), 0);
  assert.equal(mockSeconds({ endsAt: null }, 0), 0);
  assert.equal(mockClock(1199), '19:59');
  assert.deepEqual(answersFor([{ id: 5 }, { id: 9 }, { id: 2 }], { 9: 3, 2: 0 }), [null, 3, 0], 'a blank is null and a first choice of zero is kept');
});

test('every pose in every place, on every kind of frame, draws without throwing, and the words on show are the skit\'s own', () => {
  let skit: Skit = newSkit({ id: 'me', name: 'Ada' });
  for (const friend of ['b', 'c', 'd']) skit = addActor(skit, { id: friend, name: `Friend ${friend}` });
  skit = setTitle(skit, 'The market quarrel');
  skit = setCaption(skit, 0, 'Wetin you dey sell?');
  for (const place of BACKDROPS) for (const pose of POSES) {
    const posed = [0, 1, 2, 3].reduce((acc, who) => setPose(acc, 0, who, pose), { ...skit, backdrop: place.id } as Skit);
    for (const ms of [0, 1200, 2600, 5000, 20_000, 28_500, 29_800]) {
      const { ctx } = fakeContext();
      const frame = drawSkit(ctx, posed, ms);
      assert.ok(['title', 'beat', 'end'].includes(frame.phase));
    }
  }
  const { ctx, texts } = fakeContext();
  drawSkit(ctx, skit, 0);
  assert.ok(texts.includes('The market quarrel'), 'the title card shows the title');
  assert.ok(texts.some((text) => text.includes('captions only, no sound')), 'and says there is no sound');
  const second = fakeContext();
  drawSkit(second.ctx, skit, 3000);
  assert.ok(second.texts.includes('Wetin you dey sell?'), 'the caption shows on its beat');
  assert.ok(second.texts.includes('Ada') && second.texts.includes('Friend b'), 'the actors wear their names');
});

test('the two season cards say what the game recorded', () => {
  const nysc: NyscCard = { name: 'Ada', batch: '2026-C', camp: 'Iyana-Ipaja Orientation Camp', state: 'Lagos State', platoon: 7, honour: 'Distinction', posting: 'a community library, running reading hours', passedOutDay: '2026-11-20' };
  const a = fakeContext();
  drawNysc(a.ctx, nysc);
  for (const text of ['Ada', 'Distinction']) assert.ok(a.texts.includes(text), text);
  assert.ok(a.texts.some((text) => text.includes('Platoon 7')) && a.texts.some((text) => text.includes('Iyana-Ipaja')));
  const jamb: JambCard = { name: 'Ada', year: '2027', score: 300, correct: 15, total: 20, best: 'maths', practiceDays: 3, practiceCorrect: 14, practiceAnswered: 15, streak: 3, band: 'Good' };
  const b = fakeContext();
  drawJamb(b.ctx, jamb);
  assert.ok(b.texts.includes('300') && b.texts.includes('Ada'));
  assert.ok(b.texts.some((text) => text.includes('Maths')) && b.texts.some((text) => text.includes('15 of 20')));
});

test('the telemetry events exist and name nothing about a person', () => {
  for (const name of ['haggle_talk', 'skit_made', 'season_step']) {
    const spec = EVENTS[name];
    assert.ok(spec && spec.from === 'world' && spec.when.length > 15 && spec.why.length > 10, name);
    assert.ok(!Object.keys(spec.props).some((key) => /name|id|handle|city|text/i.test(key)), `${name} props: ${Object.keys(spec.props)}`);
  }
});

test('all three apps are lazy panels: a body loader in the registry, no static import from anywhere else, so none of it is in the first download', () => {
  const here = fileURLToPath(new URL('.', import.meta.url)), src = join(here, '..', '..', '..');
  const register = readFileSync(join(src, 'app', 'features', 'living-world', 'register.ts'), 'utf8');
  for (const [id, body] of [['haggle', 'HaggleApp'], ['skit', 'SkitApp'], ['seasons', 'SeasonsApp']]) {
    assert.match(register, new RegExp(`phonePanel\\('${id}', [^\\n]*bodyLoader\\('minigames/${body}'\\)`), `${id} is a lazy phone panel`);
    assert.match(readFileSync(join(src, 'app', 'state', 'panelBodies.ts'), 'utf8'), new RegExp(`'minigames/${body}': \\(\\) => import\\('\\.\\./features/minigames/${body}\\.vue'\\)`));
  }
  // Nothing outside the mini-games' own folders imports them with a static import.
  const own = (path: string): boolean => /[\\/](minigames)[\\/]/.test(path) || /minigames\.test\.ts$/.test(path);
  const walk = (dir: string, out: string[] = []): string[] => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) { if (name !== 'node_modules') walk(path, out) } else if (/\.(ts|vue)$/.test(name)) out.push(path) } return out };
  for (const file of walk(src).filter((path) => !own(path))) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /^\s*import(?!\s+type\b)[^\n]*from\s+['"][^'"]*minigames[^'"]*['"]/m, `${file} statically imports the mini-games (a type-only import is free)`);
  }
  // The apps load their drawing and card code only when it is used.
  for (const [file, modules] of [['HaggleApp.vue', ['haggleCard', 'captureSession']], ['SkitApp.vue', ['captureSession']], ['NyscPanel.vue', ['seasonCards', 'captureSession']], ['JambPanel.vue', ['seasonCards', 'captureSession']]] as const) {
    const source = readFileSync(join(here, file), 'utf8');
    for (const name of modules) assert.match(source, new RegExp(`await import\\('[^']*${name}\\.ts'\\)`), `${file} loads ${name} on demand`);
  }
  const seasons = readFileSync(join(here, 'SeasonsApp.vue'), 'utf8');
  assert.match(seasons, /defineAsyncComponent\(\(\) => import\('\.\/NyscPanel\.vue'\)\)/);
  assert.match(seasons, /defineAsyncComponent\(\(\) => import\('\.\/JambPanel\.vue'\)\)/);
});

test('the apps say what they are: AI-played traders, game naira only, nothing real, and the seasons for Nigeria only', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const haggle = readFileSync(join(here, 'HaggleApp.vue'), 'utf8');
  assert.match(haggle, /AI-played/);
  assert.match(haggle, /Game naira only/);
  assert.match(haggle, /Never real money/);
  const seasons = readFileSync(join(here, 'SeasonsApp.vue'), 'utf8');
  assert.match(seasons, /for Nigeria only/);
  assert.match(readFileSync(join(here, 'JambPanel.vue'), 'utf8'), /not past papers, and not an exam/);
  assert.match(readFileSync(join(here, 'NyscPanel.vue'), 'utf8'), /not an official programme/);
});
