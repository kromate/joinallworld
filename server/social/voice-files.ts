import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { VoiceStore, StoredVoice } from '../types.ts'
import { VOICE_NOTE_LIMITS } from '../../src/types/voice-note.ts'

const isStored = (value: unknown): value is StoredVoice => {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && VOICE_NOTE_LIMITS.idPattern.test(v.id) && typeof v.conv === 'string' && typeof v.at === 'number' && Number.isFinite(v.at) && typeof v.size === 'number' && Number.isSafeInteger(v.size) && v.size > 0 && v.size <= VOICE_NOTE_LIMITS.bytes && v.type === 'webm-opus' && typeof v.durationMs === 'number' && v.durationMs > 0 && v.durationMs <= VOICE_NOTE_LIMITS.durationMs + 120
}
export function createFileVoices(dir: string): VoiceStore {
  let loading: Promise<Map<string, StoredVoice>> | null = null
  const bytesPath = (id: string): string => join(dir, `${id}.voice`), factsPath = (id: string): string => join(dir, `${id}.json`)
  function load(): Promise<Map<string, StoredVoice>> {
    return loading ??= (async () => {
      const found = new Map<string, StoredVoice>()
      await mkdir(dir, { recursive: true })
      const names = new Set(await readdir(dir))
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const raw = await readFile(join(dir, name), 'utf8')
        try { const facts: unknown = JSON.parse(raw); if (isStored(facts)) found.set(facts.id, facts) } catch { /* incomplete metadata is not a readable recording */ }
      }
      for (const name of names) if (name.endsWith('.voice') && VOICE_NOTE_LIMITS.idPattern.test(name.slice(0, -6)) && !names.has(`${name.slice(0, -6)}.json`)) await rm(join(dir, name), { force: true })
      return found
    })().catch(error => { loading = null; throw error })
  }
  async function drop(ids: readonly string[]): Promise<void> {
    const known = await load()
    for (const id of ids) {
      if (!VOICE_NOTE_LIMITS.idPattern.test(id)) continue
      await rm(factsPath(id), { force: true }); await rm(bytesPath(id), { force: true }); known.delete(id)
    }
  }
  return {
    async put(voice, bytes) {
      if (!isStored(voice) || bytes.length !== voice.size) throw Error('Invalid recording metadata')
      const known = await load(), temp = `${bytesPath(voice.id)}.tmp`, factsTemp = `${factsPath(voice.id)}.tmp`
      try {
        await writeFile(temp, bytes, { mode: 0o600, flush: true }); await rename(temp, bytesPath(voice.id))
        await writeFile(factsTemp, JSON.stringify(voice), { mode: 0o600, flush: true }); await rename(factsTemp, factsPath(voice.id))
        const directory = await open(dir, 'r'); try { await directory.sync() } finally { await directory.close() }
        known.set(voice.id, voice)
      } catch (error) { await Promise.all([temp, factsTemp, bytesPath(voice.id), factsPath(voice.id)].map(path => rm(path, { force: true }).catch(() => {}))); throw error }
    },
    async get(id) {
      const known = await load(), voice = VOICE_NOTE_LIMITS.idPattern.test(id) ? known.get(id) : undefined
      if (!voice) return null
      try { return { voice, bytes: new Uint8Array(await readFile(bytesPath(id))) } } catch { return null }
    },
    remove: drop,
    async removeConv(convs) { const known = await load(), wanted = new Set(convs); await drop([...known.values()].filter(voice => wanted.has(voice.conv)).map(voice => voice.id)) },
    async trim(before, maxBytes) {
      const all = [...(await load()).values()].sort((a, b) => a.at - b.at), removed: string[] = []
      let total = all.reduce((sum, voice) => sum + voice.size, 0)
      for (const voice of all) { if (voice.at >= before && total <= maxBytes) break; removed.push(voice.id); total -= voice.size }
      await drop(removed); return removed
    },
    async stats() { const all = [...(await load()).values()]; return { count: all.length, bytes: all.reduce((sum, voice) => sum + voice.size, 0) } },
  }
}
