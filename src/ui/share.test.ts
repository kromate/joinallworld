import assert from 'node:assert/strict'
import test from 'node:test'
import { copyText, legacyCopy } from './share.ts'

function fakeDocument(copies: boolean) {
  const log: string[] = []
  const field = { value: '', style: {} as Record<string, string>, tabIndex: 0, setAttribute() {}, select() { log.push(`select:${field.value}`) }, setSelectionRange() {}, remove() { log.push('removed') } }
  const doc = { body: { append() { log.push('appended') } }, createElement: () => field, execCommand: (name: string) => { log.push(name); return copies } }
  return { doc: doc as unknown as Pick<Document, 'createElement' | 'body' | 'execCommand'>, log }
}

test('copy: the clipboard API first', async () => {
  const written: string[] = []
  assert.equal(await copyText('https://x.test/s/abc', { clipboard: { writeText: async (text) => { written.push(text) } } }), true)
  assert.deepEqual(written, ['https://x.test/s/abc'])
})
test('copy: when the browser refuses the clipboard API the hidden-field copy is tried, and its field is always removed', async () => {
  const refuse = { clipboard: { writeText: async () => { throw new DOMException('denied', 'NotAllowedError') } } }
  const ok = fakeDocument(true)
  assert.equal(await copyText('hello', refuse, ok.doc), true)
  assert.deepEqual(ok.log, ['appended', 'select:hello', 'copy', 'removed'])
  const no = fakeDocument(false)
  assert.equal(await copyText('hello', refuse, no.doc), false, 'both ways refused: false, so the screen says so')
  assert.equal(no.log.at(-1), 'removed')
  assert.equal(await copyText('hello', {}, ok.doc), true, 'no clipboard API at all')
  assert.equal(legacyCopy('x', undefined), false)
})
