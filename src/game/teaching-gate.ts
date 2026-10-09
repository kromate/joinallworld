/** Conditional, retryable load for saved teaching-session validation in read-only builds. */
import { PLAYS } from './profile.ts'
import type { TeachingPractice } from './living-world/teaching-state.ts'

type TeachingReader = (value: unknown) => TeachingPractice | null

let installedReader: TeachingReader | null = null
let loading: Promise<void> | null = null

function teachingMarker(snapshot: unknown): boolean {
  try {
    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false
    const snapshotPrototype = Object.getPrototypeOf(snapshot)
    if (snapshotPrototype !== Object.prototype && snapshotPrototype !== null) return false
    const active = Object.getOwnPropertyDescriptor(snapshot, 'activeAction')
    if (!active?.enumerable || !Object.hasOwn(active, 'value')) return false
    const action = active.value
    if (action === null || typeof action !== 'object' || Array.isArray(action)) return false
    const actionPrototype = Object.getPrototypeOf(action)
    if (actionPrototype !== Object.prototype && actionPrototype !== null) return false
    const kind = Object.getOwnPropertyDescriptor(action, 'kind')
    if (!kind?.enumerable || !Object.hasOwn(kind, 'value') || kind.value !== 'activity') return false
    const teaching = Object.getOwnPropertyDescriptor(action, 'teaching')
    const generation = Object.getOwnPropertyDescriptor(action, 'teachingGeneration')
    return Boolean((teaching?.enumerable && Object.hasOwn(teaching, 'value'))
      || (generation?.enumerable && Object.hasOwn(generation, 'value')))
  } catch { return false }
}

/** Read a raw practice value with the installed private parser; no static state import. */
export function readTeachingSnapshot(value: unknown): TeachingPractice | null {
  return installedReader ? installedReader(value) : null
}

/** Null means no rules are needed for this snapshot; a promise means wait before accepting it. */
export function teachingFor(snapshot: unknown): Promise<void> | null {
  if (PLAYS || installedReader) return null
  if (!teachingMarker(snapshot)) return null
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
