import { FURNITURE } from '../content/furniture.ts'
import { homeOf } from '../content/housing.ts'
import { HOUSE_DESIGNS } from '../content/world.ts'
import { housesFor } from '../cities/housingRuntime.ts'
import { checkPlacement, MAX_PLACED, plotOf } from '../home-layout.ts'
import { cleanText, isRecord } from '../util.ts'
import type { LifeState, PlacedItem } from '../../types/life.ts'
import type { StoryContent, StoryDraft, StoryMoment, StoryRun, StoryScene, StoryState } from '../../types/stories.ts'

export const STORY_LIMITS = Object.freeze({ scenes: 8, moments: 8, title: 60, description: 240, prompt: 280 })
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 1e9
const integer = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max
export const storyId = (value: unknown): value is string => typeof value === 'string' && /^story[1-9]\d{0,8}$/.test(value)
export const cloneItems = (items: readonly PlacedItem[]): PlacedItem[] => items.map(item => ({ id: item.id, itemId: item.itemId, x: item.x, y: item.y, rot: item.rot, ...(item.floor ? { floor: item.floor } : {}) }))

function readItems(value: unknown): PlacedItem[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>(), items: PlacedItem[] = []
  for (const item of value.slice(0, MAX_PLACED)) {
    if (!isRecord(item) || typeof item.id !== 'string' || !/^f[1-9]\d{0,8}$/.test(item.id) || ids.has(item.id) || typeof item.itemId !== 'string' || !Object.hasOwn(FURNITURE, item.itemId)) continue
    if (!integer(item.x, 100) || !integer(item.y, 100) || !integer(item.rot, 3) || (item.floor !== undefined && !integer(item.floor, 2))) continue
    ids.add(item.id)
    items.push({ id: item.id, itemId: item.itemId, x: item.x, y: item.y, rot: item.rot, ...(typeof item.floor === 'number' && item.floor ? { floor: item.floor } : {}) })
  }
  return items
}

function readMoments(value: unknown): StoryMoment[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, STORY_LIMITS.moments).filter(isRecord).map(moment => ({ title: cleanText(moment.title, STORY_LIMITS.title), prompt: cleanText(moment.prompt, STORY_LIMITS.prompt) })).filter(moment => moment.title && moment.prompt)
}
function readDraft(value: unknown): StoryDraft | null {
  if (!isRecord(value)) return null
  const title = cleanText(value.title, STORY_LIMITS.title)
  if (!title) return null
  return { title, description: cleanText(value.description, STORY_LIMITS.description), items: readItems(value.items), moments: readMoments(value.moments) }
}
export function publishable(draft: StoryDraft): StoryContent | null {
  const [first, ...rest] = draft.moments
  return first ? { ...draft, items: cloneItems(draft.items), moments: [{ ...first }, ...rest.map(moment => ({ ...moment }))] } : null
}
export function cloneContent(content: StoryContent): StoryContent {
  const [first, ...rest] = content.moments
  return { ...content, items: cloneItems(content.items), moments: [{ ...first }, ...rest.map(moment => ({ ...moment }))] }
}

/** Old or malformed records have bounded size and cannot supply their own running script or props. */
export function sanitizeStories(value: unknown, now: number): StoryState {
  const source = isRecord(value) ? value : {}, scenes: StoryScene[] = [], seen = new Set<string>()
  let seq = positive(source.seq) ? source.seq : 1
  if (Array.isArray(source.scenes)) for (const entry of source.scenes.slice(0, STORY_LIMITS.scenes)) {
    if (!isRecord(entry) || !storyId(entry.id) || seen.has(entry.id)) continue
    const draft = readDraft(entry.draft)
    if (!draft) continue
    const draftRevision = positive(entry.draftRevision) ? entry.draftRevision : 1
    const savedPublication = isRecord(entry.publication) ? entry.publication : null
    const savedContent = savedPublication?.kind === 'published' ? readDraft(savedPublication.content) : null
    const content = savedContent ? publishable(savedContent) : null
    const publication = content && savedPublication && positive(savedPublication.revision) && savedPublication.revision <= draftRevision
      ? { kind: 'published' as const, revision: savedPublication.revision, content } : { kind: 'unpublished' as const }
    seen.add(entry.id)
    seq = Math.max(seq, Number(entry.id.slice(5)) + 1)
    scenes.push({ id: entry.id, draftRevision, draft, publication })
  }
  let running: StoryRun | null = null
  if (isRecord(source.running)) {
    const saved = source.running, scene = scenes.find(scene => scene.id === saved.sceneId)
    if (scene?.publication.kind === 'published' && saved.revision === scene.publication.revision && integer(saved.step, scene.publication.content.moments.length - 1) && typeof saved.startedAt === 'number' && Number.isFinite(saved.startedAt) && saved.startedAt >= 0) {
      running = { sceneId: scene.id, revision: scene.publication.revision, step: saved.step, startedAt: Math.min(now, saved.startedAt), content: cloneContent(scene.publication.content) }
    }
  }
  return { seq, scenes, running }
}

/** Authoring has no item input: the server snapshots the owner's current room. */
export function authoredDraft(payload: Record<string, unknown>, items: readonly PlacedItem[]): StoryDraft | null {
  const text = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && value.length <= max && (empty || Boolean(value.trim())) && !/[\u0000-\u001f\u007f]/.test(value)
  if (!text(payload.title, STORY_LIMITS.title) || !text(payload.description, STORY_LIMITS.description, true) || !Array.isArray(payload.moments) || payload.moments.length > STORY_LIMITS.moments) return null
  const moments: StoryMoment[] = []
  for (const moment of payload.moments) {
    if (!isRecord(moment) || !text(moment.title, STORY_LIMITS.title) || !text(moment.prompt, STORY_LIMITS.prompt)) return null
    moments.push({ title: moment.title.trim(), prompt: moment.prompt.trim() })
  }
  return { title: payload.title.trim(), description: payload.description.trim(), items: cloneItems(items), moments }
}

export function layoutFailure(state: LifeState, items: readonly PlacedItem[]): 'props_unavailable' | 'invalid_layout' | null {
  const owned = new Map<string, number>()
  for (const item of state.home.items) owned.set(item.itemId, (owned.get(item.itemId) ?? 0) + 1)
  for (const [item, count] of Object.entries(state.home.storage)) if (Number.isSafeInteger(count) && count > 0) owned.set(item, (owned.get(item) ?? 0) + count)
  const overflow = 'overflow' in state.home ? state.home.overflow : null
  if (isRecord(overflow)) for (const [item, count] of Object.entries(overflow)) if (typeof count === 'number' && Number.isSafeInteger(count) && count > 0) owned.set(item, (owned.get(item) ?? 0) + count)
  const home = homeOf(state, HOUSE_DESIGNS, housesFor(state.estate.city)), plot = plotOf(home.grid, home.owned), placed: PlacedItem[] = [], ids = new Set<string>()
  if (items.length > MAX_PLACED) return 'invalid_layout'
  for (const item of items) {
    const remaining = owned.get(item.itemId) ?? 0, definition = FURNITURE[item.itemId]
    if (!definition || !remaining) return 'props_unavailable'
    if (ids.has(item.id) || checkPlacement(plot, placed, definition, item.x, item.y, item.rot, null, item.floor ?? 0)) return 'invalid_layout'
    owned.set(item.itemId, remaining - 1); ids.add(item.id); placed.push(item)
  }
  return null
}

export const currentMoment = (stories: StoryState): StoryMoment | null => stories.running?.content.moments[stories.running.step] ?? null
