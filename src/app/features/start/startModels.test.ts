// The pure parts of the start and identity panels: the look rules, the landing screen's Play, the
// settle-in draft, the cards' footers and the session form. No DOM.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { APPEARANCE } from '../../../game/content/traits.ts'
import type { Look } from '../../../types/life.ts'
import { avatarShapes, chooseLook, chosen, lookAlt, lookFocus, lookFocusBody, lookSummary, lookUi, openLookTab, randomLook, sameLook, sceneLook, starterWardrobe, toggleZoom, withAccessory } from './lookModel.ts'
import {
  DRAFT_KEY, dreamFoot, failureText, firstStep, homeFoot, homeMissing, homePayload, introFor, keepLook, keptCash, lookFoot, lotteryFoot, reasonOf, storedLook, toggleTrait, traitsFoot, triggerOf,
} from './onboardingModel.ts'
import { LOOK_REFUSED, PLAY_HELD, held, planPlay, problemOf, quickStartRequired, showsLinkNote, shownError } from './quickStartModel.ts'
import { nicknameOf, sessionRequired } from './sessionModel.ts'
import { PRESETS, presetLook, starterLook } from './startBoundary.ts'

const base: Look = { body: 'woman', hair: 'braids', outfit: 'owambe', fabric: 'ankara', skin: 'skin-4', hairColor: 'black', outfitColor: 'gold', bottomsColor: 'violet' }
const sequence = (...values: number[]) => { let at = 0; return () => values[at++ % values.length] ?? 0 }
const memory = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) }, removeItem: (key) => { data.delete(key) } }
}

// ---- the look ---------------------------------------------------------------------------------
test('the starter wardrobe leaves out what only the Boutique sells; the rest of the editor locks the same way', () => {
  const free = starterWardrobe()
  for (const id of APPEARANCE.boutiqueOnly.hair) assert.ok(!free.hair.includes(id))
  for (const id of APPEARANCE.boutiqueOnly.outfit) assert.ok(!free.outfit.includes(id))
  for (const id of APPEARANCE.boutiqueOnly.accessories) assert.ok(!(free.accessories as string[]).includes(id))
  assert.ok(free.hair.includes('braids') && free.outfit.includes('owambe') && free.fabric.length === APPEARANCE.fabrics.length)
})

test('putting on an accessory replaces the one in its slot; at the limit the oldest gives way; tapping again takes it off', () => {
  const eyes = withAccessory(base, 'glasses')
  assert.deepEqual(eyes, ['glasses'])
  assert.deepEqual(withAccessory({ ...base, accessories: eyes }, 'sunglasses'), ['sunglasses'], 'one per slot')
  const full = (['glasses', 'cap', 'earrings', 'chain', 'watch'] as const)
  assert.equal(full.length, APPEARANCE.accessoryLimit)
  assert.deepEqual(withAccessory({ ...base, accessories: [...full] }, 'beads'), ['cap', 'earrings', 'chain', 'watch', 'beads'])
  assert.deepEqual(chooseLook({ ...base, accessories: ['glasses'] }, 'accessories', 'glasses').accessories, [])
})

test('choosing a colour sets the field; choosing a body keeps the style when the new body has it and falls back to one that is owned', () => {
  assert.equal(chooseLook(base, 'skin', 'skin-2').skin, 'skin-2')
  const man = chooseLook({ ...base, hair: 'low-cut', outfit: 'casual' }, 'body', 'man')
  assert.deepEqual([man.body, man.hair, man.outfit], ['man', 'low-cut', 'casual'])
  const switched = chooseLook(base, 'body', 'man', starterWardrobe())
  assert.equal(switched.body, 'man')
  assert.ok(starterWardrobe().hair.includes(switched.hair) && starterWardrobe().outfit.includes(switched.outfit))
  assert.equal(switched.outfit, 'casual', 'owambe is a woman\'s outfit: the first allowed one is taken')
})

test('where the preview looks: the open tab, then what was changed last, then the stage\'s own switch', () => {
  openLookTab('body')
  assert.equal(lookFocus(), 'body')
  openLookTab('hair')
  assert.equal(lookFocus(), 'head')
  chooseLook(base, 'outfitColor', 'red')
  assert.equal(lookFocus(), 'body', 'a colour of the outfit looks at the body')
  chooseLook(base, 'hair', 'afro')
  assert.equal(lookFocus(), 'head')
  assert.equal(toggleZoom(), 'body')
  assert.equal(toggleZoom(), 'head')
  lookFocusBody()
  assert.equal(lookFocus(), 'body')
  openLookTab('nonsense')
  assert.equal(lookUi.section, 'body', 'an unknown tab opens the first')
})

test('the words of a look: summary, text alternative and what the scene is given', () => {
  const look: Look = { ...base, accessories: ['glasses'] }
  assert.equal(lookSummary(look), 'Woman · Braids · Owambe · Ankara · Glasses')
  const alt = lookAlt(look, 'Ada')
  assert.ok(alt.startsWith('Ada: Woman, warm brown skin') || alt.startsWith('Ada: Woman, brown skin'), alt)
  assert.ok(alt.includes('braids hairstyle in black') && alt.endsWith(', wearing glasses.'))
  const scene = sceneLook(look)
  assert.match(scene.skin, /^#[0-9a-f]{6}$/)
  assert.equal(scene.face, 'oval')
  assert.equal(scene.expression, 'smile')
})

test('the same look is the same whatever order the accessories are in and however the optional fields are spelled', () => {
  assert.equal(sameLook({ ...base, accessories: ['cap', 'glasses'] }, { ...base, accessories: ['glasses', 'cap'], face: undefined }), true)
  assert.equal(sameLook(base, { ...base, skin: 'skin-2' }), false)
})

test('a random look is one a new Sim may wear, and the server would accept it', () => {
  for (let seed = 0; seed < 40; seed++) {
    let n = seed
    const random = () => { n = (n * 9301 + 49297) % 233280; return n / 233280 }
    const look = randomLook(random)
    assert.ok(starterLook(look) !== null, 'the same rules the server applies')
    assert.ok(starterWardrobe().hair.includes(look.hair) && starterWardrobe().outfit.includes(look.outfit))
    assert.ok((look.accessories ?? []).length <= 2)
  }
  assert.equal(randomLook(() => 0).body, 'woman')
})

test('the flat figure: a shadow first, the face in the middle, a hoodie drawn with its hood, a gele in front', () => {
  const plain = avatarShapes({ ...base, outfit: 'casual', hair: 'low-cut', fabric: 'plain' })
  assert.equal(plain[0]?.tag, 'ellipse')
  assert.ok(plain.some((shape) => shape.tag === 'circle' && shape.attrs.r === 22), 'the head')
  const hood = avatarShapes({ ...base, body: 'man', outfit: 'hoodie', hair: 'bald', fabric: 'plain' })
  assert.ok(hood.some((shape) => shape.tag === 'path' && String(shape.attrs.d).startsWith('M34 78a26 30')))
  const gele = avatarShapes({ ...base, hair: 'gele' })
  assert.equal(gele[gele.length - 1]?.attrs.stroke, '#fff', 'the gele\'s fold is the last thing drawn')
  assert.ok(avatarShapes({ ...base, fabric: 'adire' }).length > avatarShapes({ ...base, fabric: 'plain' }).length)
  assert.equal(chosen(base, 'face', 'oval'), true, 'the default face is chosen when none is stored')
})

// ---- the landing screen -----------------------------------------------------------------------
test('a life is held at the landing screen until its look is confirmed - unless its Play is on its way', () => {
  const view = { onboarding: { required: true }, connected: true } as Parameters<typeof held>[0]
  assert.equal(quickStartRequired(view, false), PLAY_HELD)
  assert.equal(quickStartRequired(view, true), null)
  assert.equal(quickStartRequired({ ...view, connected: false }, false), null, 'offline there is nothing to confirm with')
  assert.equal(quickStartRequired({ onboarding: { required: false }, connected: true } as Parameters<typeof held>[0], false), null)
})

test('Play checks the name first, then that the character is one a new Sim may wear; the name is trimmed', () => {
  const look = presetLook(PRESETS[0]?.id ?? '') as Look
  assert.deepEqual(planPlay('  ', look), { kind: 'name', error: 'A name needs at least 3 characters.' })
  assert.deepEqual(planPlay('x'.repeat(25), look), { kind: 'name', error: 'A name can be at most 24 characters.' })
  assert.deepEqual(planPlay('Ada', { ...look, hair: 'twists' }), { kind: 'look', error: LOOK_REFUSED })
  const go = planPlay('  Ada  ', look)
  assert.equal(go.kind, 'go')
  if (go.kind === 'go') assert.equal(go.name, 'Ada')
})

test('the server\'s refusal wins over the sheet\'s own sentence; the link note stays quiet while there is something more important', () => {
  assert.equal(shownError('', { reason: 'That name is not allowed.' }), 'That name is not allowed.')
  assert.equal(shownError('Own', { reason: 'Theirs' }), 'Own')
  assert.equal(showsLinkNote({}, '', 'offline'), true)
  assert.equal(showsLinkNote({}, 'x', 'offline'), false)
  assert.equal(showsLinkNote({}, '', 'new'), false)
  assert.equal(showsLinkNote({}, '', 'connecting'), false)
  assert.equal(showsLinkNote(null, '', 'offline'), false)
  assert.deepEqual(problemOf({ reason: 'new', problem: { reason: 'No', name: 'Bad', extra: 1 } }), { reason: 'No', name: 'Bad' })
  assert.equal(problemOf(null), null)
  assert.equal(problemOf({ reason: 'new' }), null)
})

// ---- settling in --------------------------------------------------------------------------------
test('a guest starts on the second card; a life that was never a guest starts on the look', () => {
  assert.equal(firstStep(true), 1)
  assert.equal(firstStep(false), 0)
})

test('the look kept on the device is used only while every part of it is still a valid free choice, and only for its owner', () => {
  const storage = memory()
  keepLook('s1:lagos', base, storage)
  assert.deepEqual(storedLook('s1:lagos', storage), { ...base, accessories: [], face: 'oval', expression: 'smile' })
  assert.equal(storedLook('s2:lagos', storage), null, 'another life\'s draft')
  keepLook('s1:lagos', { ...base, hair: 'twists' }, storage)
  assert.equal(storedLook('s1:lagos', storage), null, 'a Boutique style is not a free choice')
  keepLook('s1:lagos', { ...base, accessories: ['glasses', 'sunglasses'] }, storage)
  assert.equal(storedLook('s1:lagos', storage), null, 'two in one slot, and one only the Boutique sells')
  storage.data.set(DRAFT_KEY, '{not json')
  assert.equal(storedLook('s1:lagos', storage), null)
  keepLook('s1:lagos', base, storage)
  keepLook('s1:lagos', null, storage)
  assert.equal(storage.data.has(DRAFT_KEY), false, 'moving on forgets it')
  assert.equal(storedLook('x', null), null, 'no storage: nothing kept')
})

test('why the sheet opened is said once, in the words of the existing sheet, and only to a guest', () => {
  const facts = { guest: true, name: 'Ada', cash: 12000, stars: 1 }
  assert.equal(introFor({ why: 'buy' }, { ...facts, guest: false }), null)
  assert.deepEqual(introFor({ why: 'buy' }, facts), { kind: 'why', strong: 'Settle in to get your home.', text: 'Buy mode furnishes your own room. A few quick choices and it is yours — everything you have earned is kept.' })
  assert.ok(introFor({ why: 'home' }, facts)?.text.startsWith('You are a guest in the city for now.'))
  const reward = introFor({ nudge: 'first-reward' }, facts)
  assert.equal(reward?.kind, 'reward')
  assert.equal(reward?.strong, 'Nice start, Ada! You have ₦12,000 and 1 star.')
  assert.ok(introFor({ nudge: 'first-reward' }, { ...facts, stars: 3 })?.strong.endsWith('3 stars.'))
  assert.equal(introFor({ nudge: 'next-day' }, facts)?.strong, 'Ready to make this life yours?')
  assert.equal(introFor(null, facts), null)
  assert.equal(introFor(undefined, facts), null)
  assert.equal(triggerOf({ nudge: 'third-activity', why: 'home' }), 'third-activity')
  assert.equal(triggerOf({ why: 'home' }), 'home')
  assert.equal(triggerOf(null), 'asked')
  assert.deepEqual(reasonOf({ why: 5, nudge: '' }), {})
})

test('the primary action of each card says what it does and what is still missing', () => {
  assert.equal(lookFoot(true, '').why, 'Still to choose: 2 traits, a dream, the birth lottery and a home.')
  assert.equal(lookFoot(false, 'No internet').why, 'No internet: your look is kept on this device and is saved when you are connected again.')
  assert.equal(lookFoot(false, '').why.startsWith('Not connected:'), true)
  assert.deepEqual(traitsFoot(0), { label: 'Choose 2 more', action: 'traits', disabled: true, why: '0 of 2 traits chosen.' })
  assert.equal(traitsFoot(1).label, 'Choose 1 more')
  assert.deepEqual(traitsFoot(2), { label: 'Next: your dream', action: 'traits', disabled: false, why: '' })
  assert.deepEqual(dreamFoot(null), { label: 'Choose a dream', action: 'dream', disabled: true, why: 'Tap one of the dreams above to continue.' })
  assert.equal(dreamFoot('lekki-landlord').label, 'Next: birth lottery')
  assert.equal(lotteryFoot(false).action, 'lottery')
  assert.equal(lotteryFoot(true).label, 'Choose where to live')
  assert.equal(homeMissing(undefined), 'Choose your local government to continue.')
  assert.equal(homeMissing({ lga: 'ikeja', via: 'manual' }), '')
  assert.deepEqual(homeFoot('Choose your local government to continue.', ''), { label: 'Choose your local government', action: 'home', disabled: true, why: 'Choose your local government to continue.' })
  assert.deepEqual(homeFoot('', 'Ikeja'), { label: 'Move in to Ikeja', action: 'home', disabled: false, why: '' })
})

test('moving in sends the chosen local government and how it was found - nothing when none was chosen - and "stay" when asked', () => {
  assert.deepEqual(homePayload({ lga: 'ikeja', via: 'device' }, false), { lga: 'ikeja', via: 'device' })
  assert.deepEqual(homePayload({ lga: 'ikeja', via: 'manual' }, true), { lga: 'ikeja', via: 'manual', stay: true })
  assert.deepEqual(homePayload(undefined, false), {})
})

test('a guest who has earned something keeps it: the start cash tops the wallet up', () => {
  assert.equal(keptCash({ guest: false, cash: 5000, seed: 1000, start: 200000 }), '')
  assert.equal(keptCash({ guest: true, cash: 1000, seed: 1000, start: 200000 }), '')
  assert.equal(keptCash({ guest: true, cash: 5000, seed: 1000, start: null }), '')
  assert.equal(keptCash({ guest: true, cash: 5000, seed: 1000, start: 200000 }), ' You keep the ₦5,000 you have now: start cash tops your wallet up to ₦204,000.')
})

test('a third trait swaps out the first; a picked trait is put back by a second tap', () => {
  assert.deepEqual(toggleTrait(['hustler'], 'foodie'), ['hustler', 'foodie'])
  assert.deepEqual(toggleTrait(['hustler', 'foodie'], 'musical'), ['foodie', 'musical'])
  assert.deepEqual(toggleTrait(['hustler', 'foodie'], 'hustler'), ['foodie'])
})

test('a refused step says why: offline in the connection\'s own words, otherwise the server\'s sentence', () => {
  assert.equal(failureText({ code: 'offline' }, false, 'This device has no internet connection.'), 'This device has no internet connection. This step cannot be saved yet. Nothing is lost — try again when you are connected.')
  assert.equal(failureText({ code: 'x' }, false, undefined), 'The game server did not answer. This step cannot be saved yet. Nothing is lost — try again when you are connected.')
  assert.equal(failureText({ code: 'invalid_look', reason: 'That look is not allowed.' }, true, undefined), 'That look is not allowed.')
  assert.equal(failureText({ code: 'x' }, true, undefined), 'That could not be saved. Check your connection and try again.')
})

test('the session form sends the nickname trimmed', () => {
  assert.equal(nicknameOf('  Tobi  '), 'Tobi')
})

test('a refused name is put in the draft once; after that the field follows the draft (Shuffle and the dice are not dead)', async () => {
  const { refusedNameToKeep } = await import('./quickStartModel.ts')
  assert.equal(refusedNameToKeep({ name: 'Ad' }, 'Adaeze'), 'Ad')
  assert.equal(refusedNameToKeep({ name: 'Ad' }, 'Ad'), null, 'already in the draft: nothing to do')
  assert.equal(refusedNameToKeep({}, 'Adaeze'), null)
  assert.equal(refusedNameToKeep(null, 'Adaeze'), null)
})

// Port of src/ui/panels/session.test.js (the first test; the old-character link is in startComponents.test.ts).
test('fresh nickname entry is mandatory only until connection; expired saved previews stay dismissible', () => {
  assert.equal(typeof sessionRequired({ reason: 'new' }, false), 'string')
  assert.equal(sessionRequired({ reason: 'new' }, true), null)
  assert.equal(sessionRequired({ reason: 'expired' }, false), null)
  assert.equal(sessionRequired(undefined, false), null)
})
