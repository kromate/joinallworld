import assert from 'node:assert/strict'
import test from 'node:test'
import { copyText, fitText, legacyCopy } from './share.ts'

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

/** A canvas stand-in: every character is half the font size wide. */
function fakeContext() {
  const ctx = { font: '', measureText(text: string) { const size = Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 10); return { width: text.length * size * 0.5 } } }
  return ctx as unknown as Pick<CanvasRenderingContext2D, 'font' | 'measureText'>
}
const headFont = (px: number): string => `800 ${px}px sans`
test('share card: a long headline wraps to two lines and shrinks before a word is cut off', () => {
  const box = 840
  for (const place of ['Surulere', 'Ado Odo/Ota', 'Obafemi/Owode', 'Ijebu-Ode Centre, Ijebu-Ode']) {
    const ctx = fakeContext()
    const fit = fitText(ctx, `I live in ${place} now`, box, 2, [84, 76, 68, 60, 52, 46], headFont)
    assert.ok(fit.lines.length <= 2, place)
    ctx.font = headFont(fit.size)
    for (const line of fit.lines) assert.ok(ctx.measureText(line).width <= box, `${place}: ${line}`)
    assert.equal(fit.lines.join(' '), `I live in ${place} now`, `${place} is whole`)
  }
  const short = fitText(fakeContext(), 'Come to my house', box, 2, [84, 76], headFont)
  assert.equal(short.size, 84)
})
test('share card: only a name too long for any size is shortened, with an ellipsis, inside the box', () => {
  const ctx = fakeContext()
  const fit = fitText(ctx, `I live in ${'Abcdefghij'.repeat(8)} now`, 840, 2, [84, 46], headFont)
  assert.equal(fit.lines.length, 2)
  ctx.font = headFont(fit.size)
  assert.ok(fit.lines.every((line) => ctx.measureText(line).width <= 840))
  assert.ok(fit.lines[1]!.endsWith('…'))
})
