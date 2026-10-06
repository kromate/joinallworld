import { test } from 'node:test'
import assert from 'node:assert/strict'
import allowed5 from './data/allowed5.ts'
import answersPacked from './data/answers.ts'
import dictionary from './data/dictionary.ts'
import letters from './data/letters.ts'
import { ANSWER_COUNT, MAX_WORD, MIN_WORD, answerAt, answerCount, isGuess5, isWord } from './dict.ts'
import { BLOCKED_WORDS } from '../../scripts/words/blocklist.ts'
import { blockedCategory } from '../../server/moderation/text.ts'

const chunks = (packed: string, width: number): string[] => {
  const out: string[] = []
  for (let i = 0; i < packed.length; i += width) out.push(packed.slice(i, i + width))
  return out
}
const allAnswers = Array.from({ length: ANSWER_COUNT }, (_, i) => answerAt(i))

test('answers are lower-case five-letter guesses, unique, in a sensible number', () => {
  assert.equal(answerCount(), ANSWER_COUNT)
  assert.equal(answersPacked.length, ANSWER_COUNT * 5)
  assert.ok(ANSWER_COUNT >= 1000 && ANSWER_COUNT <= 1600, `answers: ${ANSWER_COUNT}`)
  assert.equal(new Set(allAnswers).size, ANSWER_COUNT)
  for (const word of allAnswers) {
    assert.match(word, /^[a-z]{5}$/)
    assert.ok(isGuess5(word), `${word} must be an accepted guess`)
    assert.ok(isWord(word))
  }
})

test('answerAt wraps', () => {
  assert.equal(answerAt(ANSWER_COUNT), answerAt(0))
  assert.equal(answerAt(-1), answerAt(ANSWER_COUNT - 1))
})

test('guess list is sorted fixed width', () => {
  assert.equal(allowed5.length % 5, 0)
  const words = chunks(allowed5, 5)
  assert.ok(words.length > 8000)
  assert.deepEqual(words, [...words].sort())
  assert.ok(words.every(w => /^[a-z]{5}$/.test(w)))
})

test('every length is sorted, fixed width and unique', () => {
  for (let n = MIN_WORD; n <= MAX_WORD; n++) {
    const packed = dictionary[n]
    assert.ok(packed && packed.length > 0, `length ${n} present`)
    assert.equal(packed.length % n, 0, `length ${n} fixed width`)
    const words = chunks(packed, n)
    for (let i = 1; i < words.length; i++) assert.ok((words[i - 1] ?? '') < (words[i] ?? ''), `length ${n} sorted at ${i}`)
    assert.ok(words.every(w => /^[a-z]+$/.test(w)))
  }
  assert.equal(dictionary[5], allowed5)
})

test('no listed word is blocked', () => {
  const blocked = new Set(BLOCKED_WORDS)
  for (const word of chunks(allowed5, 5)) {
    assert.ok(!blocked.has(word), 'blocklisted word in guesses')
    assert.equal(blockedCategory(word), null, 'chat-filter word in guesses')
  }
  for (const word of allAnswers) assert.ok(!blocked.has(word) && blockedCategory(word) === null)
  for (let n = MIN_WORD; n <= MAX_WORD; n++) {
    for (const word of chunks(dictionary[n] ?? '', n)) assert.ok(!blocked.has(word), 'blocklisted word in dictionary')
  }
})

test('common words are accepted and nonsense is not', () => {
  for (const word of ['table', 'house', 'water', 'crane', 'apple', 'happy']) assert.ok(isGuess5(word), word)
  for (const word of ['qzxvj', 'aaaaa', 'house1', 'HOUSE', 'hous', '']) assert.ok(!isGuess5(word), word)
  assert.ok(!isWord('qzxvj') && !isWord('') && !isWord('a') && !isWord('x'.repeat(16)))
})

test('isWord covers lengths and regular inflections', () => {
  for (const word of ['at', 'cat', 'cats', 'walk', 'walked', 'walking', 'running', 'houses', 'happier', 'quickly', 'beautiful', 'understanding', 'carefulness'])
    assert.ok(isWord(word), word)
  for (const word of ['catss', 'walkeding', 'zzzzz'])
    assert.ok(!isWord(word), word)
})

test('letter counts cover the alphabet', () => {
  assert.equal(Object.keys(letters).length, 26)
  assert.ok((letters.e ?? 0) > (letters.q ?? 0) * 20)
})
