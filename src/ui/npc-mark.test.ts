// The one NPC mark: the shared word and spoken text, and the 3D scene tags that use them.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { addNpcWord, NPC_MEANING, NPC_SPEECH, NPC_WORD, NPC_WORD_CLASS, npcAria, npcTitle } from './npc-mark.ts'

test('the word is NPC, the spoken form says what it means, and a name is built into both the same way everywhere', () => {
  assert.equal(NPC_WORD, 'NPC')
  assert.equal(NPC_SPEECH, `NPC, ${NPC_MEANING}`)
  assert.equal(npcAria('Tunde'), 'Tunde, NPC, a game character, not a real player')
  assert.equal(npcTitle('Tunde'), 'Tunde · NPC')
})

test('a scene tag gets the word as a hidden-from-readers span and a class, and nothing else', () => {
  const made: { className: string; attrs: Record<string, string>; textContent: string }[] = []
  const doc = { createElement: () => { const el = { className: '', attrs: {} as Record<string, string>, textContent: '', setAttribute(name: string, value: string) { el.attrs[name] = value } }; made.push(el); return el as unknown as HTMLElement } }
  const added: unknown[] = []; const classes: string[] = []
  addNpcWord(doc, { appendChild: ((node: unknown) => { added.push(node); return node }) as HTMLElement['appendChild'], classList: { add: (name: string) => { classes.push(name) } } as unknown as DOMTokenList })
  assert.equal(made.length, 1)
  assert.equal(made[0]?.textContent, 'NPC')
  assert.equal(made[0]?.className, NPC_WORD_CLASS)
  assert.equal(made[0]?.attrs['aria-hidden'], 'true', 'the tag\'s own aria-label already says it')
  assert.deepEqual(classes, ['has-npc-word'])
  assert.equal(added.length, 1)
})

test('the venue, home and campus tags say NPC (never "a local") in their label, tooltip and on the tag itself', async () => {
  const venue = await readFile(new URL('../venue-world.ts', import.meta.url), 'utf8')
  const campus = await readFile(new URL('../campus/unilag/host.ts', import.meta.url), 'utf8')
  for (const [name, source] of [['venue-world', venue], ['campus host', campus]] as const) {
    assert.match(source, /npcAria\(/, `${name} names an NPC tag with the shared spoken form`)
    assert.match(source, /npcTitle\(/, `${name} titles an NPC tag with the shared tooltip`)
    assert.doesNotMatch(source, /a local`|a campus local/, `${name} no longer calls an NPC "a local"`)
    assert.doesNotMatch(source, /npcWordsEnabled/, `${name} has no switch for the word`)
  }
  assert.match(venue, /if \(tag\.kind === 'npc'\) addNpcWord\(/, 'the word is added to NPC tags, and only to them')
  assert.match(campus, /node\.dataset\.npcWord = NPC_WORD/)
  const css = await readFile(new URL('../campus/unilag/host.css', import.meta.url), 'utf8')
  assert.match(css, /\.campus-host-tag\[data-npc-word\]::before\{content:attr\(data-npc-word\)/)
})

test('the engine\'s speech toast marks an NPC\'s line, so a quote cannot read as a player\'s', async () => {
  const social = await readFile(new URL('../game/systems/social.ts', import.meta.url), 'utf8')
  // The engine carries the word as a literal (the first download must not take the badge module with it); this keeps the two the same.
  assert.ok(social.includes(`(${NPC_WORD}): `))
  assert.doesNotMatch(social, /npc-mark/)
})
