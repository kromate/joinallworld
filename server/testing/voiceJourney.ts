import assert from 'node:assert/strict'
import { inspectVoiceNote } from '../social/voice-notes.ts'

export interface VoiceActor { id: string; cookie: string }
export interface VoiceAnswer {
  status: number
  ok?: boolean
  code?: string
  error?: string
  reason?: string
  duplicate?: boolean
  conv?: { id: string }
  message?: { id: string; seq: number; version?: number; voice?: { id: string; durationMs: number; state?: string } }
  receipt?: { id: string }
  messages?: VoiceAnswer['message'][]
}
export interface VoiceJourneyHost {
  actor(name: string): Promise<VoiceActor>
  json(path: string, body: unknown | null, who?: VoiceActor): Promise<VoiceAnswer>
  media(path: string, who?: VoiceActor): Promise<{ status: number; bytes: Uint8Array; cache: string | null }>
  hasVoice(id: string): Promise<boolean>
  id(): string
  restart?(): Promise<void>
}

const join = (parts: readonly Uint8Array[]): Uint8Array => {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
  let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  return bytes
}
const vint = (value: number): Uint8Array => {
  for (let width = 1; width <= 8; width++) if (value < 2 ** (7 * width) - 1) {
    const bytes = new Uint8Array(width)
    let rest = value
    for (let index = width - 1; index >= 0; index--) { bytes[index] = rest & 255; rest = Math.floor(rest / 256) }
    bytes[0] = bytes[0]! | 2 ** (8 - width)
    return bytes
  }
  throw new RangeError('EBML element is too large')
}
const element = (id: number, data: Uint8Array): Uint8Array => {
  const hex = id.toString(16).padStart(Math.ceil(id.toString(16).length / 2) * 2, '0')
  const tag = Uint8Array.from(hex.match(/../g)!.map(pair => Number.parseInt(pair, 16)))
  return join([tag, vint(data.length), data])
}
const uint = (id: number, value: number): Uint8Array => {
  let width = 1
  while (value >= 2 ** (8 * width)) width++
  const bytes = new Uint8Array(width)
  for (let index = width - 1; index >= 0; index--) { bytes[index] = value & 255; value = Math.floor(value / 256) }
  return element(id, bytes)
}

/** Ten minimal 20 ms Opus silence packets in a bounded, ordinary WebM/Opus container. */
export function syntheticWebmOpus(seed = 0): Uint8Array {
  const ascii = (value: string): Uint8Array => new TextEncoder().encode(value)
  const opusHead = new Uint8Array(19)
  opusHead.set(ascii('OpusHead'))
  opusHead[8] = 1; opusHead[9] = 1
  new DataView(opusHead.buffer).setUint32(12, 48000, true)
  new DataView(opusHead.buffer).setUint16(16, seed, true)
  const frequency = new Uint8Array(4)
  new DataView(frequency.buffer).setFloat32(0, 48000)
  const audio = element(0xe1, join([uint(0x9f, 1), element(0xb5, frequency)]))
  const track = element(0xae, join([uint(0xd7, 1), uint(0x83, 2), element(0x86, ascii('A_OPUS')), element(0x63a2, opusHead), audio]))
  const tracks = element(0x1654ae6b, track)
  const info = element(0x1549a966, uint(0x2ad7b1, 1_000_000))
  const blocks = Array.from({ length: 10 }, (_, index) => {
    const timestamp = index * 20
    const packet = Uint8Array.of(0xf8, 0xff, 0xfe)
    const body = join([Uint8Array.of(0x81, timestamp >> 8, timestamp & 255, 0x80), packet])
    return element(0xa3, body)
  })
  const cluster = element(0x1f43b675, join([uint(0xe7, 0), ...blocks]))
  const header = element(0x1a45dfa3, element(0x4282, ascii('webm')))
  return join([header, element(0x18538067, join([info, tracks, cluster]))])
}

function voiceId(answer: VoiceAnswer): string {
  const id = answer.message?.voice?.id
  if (typeof id !== 'string') throw new TypeError('The sent message includes no voice reference')
  return id
}

export async function runVoiceJourney(host: VoiceJourneyHost): Promise<void> {
  const ada = await host.actor('Voice Ada'), bola = await host.actor('Voice Bola'), chi = await host.actor('Voice Chi'), dayo = await host.actor('Voice Dayo'), eve = await host.actor('Voice Eve')
  const friend = async (left: VoiceActor, right: VoiceActor): Promise<void> => {
    assert.equal((await host.json('/api/social/friends/request', { to: right.id, cityId: 'lagos' }, left)).code, 'requested')
    assert.equal((await host.json('/api/social/friends/answer', { from: left.id, accept: true, cityId: 'lagos' }, right)).code, 'accepted')
  }
  for (const other of [bola, chi, dayo]) await friend(ada, other)

  const bytes = syntheticWebmOpus(), inspected = inspectVoiceNote(bytes)
  if (!inspected.ok) throw new Error(`Synthetic WebM/Opus fixture was rejected: ${inspected.reason}`)
  const encoded = Buffer.from(bytes).toString('base64'), clientId = host.id()
  const rejected = await host.json('/api/social/voice', { to: bola.id, clientId: host.id(), data: Buffer.from('not webm').toString('base64') }, ada)
  assert.equal(rejected.code, 'voice_rejected', 'unsupported codecs and malformed containers are rejected explicitly')
  const sent = await host.json('/api/social/voice', { to: bola.id, clientId, data: encoded }, ada)
  assert.equal(sent.code, 'sent')
  const directId = voiceId(sent), directConv = sent.conv?.id
  assert.equal(typeof directConv, 'string')

  const unauthenticated = await host.media(`/api/social/voice/${directId}`)
  assert.equal(unauthenticated.status, 401, 'voice bytes require a signed-in device')
  assert.equal((await host.media(`/api/social/voice/${directId}`, eve)).status, 404, 'an outsider cannot discover whether the voice exists')
  const played = await host.media(`/api/social/voice/${directId}`, bola)
  assert.equal(played.status, 200)
  assert.deepEqual(played.bytes, inspected.bytes, 'playback returns the canonical, metadata-free WebM stored by the server')
  assert.equal(played.cache, 'no-store')
  if (host.restart) {
    await host.restart()
    assert.equal((await host.media(`/api/social/voice/${directId}`, bola)).status, 200, 'stored playback survives a Worker host restart')
  }

  const retry = await host.json('/api/social/voice', { to: bola.id, clientId, data: encoded }, ada)
  assert.equal(retry.duplicate, true, 'retry returns the original message without adding another line')
  assert.equal(retry.message?.id, sent.message?.id)
  const conflicting = await host.json('/api/social/voice', { to: bola.id, clientId, data: Buffer.from(syntheticWebmOpus(1)).toString('base64') }, ada)
  assert.equal(conflicting.status, 409, 'reusing the retry key for different audio is rejected')

  assert.equal((await host.json('/api/social/prefs', { voiceNotes: 'nobody' }, bola)).code, 'saved')
  assert.equal((await host.media(`/api/social/voice/${directId}`, bola)).status, 404, 'recipient opt-out revokes reads immediately')
  assert.equal((await host.json('/api/social/prefs', { voiceNotes: 'friends' }, bola)).code, 'saved')
  assert.equal((await host.json('/api/social/block', { id: ada.id, cityId: 'lagos' }, bola)).code, 'blocked')
  assert.equal((await host.media(`/api/social/voice/${directId}`, bola)).status, 404, 'a block revokes reads immediately')
  assert.equal((await host.json('/api/social/unblock', { id: ada.id }, bola)).code, 'unblocked')
  assert.equal((await host.media(`/api/social/voice/${directId}`, bola)).status, 200)

  const group = await host.json('/api/social/groups', { name: 'Voice Check', members: [bola.id, chi.id, dayo.id], clientId: host.id() }, ada)
  assert.equal(group.code, 'created')
  const groupId = group.conv?.id
  assert.equal(typeof groupId, 'string')
  const groupSend = await host.json('/api/social/voice', { conv: groupId, clientId: host.id(), data: encoded }, ada)
  assert.equal(groupSend.code, 'sent')
  const groupVoiceId = voiceId(groupSend)
  assert.equal((await host.json(`/api/social/groups/${groupId}`, { op: 'remove', id: bola.id }, ada)).code, 'updated')
  assert.equal((await host.media(`/api/social/voice/${groupVoiceId}`, bola)).status, 404, 'removing a group member revokes access')
  assert.equal((await host.media(`/api/social/voice/${groupVoiceId}`, chi)).status, 200)

  assert.equal((await host.json('/api/social/reports', { conv: groupId, voice: groupVoiceId, reason: 'other' }, chi)).code, 'reported')
  const chiHistory = await host.json(`/api/social/conversations/${groupId}`, null, chi)
  assert.equal(chiHistory.messages?.find(message => message?.voice?.id === groupVoiceId)?.voice?.state, 'reported')
  assert.equal((await host.media(`/api/social/voice/${groupVoiceId}`, dayo)).status, 200, 'one report hides the voice only for its reporter')
  assert.equal((await host.json('/api/social/reports', { conv: groupId, voice: groupVoiceId, reason: 'other' }, dayo)).code, 'reported')
  const ownerHistory = await host.json(`/api/social/conversations/${groupId}`, null, ada)
  assert.equal(ownerHistory.messages?.find(message => message?.voice?.id === groupVoiceId)?.voice?.state, 'hidden')
  assert.equal((await host.media(`/api/social/voice/${groupVoiceId}`, ada)).status, 404, 'two distinct reports hide the recording for everyone')

  const deleted = await host.json(`/api/social/conversations/${directConv}/message`, { op: 'delete', seq: sent.message?.seq, version: 0, clientId: host.id() }, ada)
  assert.equal(deleted.code, 'updated')
  assert.equal((await host.media(`/api/social/voice/${directId}`, bola)).status, 404, 'deleting the message revokes playback')
  for (let attempt = 0; attempt < 40 && await host.hasVoice(directId); attempt++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(await host.hasVoice(directId), false, 'deleting the message removes its stored bytes')
}
