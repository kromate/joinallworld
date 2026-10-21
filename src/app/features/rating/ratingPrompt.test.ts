import assert from 'node:assert/strict'
import test from 'node:test'
import { PLAY_RATING_KEY, PLAY_RATING_URL, markRatingAsked, ratingAsked, ratingDue, ratingMomentFromTrack } from './ratingPromptModel.ts'

test('the public Play switch, app mode and once-only marker are all required', () => {
  for (const moment of ['finished-game', 'new-friend'] as const) {
    assert.equal(ratingDue({ enabled: true, playApp: true, asked: false, moment }), true)
    assert.equal(ratingDue({ enabled: false, playApp: true, asked: false, moment }), false)
    assert.equal(ratingDue({ enabled: true, playApp: false, asked: false, moment }), false)
    assert.equal(ratingDue({ enabled: true, playApp: true, asked: true, moment }), false)
  }
  assert.equal(PLAY_RATING_URL, 'https://play.google.com/store/apps/details?id=com.joinallworld.app')
})

test('showing the prompt is remembered once and storage refusal is harmless', () => {
  let value: string | null = null
  const store = { getItem: (key: string) => key === PLAY_RATING_KEY ? value : null, setItem: (key: string, next: string) => { if (key === PLAY_RATING_KEY) value = next } }
  assert.equal(ratingAsked(store), false)
  markRatingAsked(store)
  assert.equal(ratingAsked(store), true)
  const refused = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.equal(ratingAsked(refused), false)
  assert.doesNotThrow(() => markRatingAsked(refused))
})

test('only a win or draw is a completed-game rating moment', () => {
  assert.equal(ratingMomentFromTrack({ name: 'match_finished', props: { result: 'won' } }), 'finished-game')
  assert.equal(ratingMomentFromTrack({ name: 'match_finished', props: { result: 'draw' } }), 'finished-game')
  assert.equal(ratingMomentFromTrack({ name: 'match_finished', props: { result: 'lost' } }), null)
  assert.equal(ratingMomentFromTrack({ name: 'match_finished', props: { result: 'called_off' } }), null)
  assert.equal(ratingMomentFromTrack({ name: 'other', props: { result: 'won' } }), null)
})
