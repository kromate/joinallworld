import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_GUESSES, ORO_EPOCH_DAY, WORD_LENGTH, checkHardMode, cleanGuess, dailyIndex, keyboardStates, puzzleNumber, scoreGuess, shareText } from './oro.ts'

test('constants', () => {
  assert.equal(MAX_GUESSES, 6)
  assert.equal(WORD_LENGTH, 5)
})

test('scoring handles repeated letters in two passes', () => {
  const cases: [string, string, string][] = [
    ['crane', 'crane', 'ccccc'],
    ['speed', 'abide', 'aapap'],
    ['llama', 'hello', 'ppaaa'],
    ['hello', 'llama', 'aappa'],
    ['allay', 'alley', 'cccac'],
    ['alley', 'allay', 'cccac'],
    ['eerie', 'there', 'papac'],
    ['geese', 'where', 'aacac'],
    ['mamma', 'ahead', 'apaap'],
    ['aaaaa', 'abaca', 'cacac'],
    ['abcde', 'edcba', 'ppcpp'],
    ['robot', 'floor', 'ppaca'],
  ]
  for (const [guess, answer, expected] of cases) assert.equal(scoreGuess(guess, answer).join(''), expected, `${guess} vs ${answer}`)
})

test('cleanGuess accepts five letters only', () => {
  assert.equal(cleanGuess(' Crane '), 'crane')
  for (const bad of ['cran', 'cranes', 'cr4ne', 'crané', '', 12, null, undefined, {}]) assert.equal(cleanGuess(bad), null)
})

test('hard mode keeps greens in place and uses yellows', () => {
  const guesses = ['crane']
  const marks = [['a', 'c', 'p', 'a', 'a']]
  assert.equal(checkHardMode(guesses, marks, 'trial'), null)
  assert.match(checkHardMode(guesses, marks, 'stair') ?? '', /2nd letter must be R/)
  assert.match(checkHardMode(guesses, marks, 'broom') ?? '', /must contain A/)
  assert.equal(checkHardMode([], [], 'anyth'), null)
})

test('hard mode counts repeated yellow letters', () => {
  const reason = checkHardMode(['geese'], [['a', 'p', 'p', 'a', 'a']], 'sheep')
  assert.equal(reason, null)
  assert.match(checkHardMode(['geese'], [['a', 'p', 'p', 'a', 'a']], 'shine') ?? '', /E 2 times/)
})

test('keyboard keeps the best state per letter', () => {
  const states = keyboardStates(['speed', 'abide'], [['a', 'a', 'p', 'a', 'p'], ['p', 'a', 'a', 'c', 'c']])
  assert.equal(states.e, 'c')
  assert.equal(states.d, 'c')
  assert.equal(states.a, 'p')
  assert.equal(states.s, 'a')
  assert.equal(states.z, undefined)
})

test('share text has squares and no letters or answer', () => {
  const text = shareText(42, [['a', 'p', 'a', 'a', 'a'], ['c', 'c', 'p', 'a', 'a'], ['c', 'c', 'c', 'c', 'c']], 3, false)
  const [title, ...rows] = text.split('\n')
  assert.equal(title, 'Oro #42 3/6')
  assert.deepEqual(rows, ['⬛\u{1F7E8}⬛⬛⬛', '\u{1F7E9}\u{1F7E9}\u{1F7E8}⬛⬛', '\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}'])
  assert.doesNotMatch(rows.join(''), /[a-z]/i)
  assert.equal(shareText(7, [['a', 'a', 'a', 'a', 'a']], null, true).split('\n')[0], 'Oro #7 X/6*')
})

test('puzzle numbers start at one on the epoch day', () => {
  assert.equal(puzzleNumber(ORO_EPOCH_DAY), 1)
  assert.equal(puzzleNumber(ORO_EPOCH_DAY + 41), 42)
})

test('every cycle is a permutation of all answers, and salts differ', () => {
  const count = 97
  for (const cycle of [0, 1, 14]) {
    const seen = new Set<number>()
    for (let i = 0; i < count; i++) seen.add(dailyIndex(cycle * count + i, 'salt-one', count))
    assert.equal(seen.size, count, `cycle ${cycle} uses every answer once`)
    assert.ok([...seen].every(n => n >= 0 && n < count))
  }
  const a = Array.from({ length: count }, (_, i) => dailyIndex(i, 'salt-one', count))
  const b = Array.from({ length: count }, (_, i) => dailyIndex(i, 'salt-two', count))
  const c = Array.from({ length: count }, (_, i) => dailyIndex(count + i, 'salt-one', count))
  assert.notDeepEqual(a, b)
  assert.notDeepEqual(a, c)
  assert.deepEqual(a, Array.from({ length: count }, (_, i) => dailyIndex(i, 'salt-one', count)), 'deterministic')
})

test('the real answer list gives each answer once per cycle', async () => {
  const { ANSWER_COUNT } = await import('./guess.ts')
  const seen = new Set<number>()
  for (let d = ANSWER_COUNT * 14; d < ANSWER_COUNT * 15; d++) seen.add(dailyIndex(d, 'another salt', ANSWER_COUNT))
  assert.equal(seen.size, ANSWER_COUNT)
})
