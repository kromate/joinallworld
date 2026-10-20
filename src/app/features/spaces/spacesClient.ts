// A small typed wrapper over /api/spaces/*: every answer is { ok: true, ... } or { ok: false, code, reason }, and a thrown
// transport error becomes a refusal in words.
import type { SpacePlanV1, SpaceProblem, SpaceTarget } from '../../../spaces/plan.ts'
import { packPlan } from '../../../spaces/plan.ts'
import type { ModelView, ModelsMine, PlacedModel, WorldCard, WorldsList, WorldView } from '../../../types/spaces.ts'
import type { Placement } from '../../../spaces/layout.ts'
export type { ModelView, ModelsMine, PlacedModel, WorldView, WorldCard, WorldsList }

export interface Fetcher { fetchJson: <T = Record<string, unknown>>(path: string, options?: { method?: 'POST'; body?: unknown }) => Promise<T> }
export type Refusal = { ok: false; code: string; reason: string }
export interface Designed { ok: true; code: 'designed' | 'checked'; plan: SpacePlanV1; problems: SpaceProblem[]; cost: number; cash: number | null; space: { grid: number; owned: boolean } }
export interface Applied { ok: true; code: 'applied'; placed: number; spent: number; problems: SpaceProblem[] }
export interface Where { target: SpaceTarget; roomId?: string }

async function call<T>(api: Fetcher, path: string, body?: unknown): Promise<T | Refusal> {
  try {
    return await api.fetchJson<T | Refusal>(path, body === undefined ? undefined : { method: 'POST', body })
  } catch (caught) {
    const error = caught as { code?: string; reason?: string; status?: number }
    return { ok: false, code: error.code || 'network', reason: error.reason || (error.status ? 'The designer could not do that. Try again.' : 'No connection. Check your network and try again.') }
  }
}

export const aiStatus = async (api: Fetcher): Promise<boolean> => {
  const answer = await call<{ ok: true; ai: boolean }>(api, '/api/spaces/status')
  return answer.ok ? answer.ai : false
}
export const design = (api: Fetcher, where: Where, prompt: string, keep: boolean) =>
  call<Designed>(api, '/api/spaces/design', { ...where, prompt, ...(keep ? { keep: true } : {}) })
export const check = (api: Fetcher, where: Where, plan: SpacePlanV1) =>
  call<Designed>(api, '/api/spaces/check', { ...where, plan: packPlan(plan) })
export const apply = (api: Fetcher, where: Where, plan: SpacePlanV1, requestId: string) =>
  call<Applied>(api, '/api/spaces/apply', { ...where, plan: packPlan(plan), requestId })

export interface HostState { kind: 'butler' | 'dj' | 'quizmaster' | 'gateman' | null; persona: string; on: boolean; name: string | null; kinds: { id: string; label: string; name: string }[] }
export const hostRead = (api: Fetcher) => call<{ ok: true; ai: boolean; host: HostState }>(api, '/api/spaces/host')
export const hostWrite = (api: Fetcher, body: { kind: HostState['kind']; persona?: string; on: boolean }) =>
  call<{ ok: true; code: 'saved' | 'removed'; host: HostState }>(api, '/api/spaces/host', body)

// Players' 3D models (docs/SPACES-3D.md). The upload sends the file's bytes as they are, so it uses fetch itself.
type ModelDone = { ok: true; code: 'uploaded' | 'already' | 'renamed'; model: ModelView }
export const modelsMine = (api: Fetcher) => call<ModelsMine>(api, '/api/spaces/models')
export const modelRename = (api: Fetcher, id: string, name: string) => call<ModelDone>(api, '/api/spaces/models/rename', { id, name })
export const modelDelete = (api: Fetcher, id: string) => call<{ ok: true; code: 'deleted' }>(api, '/api/spaces/models/delete', { id })
export const modelReport = (api: Fetcher, by: string, id: string) => call<{ ok: true; code: 'reported' }>(api, '/api/spaces/models/report', { by, id })
export const modelFileUrl = (hash: string): string => `/api/spaces/model-file/${hash}`
export async function modelUpload(file: Blob, name: string, house = false): Promise<ModelDone | Refusal> {
  try {
    if (!await (await import('../terms/agree.ts')).agreeBeforeSocketSharing()) throw Error('Sharing cancelled.')
    const response = await fetch(`/api/spaces/models?name=${encodeURIComponent(name)}${house ? '&house=1' : ''}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'model/gltf-binary' }, body: file })
    const answer = await response.json().catch(() => null) as (ModelDone | Refusal | { error?: string }) | null
    if (answer && 'ok' in answer) return answer
    if (response.status === 413) return { ok: false, code: 'too_large', reason: house ? 'This file is too large. A whole house may be at most 50 MB.' : 'This file is too large. A model may be at most 20 MB.' }
    return { ok: false, code: 'failed', reason: 'The upload did not go through. Try again.' }
  } catch { return { ok: false, code: 'network', reason: 'No connection. Check your network and try again.' } }
}
export async function modelBytes(hash: string): Promise<ArrayBuffer | null> {
  try { const response = await fetch(modelFileUrl(hash), { credentials: 'same-origin' }); return response.ok ? await response.arrayBuffer() : null } catch { return null }
}

// A space in 3D (docs/SPACES-3D.md, phase 2).
export interface WorldWhere { target: 'home' | 'room' | 'world'; host?: string; id?: string }
export const worldRead = (api: Fetcher, where: WorldWhere) => {
  const query = new URLSearchParams({ target: where.target, ...(where.host ? { host: where.host } : {}), ...(where.id ? { id: where.id } : {}) })
  return call<WorldView>(api, `/api/spaces/world?${query}`)
}
export const worldSave = (api: Fetcher, where: WorldWhere, models: readonly Placement[]) =>
  call<{ ok: true; code: 'saved'; placed: number; triangles: number }>(api, '/api/spaces/world/layout', { target: where.target, ...(where.id ? { id: where.id } : {}), models })
export const scriptSave = (api: Fetcher, where: WorldWhere, code: string, lines: readonly string[]) =>
  call<{ ok: true; code: 'saved' | 'removed'; lines?: number }>(api, '/api/spaces/world/script', { target: where.target, ...(where.id ? { id: where.id } : {}), code, lines })

// Copy my real house (docs/HOUSE-FROM-PHOTOS.md; server/spaces/home-house.ts).
export const houseSet = (api: Fetcher, body: { spec: unknown } | { model: string } | { clear: true }) => call<{ ok: true; code: 'saved' | 'cleared'; kind?: 'spec' | 'model'; notes?: string[]; rooms?: number }>(api, '/api/spaces/house', body)

// Worlds (docs/WORLDS.md; server/spaces/worlds.ts).
export const worldsList = (api: Fetcher, which: 'mine' | 'new' | 'popular' | 'friends') => call<WorldsList>(api, `/api/spaces/worlds?list=${which}`)
export const worldCreate = (api: Fetcher, body: { name: string; blurb: string; size: string; ground: string; open: string; sky: string; template: string }) => call<{ ok: true; code: 'created'; world: WorldCard }>(api, '/api/spaces/worlds', body)
export const worldUpdate = (api: Fetcher, body: { id: string; name?: string; blurb?: string; ground?: string; open?: string; sky?: string; game?: string }) => call<{ ok: true; code: 'saved'; world: WorldCard }>(api, '/api/spaces/worlds/update', body)
export const worldLike = (api: Fetcher, id: string, on: boolean) => call<{ ok: true; code: 'saved'; likes: number; liked: boolean }>(api, '/api/spaces/worlds/like', { id, on })
export const worldBuilders = (api: Fetcher, id: string, builders: string[]) => call<{ ok: true; code: 'saved'; world: WorldCard }>(api, '/api/spaces/worlds/builders', { id, builders })
/** The lite games a world may offer: the built-in ones and those the player imported. */
export const liteGames = (api: Fetcher) => call<{ ok: true; code: 'ok'; games: { id: string; title: string }[] }>(api, '/api/spaces/games')
/** The player's friends, for choosing who builds with them. */
export const myFriends = (api: Fetcher) => call<{ ok: true; code: 'ok'; friends: { id: string; name: string }[] }>(api, '/api/social/me?lite=1')
export const worldDelete = (api: Fetcher, id: string) => call<{ ok: true; code: 'deleted' }>(api, '/api/spaces/worlds/delete', { id })
/** A world's cover, with its hash's first letters so a new cover is a new address. */
export const worldCoverUrl = (card: Pick<WorldCard, 'id' | 'cover'>): string | null => (card.cover ? `/api/spaces/world-cover/${card.id}?v=${card.cover}` : null)
export async function worldCoverUpload(id: string, picture: Blob): Promise<{ ok: true; code: 'saved'; cover: string } | Refusal> {
  try {
    if (!await (await import('../terms/agree.ts')).agreeBeforeSocketSharing()) throw Error('Sharing cancelled.')
    const response = await fetch(`/api/spaces/worlds/cover?id=${encodeURIComponent(id)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/webp', Accept: 'application/json' }, body: picture })
    return await response.json() as { ok: true; code: 'saved'; cover: string } | Refusal
  } catch { return { ok: false, code: 'offline', reason: 'The cover could not be sent.' } }
}
