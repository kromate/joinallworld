// The admin screens' routes and shortcuts, without a browser.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { VIEWS, hashOf, parseRoute } from './adminUi.ts'

test('a route is read from the hash and written back the same', () => {
  assert.deepEqual(parseRoute(''), { view: 'dashboard', player: null, tab: null })
  assert.deepEqual(parseRoute('#/audit'), { view: 'audit', player: null, tab: null })
  const id = '3f9a1c2e-1111-4222-8333-444455556666'
  assert.deepEqual(parseRoute(`#/players/${id}/money`), { view: 'players', player: id, tab: 'money' })
  assert.equal(hashOf(parseRoute(`#/players/${id}/money`)), `#/players/${id}/money`)
  assert.deepEqual(parseRoute('#/players/not-an-id'), { view: 'players', player: null, tab: null }, 'a made-up id is no player')
  assert.deepEqual(parseRoute('#/nowhere'), { view: 'dashboard', player: null, tab: null })
  assert.deepEqual(parseRoute('#/dashboard/3f9a1c2e-1111-4222-8333-444455556666'), { view: 'dashboard', player: null, tab: null }, 'only players have a page')
})
test('every screen has its own shortcut key', () => {
  const keys = VIEWS.map((view) => view.key)
  assert.equal(new Set(keys).size, keys.length)
  assert.ok(keys.every((key) => /^[a-z]$/.test(key)) && !keys.includes('g'))
})
