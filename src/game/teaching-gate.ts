/** Conditional, retryable load for saved teaching-session validation in read-only builds. */
import { PLAYS } from './profile.ts'
import type { TeachingPractice } from './living-world/teaching-state.ts'

type TeachingReader = (value: unknown) => TeachingPractice | null

let installedReader: TeachingReader | null = null
let loading: Promise<void> | null = null

function plain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch { return false }
}

function ownData(value: Record<string, unknown>, key: string): { present: boolean; value?: unknown } {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return { present: false }
    return { present: true, value: descriptor.value }
  } catch { return { present: false } }
}

function teachingMarker(snapshot: unknown): { found: boolean; value?: unknown } {
  if (!plain(snapshot)) return { found: false }
  const active = ownData(snapshot, 'activeAction')
  if (!active.present || !plain(active.value)) return { found: false }
  const kind = ownData(active.value, 'kind')
  const teaching = ownData(active.value, 'teaching')
  const generation = ownData(active.value, 'teachingGeneration')
  const marked = teaching.present || generation.present
  return kind.present && kind.value === 'activity' && marked
    ? { found: true, value: teaching.present ? teaching.value : generation.value } : { found: false }
}

/** Read a raw practice value with the installed private parser; no static state import. */
export function readTeachingSnapshot(value: unknown): TeachingPractice | null {
  if (!installedReader) return null
  try { return installedReader(value) } catch { return null }
}

/** Null means no rules are needed for this snapshot; a promise means wait before accepting it. */
export function teachingFor(snapshot: unknown): Promise<void> | null {
  if (PLAYS || installedReader) return null
  const marker = teachingMarker(snapshot)
  if (!marker.found) return null
  if (loading) return loading
  loading = import('./living-world/teaching-state.ts').then(module => {
    if (typeof module.readTeachingPractice !== 'function') throw new TypeError('Teaching state reader is unavailable.')
    installedReader = module.readTeachingPractice
  }).catch(error => {
    loading = null
    throw error
  })
  return loading
}
