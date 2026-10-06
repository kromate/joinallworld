import test from 'node:test'
import assert from 'node:assert/strict'
import { PICTURE, fitWithin, pictureUrl, refusalFor, toBase64, uploadBody } from './pictureModel.ts'

test('only photos are taken: animated, vector, video and unknown types are refused with a plain sentence', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', '']) assert.equal(refusalFor(type), null, type)
  assert.match(String(refusalFor('image/gif')), /Animated/)
  for (const type of ['image/svg+xml', 'video/mp4', 'application/pdf', 'text/html']) assert.match(String(refusalFor(type)), /Only photos/)
})
test('a picture is drawn with its long edge at most 1280, in the same shape, never larger', () => {
  assert.deepEqual(fitWithin(4000, 3000), { width: 1280, height: 960 })
  assert.deepEqual(fitWithin(3000, 4000), { width: 960, height: 1280 })
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 })
  assert.deepEqual(fitWithin(5000, 1), { width: 1280, height: 1 })
  assert.deepEqual(fitWithin(4000, 3000, 640), { width: 640, height: 480 })
  assert.ok(PICTURE.target < PICTURE.cap && PICTURE.cap === 250000 && PICTURE.target === 180000)
})
test('the upload is JSON with base64 bytes, the caption and the reply only when there are some', async () => {
  const blob = new Blob([Uint8Array.of(0xff, 0xd8, 0xff, 1, 2, 3)], { type: 'image/jpeg' })
  assert.equal(await toBase64(blob), '/9j/AQID')
  const body = JSON.parse(await uploadBody({ target: { conv: 'g.1' }, clientId: 'c-1234567', ready: { blob, type: 'image/jpeg', width: 1, height: 1, url: 'blob:x' }, caption: '' })) as Record<string, unknown>
  assert.deepEqual(body, { conv: 'g.1', clientId: 'c-1234567', type: 'image/jpeg', data: '/9j/AQID' })
  const more = JSON.parse(await uploadBody({ target: { to: 'p' }, clientId: 'c-1234567', ready: { blob, type: 'image/jpeg', width: 1, height: 1, url: 'blob:x' }, caption: 'The view', replyTo: 4 })) as Record<string, unknown>
  assert.deepEqual([more['body'], more['replyTo'], more['to']], ['The view', 4, 'p'])
  assert.equal(pictureUrl('a b'), '/api/social/images/a%20b')
})
