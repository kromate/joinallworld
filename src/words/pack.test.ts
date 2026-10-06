import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { PREFIX_BASE, unpackFrontCoded } from './pack.ts'
import { isReady, isWord, packedOf, ready } from './dict.ts'

test('front-coded bytes unpack to one fixed-width string per length', () => {
  const code = (shared: number): string => String.fromCharCode(PREFIX_BASE + shared)
  const bytes = new TextEncoder().encode(`${code(0)}ab${code(1)}c${code(0)}ba${code(0)}xyz${code(2)}q`)
  assert.deepEqual(unpackFrontCoded(bytes, 2, [3, 2]), { 2: 'abacba', 3: 'xyzxyq' })
})

test('damaged packed data is refused', () => {
  const code = (shared: number): string => String.fromCharCode(PREFIX_BASE + shared)
  const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
  assert.throws(() => unpackFrontCoded(encode(`${code(1)}b`), 2, [1]), /damaged/)
  assert.throws(() => unpackFrontCoded(encode(`${code(0)}a`), 2, [1]), /damaged/)
  assert.throws(() => unpackFrontCoded(encode(`${code(0)}abc`), 2, [1]), /damaged/)
  assert.throws(() => unpackFrontCoded(encode(`${code(2)}`), 2, [1]), /damaged/)
})

test('the list is not unpacked until ready() is awaited, and then it answers', async () => {
  if (!isReady()) {
    assert.throws(() => isWord('hello'), /not ready/)
    assert.throws(() => packedOf(5), /not ready/)
  }
  await Promise.all([ready(), ready()])
  assert.ok(isReady())
  assert.ok(isWord('hello') && !isWord('zzzzq'))
})

test('the committed word data matches its generator', () => {
  const run = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/words/build-lists.ts', '--check'], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr || run.stdout)
})
