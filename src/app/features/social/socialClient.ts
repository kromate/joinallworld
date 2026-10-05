// The browser-side social client, typed and reactive: the state the People, Messages, Contacts,
// Family and Invite screens share, its one socket for live pushes, and the outbox that makes
// every sent message end as sent or failed. A port of src/ui/panels/social-client.js with the
// same function names, request paths and rules (the retry key of a message and of a group form
// is made once and reused, so a retry can never store anything twice).
//
// It talks to /api/social/* through the host's fetchJson and keeps one socket open to /socket for
// live pushes (new messages, knocks, friend requests). Sending always goes over HTTP so that
// every message resolves to sent or failed; the socket is only for receiving, and whatever
// arrived while it was down is fetched again when it reconnects. Rules that can be tested
// without a browser live in src/game/social-model.ts.
//
// Nothing here touches the microphone or voice, and no timer repeats: the only timers are the
// bounded reconnect back-off and single follow-up checks.
//
// LIVE LOCATION. While the socket is open it watches the player's city and friends (`live-watch`); the
// `live-snapshot` and `live-move` frames fill `state.live`, and each friend row and friend card is
// written from it, so "at Freedom Park" and "On the way to …" follow the server within a tick and a
// re-read of the overview never puts an older place back. onLive() tells the map host.
//
// `state` is reactive (a component that reads it follows it) and every change also calls the
// host's refresh(), so the existing panels and the registry's badge() functions, which are not
// reactive, redraw as before. `revision` counts those changes for anything that reads the outbox,
// which is not reactive (threadView()).
import { reactive, ref } from 'vue'
import type { Ref } from 'vue'
import { createOutbox, freshSocial, inviteIdFrom, mergeMessages, SEND_TIMEOUT_MS } from '../../../game/social-model.ts'
import type { ThreadRecord } from '../../../game/social-model.ts'
import { applyWhereabouts, freshLive, LIVE_GRACE_MS, takeMove, takeSnapshot, whereabouts } from '../../../game/live-model.ts'
import type { LiveTable } from '../../../game/live-model.ts'
import type { LiveServerFrame } from '../../../types/live.ts'
import type { ErrorFrame, PresenceFrame } from '../../../types/protocol.ts'
import type { Conversation, Friend, KnockState, Message, PeopleFrame, PeopleListing, PersonCard, SocialOverview, SocialPushFrame, ThreadItem } from '../../../types/social.ts'
import type { ApiError } from '../../types/client.ts'
import type { PanelApi } from '../../types/panel.ts'

const MAX_ATTEMPTS = 6

/** What the socket for live pushes is doing. 'offline' = the automatic reconnects ran out. */
export type SocialSocketState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'offline'
/** A refusal comes back as { ok: false, code, reason }; `transport` is true when the server was not reached. */
export type SocialResult<T> = ({ ok: true } & T) | { ok: false; code: string; reason: string; transport?: boolean }
/** Where a message goes: a player (a new chat) or an existing conversation. */
export type SendTarget = { to: string } | { conv: string }
/** The who-is-here listing, or why it could not be read. */
export type PeopleState = PeopleListing | { error: string }

export interface SocialState {
  /** The overview from GET /api/social/me, or null until it has loaded. */
  me: SocialOverview | null
  loading: boolean
  error: string | null
  socket: SocialSocketState
  people: PeopleState | null
  peopleAt: number
  peopleLoading: boolean
  /** The founder's next page of friends is being read. */
  friendsLoading: boolean
  /** conversation id → its messages */
  threads: Map<string, ThreadRecord>
  /** player id → their card, or why it could not be had */
  profiles: Map<string, PersonCard | { error: string }>
  /** The conversation on screen: messages that arrive for it are marked read. */
  openConv: string | null
  /** My own knock. */
  knock: KnockState | null
  /** House id from an invite link that has not been handled yet. */
  linkHost: string | null
  /** While this socket is in a host's Home room as a guest. */
  houseRoom: { host: string; members: { id: string; name: string }[] } | null
  /** Where friends are right now, and how many players are at each venue of this city (src/game/live-model.ts). */
  live: LiveTable
}

/** The socket, as far as this client uses it. */
export interface SocketLike {
  readyState: number
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  /** A browser hands the close event (its `code` says why the server closed it); a test may call it with nothing. */
  onclose: ((event?: { code?: number }) => void) | null
}
/** What the client needs from the page; every field has a browser default. Tests pass fakes. */
export interface SocialEnv {
  openSocket(): SocketLike
  /** The path and query of the page, where an invite link may be. */
  pageAddress(): { pathname: string; search: string }
  /** The invite link has been handled: the address goes back to '/'. */
  clearAddress(): void
  /** Called whenever the device comes back online. */
  onOnline(listener: () => void): void
  setTimeout(run: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  now(): number
}

const browserEnv = (): SocialEnv => ({
  openSocket: () => new WebSocket(`${globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${globalThis.location.host}/socket`) as unknown as SocketLike,
  pageAddress: () => ({ pathname: globalThis.location?.pathname ?? '', search: globalThis.location?.search ?? '' }),
  clearAddress() { try { globalThis.history.replaceState(null, '', '/') } catch { /* the address stays */ } },
  onOnline(listener) { globalThis.window?.addEventListener('online', listener) },
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
})

/** What a server push may be: the social frames, the answer to people-list, and the room's presence and error frames. */
type Incoming = SocialPushFrame | PeopleFrame | PresenceFrame | ErrorFrame | LiveServerFrame

/** The refusal sentence for a failed request (the server's own wording when it explained one). */
export function failureReason(error: ApiError): string {
  const status = error.status ?? 0
  return error.reason && status >= 400 && status < 500 && status !== 401 && status !== 429 ? error.reason
    : status === 503 && error.reason ? error.reason // the server could not save (or take) this: its own sentence says nothing was changed
      : status === 429 ? 'Too many requests. Wait a minute and try again.'
        : status === 401 ? 'Your device session expired. Reconnect to continue.'
          : error.code === 'onboarding_required' ? 'Choose your look and tap Play first. People and messages open as soon as you are in the city.'
            : status === 409 ? 'That was already sent with different details. Try again.'
              : status >= 400 && status < 500 ? 'That request was not accepted. Check what you typed.'
                : 'Connection lost. Nothing was changed; try again.'
}

export function createSocialClient(overrides: Partial<SocialEnv> = {}) {
  const env: SocialEnv = { ...browserEnv(), ...overrides }
  const outbox = createOutbox()
  const state = reactive<SocialState>({
    me: null, loading: false, error: null, socket: 'idle',
    people: null, peopleAt: 0, peopleLoading: false, friendsLoading: false,
    threads: new Map(), profiles: new Map(), openConv: null, knock: null, linkHost: null, houseRoom: null, live: freshLive(),
  })
  /** Counts every change: reading it makes a computed follow the (not reactive) outbox. */
  const revision = ref(0)
  let api: PanelApi | null = null
  let joiningHouse: string | null = null
  let ws: SocketLike | null = null
  let attempts = 0
  let timer: unknown = null
  let started = false
  let syncing = false
  let dirty = false
  let peopleDirty = false
  let profileVersion = 0
  const peopleWatchers = new Set<(people: PeopleState | null) => void>()
  /** Other features that share this socket (calls): they get every frame whose type starts with their prefix, and are told when it closes. */
  const frameListeners = new Set<(frame: { type: string }) => void>()
  const closeListeners = new Set<(code?: number) => void>()
  /** The game's own listeners (one character on several devices): the life changed on the server, and the socket opened. */
  const lifeListeners = new Set<(hint: { rev: number; by?: readonly string[] }) => void>()
  const openListeners = new Set<(again: boolean) => void>()
  let opened = 0

  const liveWatchers = new Set<() => void>()
  /** What the server was last asked to watch: the city and the friends (a change of either is asked again). */
  let liveAsked = ''
  /** Server time minus this device's, from the live frames: a friend's trip is timed by the server's clock. */
  let liveOffset: number | null = null
  let liveTimer: unknown = null

  /** Call `listener` whenever the who-is-here listing changes (the scene host draws its crowd from it). */
  function onPeople(listener: (people: PeopleState | null) => void): () => void { peopleWatchers.add(listener); return () => peopleWatchers.delete(listener) }
  const peopleChanged = (): void => { for (const listener of peopleWatchers) { try { listener(state.people) } catch (error) { console.error('People watcher failed:', error) } } }

  /** Call `listener` whenever where friends are, or the city's counts, changed (the scene host draws the map's pins from it). */
  function onLive(listener: () => void): () => void { liveWatchers.add(listener); return () => liveWatchers.delete(listener) }
  /** The server's clock, as the live frames have shown it (the game's own server time until one has arrived). */
  const liveNow = (): number => (liveOffset === null ? api?.view().now ?? env.now() : env.now() + liveOffset)
  /**
   * Write what the live table says over every friend row and friend card, tell the map, and book ONE follow-up for the
   * next moment a spot reads differently by the clock alone (a trip reaching its door, a dropped connection becoming offline).
   */
  function showLive(redraw = true): void {
    const now = liveNow()
    let next = Infinity
    for (const spot of state.live.friends.values()) {
      if (spot.trip) { const end = spot.trip.startedAt + spot.trip.duration * 1000; if (end > now) next = Math.min(next, end) }
      if (spot.status === 'reconnecting' && typeof spot.seenAt === 'number' && spot.seenAt + LIVE_GRACE_MS > now) next = Math.min(next, spot.seenAt + LIVE_GRACE_MS)
    }
    for (const friend of state.me?.friends ?? []) { const spot = state.live.friends.get(friend.id); if (spot) applyWhereabouts(friend, whereabouts(spot, now)) }
    for (const [id, card] of state.profiles) { const spot = state.live.friends.get(id); if (spot && !('error' in card) && card.friend) applyWhereabouts(card, whereabouts(spot, now)) }
    env.clearTimeout(liveTimer); liveTimer = null
    if (Number.isFinite(next)) liveTimer = env.setTimeout(() => { liveTimer = null; showLive() }, Math.max(50, next - now + 50))
    for (const listener of liveWatchers) { try { listener() } catch (error) { console.error('Live watcher failed:', error) } }
    if (redraw) refresh()
  }
  /** Ask the server to watch this city and these friends; asked again only when one of the two changed. */
  function watchLive(force = false): void {
    if (ws?.readyState !== 1 || state.socket !== 'open' || !connected() || !cityId()) return
    const asked = `${cityId()}|${(state.me?.friends ?? []).map((friend) => friend.id).sort().join()}`
    if (!force && asked === liveAsked) return
    liveAsked = asked
    ws.send(JSON.stringify({ type: 'live-watch', cityId: cityId() }))
  }
  function dropLive(): void {
    env.clearTimeout(liveTimer); liveTimer = null; liveAsked = ''
    if (!state.live.friends.size && !state.live.city) return
    state.live = freshLive()
    for (const listener of liveWatchers) { try { listener() } catch (error) { console.error('Live watcher failed:', error) } }
  }

  function refresh(): void { revision.value += 1; api?.refresh() }
  // Until a new life has finished character creation it is not in the city: the social features stay closed.
  function connected(): boolean { const view = api?.view(); return Boolean(view?.connected) && view?.onboarding?.required !== true }
  const cityId = (): string => api?.view().cityId ?? ''
  /** A retry key in the form the server's exactly-once writes require: `<server ms>:<uuid>` (also valid as a message's clientId). */
  const newClientId = (): string => api?.newId() ?? ''

  /** One request. Never throws: a failure comes back as { ok: false, code, reason }. */
  async function call<T = Record<string, unknown>>(path: string, body?: unknown): Promise<SocialResult<T>> {
    try {
      if (!api) throw new Error('The social client has not been started.')
      return await api.fetchJson<SocialResult<T>>(path, body ? { method: 'POST', body } : undefined)
    } catch (caught) {
      const error = caught as ApiError
      return { ok: false, code: error.code || 'network', reason: failureReason(error), transport: !error.status }
    }
  }

  /** A request the player asked for: toast the reason when refused, then re-read the overview. */
  async function perform<T = Record<string, unknown>>(path: string, body?: unknown, good?: string | null | ((result: { ok: true } & T) => string)): Promise<SocialResult<T>> {
    const result = await call<T>(path, body)
    if (!result.ok) api?.toast(result.reason, 'error')
    else if (good) api?.toast(typeof good === 'function' ? good(result) : good, 'good')
    await sync()
    return result
  }

  /** Re-read the life after the server changed it outside /api/action (a gift, a new friend). */
  function refreshLife(): void { if (connected()) void api?.command('social.sync') }

  async function sync(): Promise<void> {
    if (!connected()) return
    if (syncing) { dirty = true; return }
    syncing = true; state.loading = !state.me
    const result = await call<SocialOverview>('/api/social/me')
    syncing = false; state.loading = false
    if (result.ok) {
      state.me = result; state.error = null
      if (state.knock?.status === 'accepted' && result.visiting?.host.id !== state.knock.host) state.knock = null
      joinHouse()
      // The overview's places are as old as its read: what the live frames say stands, and a new friend is watched.
      showLive(false); watchLive()
    } else state.error = result.reason
    refresh()
    if (dirty) { dirty = false; void sync() }
  }

  /** The founder's next page of automatic friends, added to the overview's list. The next read of the overview starts from its first page again. */
  async function loadMoreFriends(): Promise<void> {
    const after = state.me?.friendsMore?.next
    if (!connected() || !after || state.friendsLoading) return
    state.friendsLoading = true
    const result = await call<{ friends: Friend[]; total: number; next: string | null }>(`/api/social/friends?after=${encodeURIComponent(after)}`)
    state.friendsLoading = false
    // An overview read meanwhile has replaced the list: this page belongs to the one before it.
    if (!result.ok || !state.me || state.me.friendsMore?.next !== after) return
    const known = new Set(state.me.friends.map((friend) => friend.id))
    state.me.friends.push(...result.friends.filter((friend) => !known.has(friend.id)))
    state.me.friendsMore = { total: result.total, next: result.next }
    refresh()
  }

  async function loadPeople(): Promise<void> {
    if (!connected()) return
    // A change that arrives while a read is in flight is read again afterwards, never dropped.
    if (state.peopleLoading) { peopleDirty = true; return }
    state.peopleLoading = true
    const result = await call<PeopleListing>(`/api/social/people?city=${encodeURIComponent(cityId())}`)
    state.peopleLoading = false
    state.people = result.ok ? result : { error: result.reason }
    state.peopleAt = api?.view().now ?? 0
    peopleChanged()
    refresh()
    if (peopleDirty) { peopleDirty = false; void loadPeople() }
  }
  /** Ask the server to tell this socket when who-is-here changes (it answers with the current listing). */
  function watchPeople(): void { if (ws?.readyState === 1 && connected()) ws.send(JSON.stringify({ type: 'people-list', cityId: cityId() })) }

  async function loadProfile(id: string): Promise<void> {
    const version = profileVersion
    const result = await call<{ player: PersonCard }>(`/api/social/players/${encodeURIComponent(id)}`)
    if (version !== profileVersion) return // An older response must not restore invalidated friendship details.
    state.profiles.set(id, result.ok ? result.player : { error: result.reason })
    showLive(false)
    refresh()
  }

  // ---- messages ---------------------------------------------------------------------------
  function threadOf(id: string): ThreadRecord {
    if (!state.threads.has(id)) state.threads.set(id, { messages: [], loaded: false, error: null })
    return state.threads.get(id) as ThreadRecord // set just above
  }
  function noteConv(conv: Conversation): void {
    if (!state.me) return
    state.me.conversations = [conv, ...state.me.conversations.filter((item) => item.id !== conv.id)]
  }
  async function openThread(id: string): Promise<void> {
    const thread = threadOf(id)
    const last = thread.messages.at(-1)?.seq ?? 0
    const result = await call<{ conv: Conversation; messages: Message[] }>(`/api/social/conversations/${encodeURIComponent(id)}${thread.loaded ? `?after=${last}` : ''}`)
    if (result.ok) { thread.messages = mergeMessages(thread.messages, result.messages); thread.loaded = true; thread.error = null; noteConv(result.conv); if (result.conv.unread) void markRead(id) }
    else thread.error = result.reason
    refresh()
  }
  async function markRead(id: string): Promise<void> {
    const result = await call<{ conv: Conversation }>(`/api/social/conversations/${encodeURIComponent(id)}/read`, {})
    if (result.ok) { noteConv(result.conv); refresh() }
  }
  /** The messages to show for a conversation key: confirmed ones, then anything still pending or failed. */
  function threadView(key: string): ThreadItem[] { void revision.value; return outbox.thread(key, state.threads.get(key)?.messages ?? []) }

  async function deliver(entry: { clientId: string; key: string; body: string; target?: SendTarget }): Promise<void> {
    // The entry's key moves when a push adopts the new chat while this request is in flight, so the key it was sent under is read now.
    const sentUnder = entry.key
    const guard = env.setTimeout(() => { if (outbox.expire(env.now())) refresh() }, SEND_TIMEOUT_MS + 50)
    const result = await call<{ conv: Conversation; message: Message }>('/api/social/messages', { ...entry.target, body: entry.body, clientId: entry.clientId })
    env.clearTimeout(guard)
    if (result.ok) {
      const thread = threadOf(result.conv.id)
      thread.messages = mergeMessages(thread.messages, [result.message])
      if (sentUnder !== result.conv.id) { if (state.openConv === sentUnder) state.openConv = result.conv.id; outbox.rekey(sentUnder, result.conv.id) }
      // A new chat has no history read yet, whichever of this answer and the push reached the client first.
      if (!thread.loaded && (sentUnder !== result.conv.id || state.openConv === result.conv.id)) void openThread(result.conv.id)
      outbox.confirm(entry.clientId)
      noteConv(result.conv)
    } else outbox.fail(entry.clientId, result.reason, result.code)
    refresh()
  }
  /** Queue a message: it shows at once as pending, then becomes sent or failed. `target` is { to } or { conv }. */
  function send(key: string, target: SendTarget, body: string): void {
    const entry = outbox.add(key, body, newClientId(), env.now())
    entry.target = target
    refresh()
    void deliver(entry)
  }
  /** Send a failed message again under the same client id, so the server stores it at most once. */
  function retry(clientId: string): void {
    const entry = outbox.retry(clientId, env.now())
    if (!entry) return
    refresh()
    void deliver(entry)
  }
  function discard(clientId: string): void { outbox.discard(clientId); refresh() }

  /**
   * While the server lists an accepted visit, this socket joins the HOST's Home room (the server
   * admits it only from its own guest list). That gives truthful presence in the house; the house
   * chat itself is the conversation in Messages. Presence and text only: nothing here touches voice.
   */
  function joinHouse(): void {
    const visit = state.me?.visiting
    if (!visit || !visit.cityId) { if (state.houseRoom) state.houseRoom = null; joiningHouse = null; return }
    if (state.houseRoom?.host === visit.host.id || joiningHouse === visit.host.id || ws?.readyState !== 1) return
    joiningHouse = visit.host.id
    ws.send(JSON.stringify({ type: 'join', cityId: visit.cityId, venueId: 'home', hostId: visit.host.id }))
  }

  // ---- live pushes ------------------------------------------------------------------------
  function receive(event: { data: unknown }): void {
    let message: Incoming
    try { message = JSON.parse(String(event.data)) as Incoming } catch { return }
    if (!message || typeof message.type !== 'string') return
    // The Worker's liveness probe: answered at once, or the social socket is closed as idle.
    if ((message.type as string) === 'heartbeat') { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'heartbeat-ack' })); return }
    if (message.type.startsWith('call-')) { for (const listener of [...frameListeners]) listener(message); return }
    // The player's life changed on the server (an action on another of their devices, a settlement): the game reads it again.
    if ((message.type as string) === 'life-changed') { const hint = message as unknown as { rev?: unknown; by?: unknown }; if (typeof hint.rev === 'number') for (const listener of [...lifeListeners]) listener({ rev: hint.rev, ...(Array.isArray(hint.by) ? { by: hint.by.filter((id): id is string => typeof id === 'string') } : {}) }); return }
    switch (message.type) {
      case 'dm': {
        if (!message.conv || !message.message) return
        const thread = threadOf(message.conv.id)
        thread.messages = mergeMessages(thread.messages, [message.message])
        noteConv(message.conv)
        if (message.conv.with) {
          // The other player can create this conversation while its empty draft is open here: the open
          // new chat becomes the real one, and a reply waiting to be sent follows it.
          const provisional = `to:${message.conv.with}`
          if (state.openConv === provisional) state.openConv = message.conv.id
          outbox.rekey(provisional, message.conv.id)
          if (state.openConv === message.conv.id && !thread.loaded) void openThread(message.conv.id)
        }
        const mine = message.message.from?.id === state.me?.me.id
        if (state.openConv === message.conv.id) { if (!mine) void markRead(message.conv.id) }
        else if (!mine && !message.message.sys) api?.toast(`New message from ${message.message.from?.name ?? message.conv.name}`)
        refresh()
        return
      }
      case 'social-update': {
        if (!message.update) return
        const update = message.update
        if (state.me) state.me.updates = [update, ...state.me.updates.filter((item) => item.id !== update.id)]
        api?.toast(String(update.text ?? ''))
        refresh()
        return
      }
      case 'presence': {
        // Only ever received for a host's Home room this socket joined as a guest.
        if (!Array.isArray(message.members)) return
        const host = joiningHouse ?? state.houseRoom?.host
        if ((joiningHouse || state.houseRoom) && host) { state.houseRoom = { host, members: message.members.map((member) => ({ id: member.id, name: member.name })) }; joiningHouse = null; refresh() }
        return
      }
      case 'error': {
        if (!['visit_ended', 'not_a_guest', 'venue_mismatch'].includes(message.code)) return
        state.houseRoom = null; joiningHouse = null
        void sync()
        return
      }
      case 'people': {
        if (!message.ok) return
        state.people = message; state.peopleAt = api?.view().now ?? 0
        peopleChanged(); refresh()
        return
      }
      case 'people-changed':
        void loadPeople()
        return
      case 'live-snapshot':
        liveOffset = Number.isFinite(message.at) ? message.at - env.now() : liveOffset
        takeSnapshot(state.live, message)
        showLive()
        return
      case 'live-move':
        // The largest reading is the one with the least delay in it.
        if (Number.isFinite(message.at)) liveOffset = Math.max(liveOffset ?? -Infinity, message.at - env.now())
        takeMove(state.live, message)
        showLive()
        return
      case 'people-presence': {
        const friend = state.me?.friends.find((item) => item.id === message.id)
        // A friend the live frames report on is written from those; this older frame only books the follow-up read.
        if (friend && !state.live.friends.has(friend.id)) { friend.status = message.status === 'online' ? 'away' : 'reconnecting'; delete friend.venue; refresh() }
        // One follow-up read settles "reconnecting" into online or offline once the grace period is over.
        env.setTimeout(() => { void sync(); if (state.people) void loadPeople() }, message.status === 'online' ? 1500 : 22000)
        return
      }
      case 'people-interaction':
        api?.toast(`${message.from?.name ?? 'Someone'}: ${message.label ?? 'said hello'}${message.landed === false ? ' (it flopped)' : ''}`)
        return
      case 'invite-answer':
        if (state.knock && state.knock.host === message.host?.id) state.knock = { ...state.knock, status: message.answer === 'accepted' ? 'accepted' : 'declined' }
        void sync()
        return
      case 'transfer':
        refreshLife(); void sync()
        return
      case 'social-read': {
        // Read on another device of this player: the same badge clears here, in place and without a request.
        if (!state.me) return
        const conv = message.conv
        if (conv) state.me.conversations = state.me.conversations.map((item) => (item.id === conv.id ? conv : item))
        if (message.updates) for (const update of state.me.updates) update.read = true
        refresh()
        return
      }
      case 'social-changed':
        // This player's own request, made on any of their devices, changed their friends, groups, blocks or visits.
        profileVersion += 1; state.profiles.clear()
        void sync()
        return
      case 'social-sync': case 'friend-request': case 'friend-accepted': case 'invite-knock': case 'invite-house':
        if (message.type === 'social-sync' || message.type === 'friend-request' || message.type === 'friend-accepted') { profileVersion += 1; state.profiles.clear() }
        if (message.type === 'social-sync') refreshLife()
        void sync()
        return
      case 'ping-incoming': case 'ping-joined': case 'ping-ended':
        // A friend's ping (features/ping): shown by its own notices, which listen beside the calls.
        for (const listener of [...frameListeners]) listener(message)
        return
      default:
    }
  }

  function connectSocket(): void {
    env.clearTimeout(timer); timer = null
    if (ws || !connected()) return
    state.socket = attempts ? 'reconnecting' : 'connecting'
    const current = ws = env.openSocket()
    current.onopen = () => {
      attempts = 0; state.socket = 'open'; for (const [id, thread] of state.threads) if (thread.loaded) void openThread(id); void sync(); watchPeople(); watchLive(true)
      opened += 1
      for (const listener of [...openListeners]) listener(opened > 1)
    }
    current.onmessage = receive
    current.onclose = (event) => {
      if (ws !== current) return
      ws = null; state.houseRoom = null; joiningHouse = null
      dropLive() // what is known is going stale: the next connection starts from a snapshot
      for (const listener of [...closeListeners]) listener(event?.code)
      if (connected() && attempts < MAX_ATTEMPTS) { state.socket = 'reconnecting'; timer = env.setTimeout(connectSocket, Math.min(1000 * 2 ** attempts, 15000)); attempts += 1 }
      else state.socket = 'offline'
      refresh()
    }
  }
  /** Manual reconnect after the automatic attempts ran out. */
  function reconnect(): void { attempts = 0; connectSocket(); refresh() }
  /** The page is in front again, or the device is back online: a socket that was lost meanwhile is opened now, not at the next back-off. */
  function wakeSocket(): void { if (started && !ws && connected()) reconnect() }

  /**
   * The device session changed (a new life was started, or the old one is gone): everything this client holds belonged to the
   * previous identity. It is dropped at once — friends, requests, threads, profiles, a knock, the house room and unsent
   * messages — and the socket (opened with the old cookie) is closed so the next one is the new identity's.
   */
  function resetSocial(): void {
    Object.assign(state, freshSocial())
    outbox.clear()
    env.clearTimeout(liveTimer); liveTimer = null; liveAsked = ''; liveOffset = null
    for (const listener of liveWatchers) { try { listener() } catch (error) { console.error('Live watcher failed:', error) } }
    joiningHouse = null; syncing = false; dirty = false; peopleDirty = false; profileVersion += 1; attempts = 0; opened = 0
    env.clearTimeout(timer); timer = null
    const old = ws; ws = null
    state.socket = 'idle'; state.friendsLoading = false
    for (const listener of [...closeListeners]) listener()
    try { old?.close() } catch { /* already closed */ }
    peopleChanged()
  }

  /** Send one frame on the open socket; false when there is none. */
  function sendFrame(frame: object): boolean {
    if (ws?.readyState !== 1) return false
    ws.send(JSON.stringify(frame))
    return true
  }
  /** Call `listener` with every `call-*` frame the socket receives. */
  function onCallFrame(listener: (frame: { type: string }) => void): () => void { frameListeners.add(listener); return () => frameListeners.delete(listener) }
  /** Call `listener` whenever the socket closes (also when the identity changed), with the server's close code when there is one. */
  function onSocketClose(listener: (code?: number) => void): () => void { closeListeners.add(listener); return () => closeListeners.delete(listener) }
  /** Call `listener` with every `life-changed` frame (src/types/protocol.ts): the server's hint that the player's life changed. */
  function onLifeFrame(listener: (hint: { rev: number; by?: readonly string[] }) => void): () => void { lifeListeners.add(listener); return () => lifeListeners.delete(listener) }
  /** Call `listener` whenever the socket opens; `again` is true when it had been open before for this identity (a reconnection). */
  function onSocketOpen(listener: (again: boolean) => void): () => void { openListeners.add(listener); return () => openListeners.delete(listener) }

  /** The landing of a brand-new visitor handled the invite link itself (src/life-main.js landJoin): do not also open the Invite app for it. */
  function takeLinkHost(): string | null { const host = state.linkHost; state.linkHost = null; return host }

  /** Give the client the host's api without opening anything (what a test or a badge needs). */
  function attach(host: PanelApi): void { api = host }
  /** Called by every social screen when it shows: idempotent. */
  function start(host: PanelApi): void {
    attach(host)
    if (!started) {
      started = true
      const address = env.pageAddress()
      state.linkHost = inviteIdFrom(address.pathname) || inviteIdFrom(address.search)
      env.onOnline(() => { if (!ws) reconnect() })
    }
    if (!connected()) return
    if (!ws && state.socket !== 'offline' && !timer) connectSocket()
    if (!state.me && !state.loading && !state.error) void sync()
    if (state.linkHost && state.me) {
      const hostId = state.linkHost; state.linkHost = null
      env.clearAddress()
      host.open('invite', { host: hostId })
    }
  }

  return { state, revision: revision as Readonly<Ref<number>>, outbox, onPeople, onLive, liveNow, watchLive, sendFrame, onCallFrame, onSocketClose, onLifeFrame, onSocketOpen, wakeSocket, cityId, newClientId, call, perform, refreshLife, sync, loadMoreFriends, loadPeople, loadProfile, openThread, threadView, send, retry, discard, reconnect, resetSocial, takeLinkHost, attach, start }
}
export type SocialClient = ReturnType<typeof createSocialClient>
