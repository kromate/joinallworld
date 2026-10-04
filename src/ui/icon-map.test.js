// No emoji is drawn anywhere in the UI: every icon the game's content can put on screen maps to a glyph of our own set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { glyphNameFor, glyphOfEmoji, iconFor, withGlyphs, stripLeadEmoji } from './icon-map.js';
import { hasGlyph, glyph, glyphFor } from './phone/icons.js';
import { VENUES, COMING_SOON } from '../game/content/venues.ts';
import { FURNITURE, CATEGORIES, HOME_SPOTS, HOME_ACTIVITIES } from '../game/content/furniture.ts';
import { INGREDIENTS, RECIPES } from '../game/content/food.ts';
import { JOBS } from '../game/content/jobs.ts';
import { CARS } from '../game/content/cars.ts';
import { ALL_MODES } from '../game/content/travel.ts';
import { EVENTS } from '../game/content/events.ts';
import { STARTER_GOALS, WISHES, PERKS } from '../game/content/goals.ts';
import { NPCS, NPC_ACTIONS, PLAYER_ACTIONS, FAMILY } from '../game/content/npcs.ts';
import { AD_ICONS } from '../game/content/civic.ts';
import { HEALTH } from '../game/content/health.ts';
import { TRAITS, DREAMS, START_HOMES, LOTTERY, MOODS } from '../game/content/traits.ts';

const EMOJI = /(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*)*)/gu;
/** A glyph that is really drawn: registered, and not the generic fallback mark. */
const drawn = (name) => hasGlyph(name) && name !== 'info';

test('every piece of content that reaches the UI maps to a glyph of the first download — by id or by its emoji, never by luck', () => {
  // Everything below is asserted BEFORE ./phone/icons-more.js is imported: a venue panel, a HUD chip, the map and a
  // travel tile are first paint, and so are the home's furniture and kitchen (their activity cards).
  const seen = [];
  const check = (kind, id, icon) => {
    const name = glyphNameFor(kind, id, icon);
    assert.ok(drawn(name), `${kind} "${id}" (${icon}) → "${name}" is not a drawn glyph`);
    // Not the kind's catch-all: either its id is listed, or its emoji is in the table.
    assert.ok(glyphNameFor(kind, id) === name || glyphOfEmoji(icon) === name || hasGlyph(icon), `${kind} "${id}" (${icon}) only reached its kind's default glyph`);
    assert.match(iconFor(kind, id, icon), /^<svg class="ui-glyph" aria-hidden="true" viewBox="0 0 24 24"/);
    seen.push(name);
  };
  for (const venue of [...Object.values(VENUES), ...Object.values(COMING_SOON)]) {
    check('venue', venue.id, venue.icon);
    for (const spot of Object.values(venue.spots || {})) {
      if (spot.icon) check('spot', spot.id, spot.icon);
      for (const activity of spot.activities || []) check('activity', activity.id, activity.icon);
    }
  }
  for (const spot of Object.values(HOME_SPOTS)) check('spot', spot.label, spot.icon);
  for (const activity of HOME_ACTIVITIES) if (activity.icon) check('activity', activity.id, activity.icon);
  for (const item of Object.values(FURNITURE)) check('furniture', item.id, item.icon);
  for (const category of [...CATEGORIES, { id: 'storage' }]) check('category', category.id, category.icon);
  for (const item of [...Object.values(INGREDIENTS), ...Object.values(RECIPES)]) check('food', item.id, item.icon);
  for (const job of Object.values(JOBS)) { check('track', job.id, job.icon); if (job.shift) check('activity', job.shift.id, job.shift.icon); }
  for (const car of Object.values(CARS)) check('car', car.id, car.icon);
  for (const mode of [...Object.values(ALL_MODES), { id: 'commute' }]) check('mode', mode.id, mode.icon);
  for (const event of Object.values(EVENTS)) check('event', event.id, event.icon);
  for (const goal of STARTER_GOALS) check('goal', goal.id, goal.icon);
  for (const wish of WISHES) check('wish', wish.id, wish.icon);
  for (const perk of PERKS) check('perk', perk.id, perk.icon);
  for (const action of [...NPC_ACTIONS, ...PLAYER_ACTIONS]) check('npc-action', action.id, action.icon);
  for (const kind of Object.values(HEALTH.weather.kinds)) check('weather', kind.id, kind.icon);
  for (const level of ['sick', 'rundown', 'rain', 'well']) check('health', level);
  for (const need of ['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder']) check('need', need);
  for (const mood of MOODS) check('mood', mood.tone, mood.icon);
  for (const icon of AD_ICONS) check('ad', icon.id, icon.icon);
  for (const trait of Object.values(TRAITS)) check('trait', trait.id, trait.icon);
  for (const dream of Object.values(DREAMS)) check('dream', dream.id, dream.icon);
  for (const home of Object.values(START_HOMES)) check('home', home.id, home.icon);
  for (const outcome of Object.values(LOTTERY.outcomes || LOTTERY).filter((item) => item && item.id)) check('lottery', outcome.id, outcome.icon);
  // People are drawn as a lettered avatar or the person glyph — an emoji face is never shown.
  for (const person of [...Object.values(NPCS), ...Object.values(FAMILY)]) assert.equal(glyphNameFor('npc', person.id, person.emoji), 'person', person.id);
  for (const kind of ['rent-due', 'rent', 'rent-missed', 'loan', 'loan-missed', 'promotion', 'illness', 'recovered', 'gov', 'transfer', 'bae']) assert.ok(drawn(glyphNameFor('notice', kind)), kind);
  for (const kind of ['transfer', 'report', 'friend-request', 'friend-accepted', 'invite-knock', 'invite-answer', 'group-added', 'bae-request', 'bae-answer']) assert.ok(drawn(glyphNameFor('update', kind)), kind);
  assert.ok(seen.length > 450, `walked the whole catalogue (${seen.length} icons)`);
  assert.ok(new Set(seen).size > 60, 'and it is drawn with a real vocabulary, not a handful of marks');
});

test('every emoji written anywhere in the game content or the systems has a glyph', async () => {
  for (const dir of ['../game/content/', '../game/systems/']) {
    for (const file of (await readdir(new URL(dir, import.meta.url))).filter((name) => name.endsWith('.js') && !name.endsWith('.test.js'))) {
      const source = await readFile(new URL(dir + file, import.meta.url), 'utf8');
      for (const emoji of new Set(source.match(EMOJI) || [])) assert.ok(drawn(glyphOfEmoji(emoji)), `${file}: ${emoji} has no glyph in src/ui/icon-map.js`);
    }
  }
});

test('unknown content still draws something sensible, and text that arrives with emoji is shown with glyphs', () => {
  assert.equal(glyphNameFor('spot', 'a-new-spot', '🪐'), 'pin');
  assert.equal(glyphNameFor('activity', 'a-new-activity'), 'star');
  assert.equal(glyphNameFor('npc', 'someone'), 'person');
  assert.equal(glyphNameFor('never-heard-of-it', 'x'), 'info');
  assert.equal(glyphNameFor('empty', null, 'search'), 'search', 'a glyph name is accepted where an emoji used to be passed');
  assert.equal(glyphNameFor('venue', 'x', '🇳🇬'), 'globe');
  assert.equal(glyphNameFor('activity', 'x', '👩🏾‍🍳'), 'person', 'skin tones and ZWJ sequences resolve by their first character');
  // A server line that starts with an emoji loses it next to a toast's own glyph; one inside the line becomes a glyph.
  assert.equal(stripLeadEmoji('💎 Gem found: 2 of 5 today.'), 'Gem found: 2 of 5 today.');
  assert.equal(stripLeadEmoji('🏛️  A new Governor'), 'A new Governor');
  assert.equal(stripLeadEmoji('Goal complete: Freshen up · +₦500 +1✨'), 'Goal complete: Freshen up · +₦500 +1✨');
  const html = withGlyphs('Goal complete: <b>Eat</b> · +₦500 +1✨');
  assert.match(html, /^Goal complete: &lt;b&gt;Eat&lt;\/b&gt; · \+₦500 \+1<svg class="ui-glyph"/, 'the text is escaped; the star is a glyph');
  assert.doesNotMatch(html, EMOJI);
  assert.equal(withGlyphs('→ · − ₦ ✓ are text'), '→ · − ₦ ✓ are text');
  assert.equal(glyph('not-loaded-yet').includes('<circle cx="12" cy="12" r="3"'), true, 'a glyph that is not registered draws the placeholder dot');
});

test('every panel id has a glyph for its sheet head and its Sim tab, and the rest of the set registers itself', async () => {
  const eager = ['session', 'city', 'map', 'roadside', 'buy', 'goals', 'goal-chip', 'home-chip', 'social-inbox', 'hunt', 'hunt-sheet', 'radio', 'radio-banner', 'health', 'health-chip', 'weather-chip',
    'profile', 'needs', 'skills', 'people', 'person', 'career', 'settings', 'jobs', 'bank', 'groceries', 'ride', 'houses', 'boutique', 'cars', 'invest', 'messages', 'invite', 'governor', 'state-house',
    'richlist', 'statement', 'onboarding', 'account', 'help', 'community'];
  for (const id of eager) assert.ok(drawn(glyphFor(id)), `${id} → ${glyphFor(id)}`);
  const later = ['contacts', 'family', 'neighbours', 'ads', 'support'];
  for (const id of later) { assert.equal(glyphFor(id), id); assert.equal(hasGlyph(id), false, `${id} is not in the first download`); }
  let told = 0;
  const { onGlyphs } = await import('./phone/icons.js');
  const off = onGlyphs(() => { told += 1; });
  await import('./phone/icons-more.js');
  off();
  for (const id of later) assert.ok(drawn(glyphFor(id)), `${id} is drawn once icons-more.js has loaded`);
  assert.ok(told <= 1, 'listeners hear about it once (or it was already loaded by another test file in this process)');
});
