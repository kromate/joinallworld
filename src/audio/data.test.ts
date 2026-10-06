// The sound map is complete: every event has a recipe, every recipe is used, every name the game plays exists, and no audio file
// is imported anywhere (the release ships only html, js, css, svg and images; every sound is synthesised).
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { ACTIVITIES, COMMANDS, EVENTS, MOTIFS, PLACES, RECIPES, RIDES, SCAPES, STEPS, SURFACES } from './data.ts'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
function files(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, found); else found.push(path)
  }
  return found
}
const sources = files(join(root, 'src')).filter(path => /\.(ts|vue|css|html)$/.test(path))
const read = (path: string): string => readFileSync(path, 'utf8')
const code = sources.filter(path => /\.(ts|vue)$/.test(path) && !/\.test\./.test(path) && !path.endsWith('data.ts')).map(path => [path, read(path)] as const)

const shotIds = Object.values(SCAPES).flatMap(spec => (spec.shots ?? []).map(shot => shot[0]))
const eventNames = new Set<string>(Object.keys(EVENTS))

test('every event in the sound map has a recipe, and every recipe is used by something', () => {
  for (const [event, id] of Object.entries(EVENTS)) assert.ok(RECIPES[id], `event ${event} -> missing recipe ${id}`)
  for (const [surface, id] of Object.entries(STEPS)) assert.ok(RECIPES[id], `surface ${surface} -> ${id}`)
  for (const [motif, id] of Object.entries(MOTIFS)) assert.ok(RECIPES[id], `motif ${motif} -> ${id}`)
  for (const id of shotIds) assert.ok(RECIPES[id], `a scape plays missing recipe ${id}`)
  const used = new Set<string>([...Object.values(EVENTS), ...Object.values(STEPS), ...Object.values(MOTIFS), ...shotIds])
  assert.deepEqual(Object.keys(RECIPES).filter(id => !used.has(id)), [], 'recipes nothing plays')
})

test('every event name the game uses exists, and every event is raised by something', () => {
  const literal = /\bplay(?:Sound)?\(\s*(['"`])([^'"`$]+)\1/g
  const raised = new Set<string>()
  // The guide's own play() calls name poses of its figure ('wave', 'point'), not sounds.
  for (const [path, text] of code) if (!path.includes('/features/companion/')) for (const match of text.matchAll(literal)) {
    const name = match[2] as string
    raised.add(name)
    if (!name.startsWith('cmd:')) assert.ok(eventNames.has(name), `${relative(root, path)} plays unknown event "${name}"`)
  }
  // Events the tables raise: ride and activity cues, accepted commands, and the plain ones the director and the toast hook name.
  for (const ride of Object.values(RIDES)) for (const name of [ride.start, ride.end]) if (name) raised.add(name)
  for (const rule of ACTIVITIES) for (const name of [rule.start, rule.end]) if (name) raised.add(name)
  for (const name of Object.values(COMMANDS)) raised.add(name)
  const everything = code.map(([, text]) => text).join('\n')
  for (const name of eventNames) assert.ok(raised.has(name) || new RegExp(`['"\`]${name}['"\`]`).test(everything), `event "${name}" is never raised`)
})

test('the tables point at things that exist', () => {
  for (const [kind, scape] of Object.entries(PLACES)) assert.ok(SCAPES[scape], `place ${kind} -> ${scape}`)
  for (const [kind, surface] of Object.entries(SURFACES)) assert.ok(STEPS[surface], `${kind} surface ${surface}`)
  for (const [mode, ride] of Object.entries(RIDES)) { assert.ok(SCAPES[ride.scape], mode); for (const name of [ride.start, ride.end]) if (name) assert.ok(eventNames.has(name), `${mode} ${name}`) }
  for (const rule of ACTIVITIES) { assert.ok(SCAPES[rule.scape], rule.scape); if (rule.kitchen) assert.ok(SCAPES[rule.kitchen]); for (const name of [rule.start, rule.end]) if (name) assert.ok(eventNames.has(name), name) }
  for (const [type, event] of Object.entries(COMMANDS)) assert.ok(eventNames.has(event), `${type} -> ${event}`)
  for (const name of ['city', 'harmattan', 'harbour', 'calm']) assert.ok(SCAPES[name], name)
})

test('a city names a motif and an ambience that exist, and every open city has one', () => {
  const dir = join(root, 'src/game/cities')
  const found = new Map<string, string>()
  for (const path of files(dir).filter(p => /\/(content|contentBuilder)\.ts$/.test(p))) {
    for (const match of read(path).matchAll(/sound:\s*\{\s*motif:\s*'([^']+)'(?:,\s*ambience:\s*'([^']+)')?(?:,\s*key:\s*(-?\d+))?/g)) {
      assert.ok(MOTIFS[match[1] as string], `${relative(root, path)}: motif ${match[1]}`)
      if (match[2]) assert.ok(SCAPES[match[2]], `${relative(root, path)}: ambience ${match[2]}`)
      found.set(relative(dir, path).split('/')[0] as string, match[1] as string)
    }
  }
  for (const city of ['lagos', 'ibadan', 'ogun', 'port-harcourt', 'abuja', 'kano']) assert.ok(found.has(city), `${city} has sound data`)
  assert.equal(found.get('kano'), 'plucked-string'); assert.equal(found.get('port-harcourt'), 'highlife'); assert.equal(found.get('abuja'), 'mallet'); assert.equal(found.get('lagos'), 'talking-drum')
})

test('no audio file is imported, linked or shipped: every sound is synthesised', () => {
  const extension = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|weba|mid|midi|aif|aiff)(?=['"`)?#\s]|$)/i
  for (const path of sources) {
    for (const line of read(path).split('\n')) if (/\b(import|from|url\(|fetch\(|new Audio\(|new URL\(|src=|href=)/.test(line)) assert.ok(!extension.test(line), `${relative(root, path)} refers to an audio file: ${line.trim().slice(0, 100)}`)
  }
  for (const dir of [join(root, 'src'), join(root, 'public')]) if (existsSync(dir)) for (const path of files(dir)) assert.ok(!extension.test(path), `${relative(root, path)} is an audio file`)
})
