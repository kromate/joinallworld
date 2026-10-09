import { VOICE_NOTE_LIMITS } from '../../src/types/voice-note.ts'
import type { VoiceNoteFormat } from '../../src/types/voice-note.ts'

type Element = { id: number; start: number; end: number; next: number; unknown: boolean }
export type VoiceInspection = { ok: true; format: VoiceNoteFormat; durationMs: number; bytes: Uint8Array } | { ok: false; reason: 'size' | 'format' | 'duration' }
const invalid = (): never => { throw new Error('invalid voice recording') }
const join = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) { out.set(part, at); at += part.length }
  return out
}
function encoded(id: number, data: Uint8Array): Uint8Array {
  const hex = id.toString(16).padStart(Math.ceil(id.toString(16).length / 2) * 2, '0')
  const tag = Uint8Array.from(hex.match(/../g)!.map(pair => parseInt(pair, 16)))
  let width = 1
  while (data.length >= 2 ** (7 * width) - 1) width++
  const size = new Uint8Array(width)
  let value = data.length
  for (let i = width - 1; i >= 0; i--) { size[i] = value % 256; value = Math.floor(value / 256) }
  size[0] = size[0]! | 2 ** (8 - width)
  return join([tag, size, data])
}

/** A bounded WebM reader for MediaRecorder's single Opus audio track. No codec decoding on the Worker. */
export function inspectVoiceNote(bytes: Uint8Array): VoiceInspection {
  if (bytes.length < 64 || bytes.length > VOICE_NOTE_LIMITS.bytes) return { ok: false, reason: 'size' }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let elements = 0
  function vint(at: number, end: number, id = false): { value: number; width: number; unknown: boolean } {
    if (at >= end || !bytes[at]) return invalid()
    let width = 1, mask = 128
    while (!(bytes[at]! & mask)) { width++; mask >>= 1 }
    if (width > (id ? 4 : 8) || at + width > end) return invalid()
    let value = id ? bytes[at]! : bytes[at]! & (mask - 1)
    let unknown = !id && value === mask - 1
    for (let i = 1; i < width; i++) { value = value * 256 + bytes[at + i]!; unknown = unknown && bytes[at + i] === 255 }
    if (!unknown && !Number.isSafeInteger(value)) return invalid()
    return { value, width, unknown }
  }
  function element(at: number, end: number): Element {
    if (++elements > 20_000) return invalid()
    const id = vint(at, end, true), size = vint(at + id.width, end)
    const start = at + id.width + size.width, next = size.unknown ? end : start + size.value
    if (next > end || (size.unknown && id.value !== 0x18538067 && id.value !== 0x1f43b675)) return invalid()
    return { id: id.value, start, end: next, next, unknown: size.unknown }
  }
  function children(parent: Element): Element[] {
    const found: Element[] = []
    for (let at = parent.start; at < parent.end;) { const item = element(at, parent.end); found.push(item); at = item.next }
    return found
  }
  function uint(item: Element): number {
    const size = item.end - item.start
    if (!size || size > 6) return invalid()
    let value = 0
    for (let at = item.start; at < item.end; at++) value = value * 256 + bytes[at]!
    return value
  }
  const text = (item: Element): string => new TextDecoder().decode(bytes.subarray(item.start, item.end))
  const one = (list: Element[], id: number): Element => { const matches = list.filter(item => item.id === id); return matches.length === 1 ? matches[0]! : invalid() }
  const optional = (list: Element[], id: number): Element | undefined => { const matches = list.filter(item => item.id === id); if (matches.length > 1) return invalid(); return matches[0] }
  try {
    const header = element(0, bytes.length)
    if (header.id !== 0x1a45dfa3 || text(one(children(header), 0x4282)) !== 'webm') return invalid()
    const segment = element(header.next, bytes.length)
    if (segment.id !== 0x18538067 || segment.next !== bytes.length) return invalid()
    const parts = children(segment)
    const info = children(one(parts, 0x1549a966)), tracks = children(one(parts, 0x1654ae6b))
    const scaleNode = optional(info, 0x2ad7b1), scale = scaleNode ? uint(scaleNode) : 1_000_000
    if (scale !== 1_000_000 || tracks.filter(item => item.id === 0xae).length !== 1) return invalid()
    const track = children(one(tracks, 0xae))
    const number = uint(one(track, 0xd7))
    if (!number || uint(one(track, 0x83)) !== 2 || text(one(track, 0x86)) !== 'A_OPUS') return invalid()
    // No video, content encryption/compression, per-track timestamp scaling, or codec changes.
    if (track.some(item => [0x6d80, 0x23314f, 0xe0].includes(item.id))) return invalid()
    const audio = children(one(track, 0xe1)), channelsNode = optional(audio, 0x9f), channels = channelsNode ? uint(channelsNode) : 1
    if (channels !== 1 && channels !== 2) return invalid()
    const frequency = optional(audio, 0xb5)
    if (frequency) {
      const size = frequency.end - frequency.start
      const rate = size === 4 ? view.getFloat32(frequency.start) : size === 8 ? view.getFloat64(frequency.start) : NaN
      if (rate !== 48_000) return invalid()
    }
    const delay = optional(track, 0x56aa), preroll = optional(track, 0x56bb)
    if (delay && uint(delay) > 120_000_000 || preroll && uint(preroll) > 1_000_000_000) return invalid()
    const privateData = one(track, 0x63a2)
    if (privateData.end - privateData.start !== 19 || new TextDecoder().decode(bytes.subarray(privateData.start, privateData.start + 8)) !== 'OpusHead' || bytes[privateData.start + 8] !== 1 || bytes[privateData.start + 9] !== channels || bytes[privateData.start + 18] !== 0) return invalid()
    if (view.getUint16(privateData.start + 10, true) > 5760) return invalid()
    let packets = 0, encodedMs = 0, lastStart = -1, lastEnd = 0
    const clusters: Uint8Array[] = []
    const raw = (item: Element): Uint8Array => encoded(item.id, bytes.subarray(item.start, item.end))
    function block(item: Element, timestamp: number): void {
      const trackNumber = vint(item.start, item.end), at = item.start + trackNumber.width
      if (trackNumber.value !== number || at + 4 > item.end || bytes[at + 2]! & 0x06) return invalid()
      const startMs = timestamp + view.getInt16(at)
      const packet = at + 3, toc = bytes[packet]!, config = toc >> 3, code = toc & 3
      if (code === 3 && packet + 1 >= item.end) return invalid()
      const frames = code === 0 ? 1 : code === 3 ? bytes[packet + 1]! & 63 : 2
      const frameMs = config >= 16 ? 2.5 * 2 ** (config & 3) : config >= 12 ? 10 * 2 ** (config & 1) : (config & 3) === 3 ? 60 : 10 * 2 ** (config & 3)
      const durationMs = frames * frameMs
      if (!frames || durationMs > 120 || startMs < -120 || startMs < lastStart || item.end - packet > frames * 1275 + 256) return invalid()
      encodedMs += durationMs; packets++; lastStart = startMs; lastEnd = startMs + durationMs
      if (encodedMs > VOICE_NOTE_LIMITS.durationMs + 120 || lastEnd > VOICE_NOTE_LIMITS.durationMs + 120) throw new RangeError('duration')
    }
    function cluster(parent: Element): void {
      let timestamp: number | null = null, blocks: Uint8Array[] = []
      const finish = (): void => { if (blocks.length) clusters.push(encoded(0x1f43b675, join(blocks))); blocks = [] }
      for (let at = parent.start; at < parent.end;) {
        const item = element(at, parent.end); at = item.next
        if (item.id === 0xe7) { if (timestamp !== null) return invalid(); timestamp = uint(item); blocks.push(raw(item)) }
        else if (item.id === 0xa3) { if (timestamp === null) return invalid(); block(item, timestamp); blocks.push(raw(item)) }
        else if (item.id === 0xa0) {
          if (timestamp === null) return invalid()
          const group = children(item)
          if (group.some(child => ![0xa1, 0x9b, 0x75a2, 0xfb].includes(child.id))) return invalid()
          const audioBlock = one(group, 0xa1)
          block(audioBlock, timestamp)
          const payload = bytes.slice(audioBlock.start, audioBlock.end)
          const flagsAt = vint(audioBlock.start, audioBlock.end).width + 2
          payload[flagsAt] = payload[flagsAt]! | 0x80
          blocks.push(encoded(0xa3, payload))
        } else if (item.id === 0x1f43b675 && parent.unknown) {
          finish(); timestamp = null; at = item.start
        } else if (![0xec, 0xbf, 0xa7, 0xab].includes(item.id)) return invalid()
      }
      finish()
    }
    for (const part of parts) {
      if (part.id === 0x1f43b675) cluster(part)
      else if (![0x1549a966, 0x1654ae6b, 0x114d9b74, 0x1c53bb6b, 0x1254c367, 0xec, 0xbf].includes(part.id)) return invalid()
    }
    if (!packets || encodedMs < 200 || lastEnd < 200) return { ok: false, reason: 'duration' }
    const declared = optional(info, 0x4489)
    if (declared) {
      const length = declared.end - declared.start
      const value = length === 4 ? view.getFloat32(declared.start) : length === 8 ? view.getFloat64(declared.start) : NaN
      if (!Number.isFinite(value) || value < 0 || value > VOICE_NOTE_LIMITS.durationMs + 120 || Math.abs(value - lastEnd) > 1000) return invalid()
    }
    const durationMs = Math.ceil(Math.max(encodedMs, lastEnd))
    const duration = new Uint8Array(8)
    new DataView(duration.buffer).setFloat64(0, durationMs)
    const cleanInfo = encoded(0x1549a966, join([encoded(0x2ad7b1, new Uint8Array([0x0f, 0x42, 0x40])), encoded(0x4489, duration)]))
    const cleanTrack = encoded(0xae, join(track.filter(item => [0xd7, 0x73c5, 0x83, 0x86, 0x63a2, 0x56aa, 0x56bb].includes(item.id)).map(raw).concat(encoded(0xe1, join(audio.filter(item => [0x9f, 0xb5].includes(item.id)).map(raw))))))
    const cleanHeader = encoded(0x1a45dfa3, join([[0x4286, 1], [0x42f7, 1], [0x42f2, 4], [0x42f3, 8], [0x4287, 4], [0x4285, 2]].map(([id, value]) => encoded(id!, new Uint8Array([value!]))).concat(encoded(0x4282, new TextEncoder().encode('webm')))))
    const cleaned = join([cleanHeader, encoded(0x18538067, join([cleanInfo, encoded(0x1654ae6b, cleanTrack), ...clusters]))])
    if (cleaned.length > VOICE_NOTE_LIMITS.bytes) return { ok: false, reason: 'size' }
    return { ok: true, format: 'webm-opus', durationMs, bytes: cleaned }
  } catch (error) { return { ok: false, reason: error instanceof RangeError ? 'duration' : 'format' } }
}

export const VOICE_POLICY = Object.freeze({ perDay: 20, perChat: 50, retentionMs: 30 * 86400000, ceilingBytes: 200 * 1024 * 1024, reportsToHide: 2 })
