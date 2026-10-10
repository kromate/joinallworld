// The project's licence is the GNU AGPL (version 3 or later), and everything that states it says the same thing. Allworld is a service people
// reach over a network, so section 13 matters: the game offers its source to the people who use it.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('LICENSE is the GNU Affero General Public License, version 3, in full', () => {
  const text = read('LICENSE')
  assert.match(text, /^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3, 19 November 2007/)
  assert.ok(text.includes('13. Remote Network Interaction'), 'section 13 is the reason for choosing it')
  assert.ok(text.includes('END OF TERMS AND CONDITIONS'))
  assert.ok(text.length > 30000, 'the whole text, not a summary')
  assert.ok(!/\bMIT License\b/.test(text))
})

test('package.json, README, NOTICE and CONTRIBUTING all say AGPL, and none still calls the project MIT', () => {
  for (const path of ['package.json', 'deploy/tooling/package.json']) assert.equal((JSON.parse(read(path)) as { license: string }).license, 'AGPL-3.0-or-later', path)
  assert.match(read('README.md'), /## Licence\s+GNU Affero General Public License, version 3 or \(at your option\) any later version/)
  assert.match(read('NOTICE.md'), /Allworld's own code is released under the GNU Affero General Public License/)
  assert.match(read('CONTRIBUTING.md'), /licensed under the \[GNU Affero General Public License, version 3 or later\]\(LICENSE\)/)
  for (const path of ['README.md', 'NOTICE.md', 'CONTRIBUTING.md']) assert.ok(!/released under the MIT licence \(see|licensed under the \[MIT License\]|right to license under MIT/.test(read(path)), `${path} no longer calls the project MIT`)
})

test('the game offers its source to the people who use it, as section 13 asks', () => {
  const settings = read('src/app/features/sim/SettingsTab.vue')
  assert.match(settings, /href="https:\/\/github\.com\/kromate\/joinallworld"/)
  assert.ok(settings.includes('free software under the GNU AGPL'))
})

test('the map data is credited in the map corner and under About, with the source of the city data', () => {
  const settings = read('src/app/features/sim/SettingsTab.vue')
  assert.match(settings, /href="https:\/\/www\.openstreetmap\.org\/copyright"[^>]*>[\s\S]*?<b>Map data<\/b><small>© OpenStreetMap contributors<\/small>/)
  assert.match(settings, /href="https:\/\/github\.com\/kromate\/joinallworld\/tree\/[0-9a-f]+\/src\/game\/cities"[^>]*>[\s\S]*?<b>Source data<\/b>/)
  const corner = read('src/map3d/index.ts')
  assert.match(corner, /credit\.className = 'map-credit'/)
  assert.match(corner, /credit\.href = 'https:\/\/www\.openstreetmap\.org\/copyright'/)
  assert.match(corner, /credit\.rel = 'noopener noreferrer'/)
  assert.match(read('src/city-map.css'), /\.map-credit\{position:absolute;z-index:7;left:var\(--map-left,10px\)/)
})
