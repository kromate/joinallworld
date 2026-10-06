// Builds src/words/data/* from the system word list. Run:
//   node --experimental-strip-types scripts/words/build-lists.ts
// Rules and origin are written up in docs/WORDS.md. Output is deterministic.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { blockedCategory } from '../../server/moderation/text.ts'
import { AVOID_AS_ANSWER, BLOCKED_PREFIXES, BLOCKED_WORDS, MILD_WORDS } from './blocklist.ts'
import { derive } from './inflect.ts'
import { ANSWER_WORDS, EXTRA_WORDS } from './answer-edits.ts'

const SOURCE = '/usr/share/dict/words'
const OUT = new URL('../../src/words/data/', import.meta.url)
const MIN = 2
const MAX = 13
const ANSWER_TARGET = 1500
const log = (...parts: unknown[]): void => console.log(...parts)

const COMMON_TWO = new Set(('ad ah am an as at ax be by do eh go ha he hi if in is it lo ma me my no of oh on or ow ox pa pi so to up us we ye yo').split(' '))

const blocked = new Set(BLOCKED_WORDS)
const mild = new Set(MILD_WORDS)
const avoid = new Set(AVOID_AS_ANSWER)
const isBlockedWord = (w: string): boolean =>
  blocked.has(w) || BLOCKED_PREFIXES.some(p => w.startsWith(p)) || blockedCategory(w) !== null

const raw = readFileSync(SOURCE, 'utf8').split('\n').filter(Boolean)
const stages: Record<string, number[]> = {}
const count = (stage: string, words: Iterable<string>): void => {
  const per = Array(MAX + 1).fill(0) as number[]
  let total = 0
  for (const w of words) { if (w.length <= MAX) per[w.length] = (per[w.length] ?? 0) + 1; total++ }
  stages[stage] = per
  log(`${stage.padEnd(34)} all=${String(total).padStart(7)}  5-letter=${per[5]}`)
}

count('source entries', raw)
const lower = new Set(raw.filter(w => /^[a-z]+$/.test(w)))
count('lower-case a-z only', lower)
const sized = new Set([...lower].filter(w => w.length >= MIN && w.length <= MAX))
count('length 2..13', sized)
const shaped = new Set([...sized].filter(w => /[aeiouy]/.test(w) && !/(.)\1\1/.test(w) && (w.length !== 2 || COMMON_TWO.has(w))))
count('has a vowel, no triple, short list', shaped)
// A base is blocked if it, or the stem it extends, is blocked (derived forms inherit this below).
const clean = new Set([...shaped].filter(w => !isBlockedWord(w)))
count('after blocklist and chat filter', clean)

// Regular inflections of source words.
const derived = new Set<string>()
for (const base of clean) {
  for (const form of derive(base, shaped)) {
    if (form.length < MIN || form.length > MAX || clean.has(form)) continue
    if (isBlockedWord(form) || !/^[a-z]+$/.test(form) || /(.)\1\1/.test(form)) continue
    derived.add(form)
  }
}
count('derived inflections added', derived)
const extras = EXTRA_WORDS.filter(w => /^[a-z]{2,13}$/.test(w) && !isBlockedWord(w) && !clean.has(w) && !derived.has(w))
count('hand-added everyday words', extras)
const all = new Set([...clean, ...derived, ...extras])
count('final dictionary', all)

// Long words (11 to 13 letters) are kept only when they belong to a family: another word shares
// all but the last few letters. This drops one-off technical and chemical terms.
const sortedAll = [...all].sort()
const commonPrefix = (a: string, b: string): number => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i }
const longSingles = new Set<string>()
sortedAll.forEach((w, i) => {
  if (w.length < 11) return
  const need = w.length - 4
  const near = (other: string | undefined): boolean => other !== undefined && commonPrefix(w, other) >= need
  if (!near(sortedAll[i - 1]) && !near(sortedAll[i + 1])) longSingles.add(w)
})
for (const w of longSingles) all.delete(w)
count('long one-off words dropped (kept)', all)

const byLength = new Map<number, string[]>()
for (const w of all) { const list = byLength.get(w.length) ?? []; list.push(w); byLength.set(w.length, list) }
for (const list of byLength.values()) list.sort()

// ---- answers ------------------------------------------------------------------------------------
const hash = (text: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12
  return h >>> 0
}
const five = byLength.get(5) ?? []
const fiveSet = new Set(five)
const dropped: string[] = []
const kept = ANSWER_WORDS.filter(w => {
  const ok = /^[a-z]{5}$/.test(w) && fiveSet.has(w) && !avoid.has(w) && !mild.has(w) && !isBlockedWord(w)
  if (!ok) dropped.push(w)
  return ok
})
const answers = kept.sort((a, b) => hash(`o:${a}`) - hash(`o:${b}`) || (a < b ? -1 : 1))
log(`hand-written answers=${ANSWER_WORDS.length} kept=${answers.length} dropped=${dropped.length}`)
if (process.env.PRINT_DROPPED) log(dropped.join(' '))
if (process.env.PRINT_ANSWERS) log([...answers].sort().join(' '))

// ---- letters ------------------------------------------------------------------------------------
const letters: Record<string, number> = {}
for (const w of [...all].filter(w => w.length <= 8).concat(answers)) for (const c of w) letters[c] = (letters[c] ?? 0) + 1
const letterObject = Object.fromEntries(Object.entries(letters).sort(([a], [b]) => (a < b ? -1 : 1)))

// ---- write --------------------------------------------------------------------------------------
const HEADER = '// Generated by scripts/words/build-lists.ts from the public-domain Webster\'s Second International\n// word list (see docs/WORDS.md). Do not edit by hand.\n'
const emit = (file: string, body: string): void => writeFileSync(new URL(file, OUT), HEADER + body)
emit('allowed5.ts', `// Every accepted five-letter guess, sorted, concatenated with no separator (5 characters each).\nexport default '${five.join('')}'\n`)
emit('answers.ts', `// Daily answers, in a fixed shuffled order, concatenated with no separator (5 characters each).\nexport default '${answers.join('')}'\n`)
const dictLines = [...byLength.keys()].sort((a, b) => a - b)
  .map(n => `  ${n}: '${(byLength.get(n) ?? []).join('')}',`).join('\n')
emit('dictionary.ts', `// Accepted words per length 2..13, each sorted and concatenated with no separator.\nconst dictionary: Readonly<Record<number, string>> = {\n${dictLines}\n}\nexport default dictionary\n`)
emit('letters.ts', `// Letter counts over the dictionary words of length 2..8 plus the answers.\nconst letters: Readonly<Record<string, number>> = ${JSON.stringify(letterObject)}\nexport default letters\n`)
log('stage table written:', Object.keys(stages).join(' | '))
if (!existsSync(new URL('allowed5.ts', OUT))) throw new Error('write failed')
