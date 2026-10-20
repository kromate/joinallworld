// The feed's requests (server/routes/feed.ts). Every call answers { ok: true, … } or { ok: false, code, reason }; a network or HTTP failure
// is turned into the same refusal shape so a screen has one thing to handle.
import type { CrewView, EventView, FeedMe, FeedMedia, FeedPage, GigView, PostView, ProfileView, Suggestion } from '../../../types/feed.ts'
import type { FeedTab, Visibility } from '../../../feed/model.ts'

export type Refused = { ok: false; code: string; reason: string }
export type Answer<T> = ({ ok: true } & T) | Refused
import type { FetchJson } from '../../types/client.ts'

const failure = (error: unknown): Refused => {
  const e = error as { code?: unknown; reason?: unknown; message?: unknown } | null
  const code = typeof e?.code === 'string' ? e.code : 'network'
  const reason = typeof e?.reason === 'string' ? e.reason : code === 'rate_limited' ? 'You are doing that too quickly. Wait a moment.' : 'That did not go through. Check your connection and try again.'
  return { ok: false, code, reason }
}
const q = (params: Record<string, string | number | null | undefined>): string => { const s = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') s.set(k, String(v)); const t = s.toString(); return t ? `?${t}` : '' }

export function feedApi(fetchJson: FetchJson) {
  const get = async <T>(path: string): Promise<Answer<T>> => { try { return await fetchJson<Answer<T>>(path) } catch (error) { return failure(error) } }
  const post = async <T>(path: string, body: object = {}): Promise<Answer<T>> => { try { return await fetchJson<Answer<T>>(path, { method: 'POST', body }) } catch (error) { return failure(error) } }
  return {
    me: () => get<FeedMe>('/api/feed/me'),
    seen: () => post('/api/feed/seen'),
    list: (tab: FeedTab, city?: string, after?: string | null) => get<FeedPage>(`/api/feed/list${q({ tab, city, after })}`),
    crewWall: (id: string, after?: string | null) => get<FeedPage>(`/api/feed/crew${q({ id, after })}`),
    by: (id: string, after?: string | null) => get<FeedPage>(`/api/feed/by${q({ id, after })}`),
    thread: (id: string) => get<{ post: PostView }>(`/api/feed/post${q({ id })}`),
    post: (body: { body?: string; vis?: Visibility; crew?: string; media?: string; poster?: string; draft?: number; label?: string; duet?: string }) => post<{ post: PostView }>('/api/feed/post', body),
    removePost: (id: string) => post('/api/feed/post/remove', { id }),
    react: (id: string, emoji: string | null) => post<{ post: PostView }>('/api/feed/react', { id, emoji }),
    reply: (id: string, body: string) => post<{ post: PostView }>('/api/feed/reply', { id, body }),
    removeReply: (id: string, n: number) => post('/api/feed/reply/remove', { id, n }),
    report: (kind: string, id: string, reason: string, n?: number) => post('/api/feed/report', { kind, id, reason, ...(n !== undefined ? { n } : {}) }),
    dropDraft: (n: number) => post('/api/feed/draft/remove', { n }),
    profile: (id: string) => get<{ profile: ProfileView }>(`/api/feed/profile${q({ id })}`),
    editProfile: (body: { bio?: string; status?: string; withPlace?: boolean; open?: boolean }) => post<{ profile: ProfileView }>('/api/feed/profile', body),
    handle: (handle: string) => post<{ profile: ProfileView }>('/api/feed/handle', { handle }),
    code: (code: string) => get<{ kind: 'friend' | 'crew' | 'event'; profile?: ProfileView; crew?: CrewView; event?: EventView }>(`/api/feed/code${q({ code })}`),
    follow: (id: string, on: boolean) => post<{ profile: ProfileView }>('/api/feed/follow', { id, on }),
    suggestions: () => get<{ people: Suggestion[] }>('/api/feed/suggestions'),
    vouch: (id: string, skill: string, on: boolean) => post<{ profile: ProfileView }>('/api/feed/vouch', { id, skill, on }),
    createCrew: (body: { name: string; colour?: string; about?: string }) => post<{ crew: CrewView }>('/api/feed/crews', body),
    joinCrew: (code: string) => post<{ crew: CrewView }>('/api/feed/crews/join', { code }),
    leaveCrew: (id: string, member?: string) => post('/api/feed/crews/leave', { id, ...(member ? { member } : {}) }),
    crew: (id: string) => get<{ crew: CrewView }>(`/api/feed/crews/one${q({ id })}`),
    events: (city?: string) => get<{ events: EventView[]; mine: EventView[] }>(`/api/feed/events${q({ city })}`),
    event: (codeOrId: string) => get<{ event: EventView }>(`/api/feed/events/one${q(/^[A-Z]{6}$/.test(codeOrId) ? { code: codeOrId } : { id: codeOrId })}`),
    createEvent: (body: { title: string; about?: string; start: number; hours?: number; place?: string; cap?: number }) => post<{ event: EventView; post: PostView | null }>('/api/feed/events', body),
    rsvp: (id: string, answer: 'going' | 'maybe' | null) => post<{ event: EventView }>('/api/feed/events/rsvp', { id, answer }),
    cancelEvent: (id: string) => post('/api/feed/events/cancel', { id }),
    gigs: (city?: string) => get<{ gigs: GigView[]; mine: GigView[] }>(`/api/feed/gigs${q({ city })}`),
    createGig: (body: { title: string; about?: string; reward: number }) => post<{ gig: GigView }>('/api/feed/gigs', body),
    gigAct: (id: string, op: string, extra: Record<string, unknown> = {}) => post<{ gig: GigView }>('/api/feed/gigs/act', { id, op, ...extra }),
  }
}
export type FeedApi = ReturnType<typeof feedApi>

/** Upload a photo, a portrait or a clip: the bytes as they are, with their type. Answers the stored media or a refusal. */
export async function uploadMedia(blob: Blob, use: 'post' | 'portrait', extra: { ms?: number; w?: number; h?: number } = {}): Promise<Answer<{ media: FeedMedia }>> {
  try {
    if (!await (await import('../terms/agree.ts')).agreeBeforeSocketSharing()) throw Error('Sharing cancelled.')
    const res = await fetch(`/api/feed/media${q({ use, ...extra })}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob })
    const data = await res.json() as Answer<{ media: FeedMedia }> & { error?: string }
    if (!res.ok) return { ok: false, code: data.error ?? 'upload_failed', reason: res.status === 413 ? 'That file is too big.' : res.status === 415 ? 'That kind of file cannot be posted.' : 'The upload did not go through. Try again.' }
    return data
  } catch { return { ok: false, code: 'network', reason: 'The upload did not go through. Check your connection.' } }
}
export const mediaUrl = (hash: string): string => `/api/feed/media/${hash}`
export const portraitUrl = (id: string, hash: string): string => `/api/feed/portrait/${id}?h=${hash}`
