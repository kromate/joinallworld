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
// `state` is reactive (a component that reads it follows it) and every change also calls the
// host's refresh(), so the existing panels and the registry's badge() functions, which are not
// reactive, redraw as before. `revision` counts those changes for anything that reads the outbox,
// which is not reactive (threadView()).
import { reactive, ref } from 'vue'
import type { Ref } from 'vue'
import { createOutbox, freshSocial, inviteIdFrom, mergeMessages, SEND_TIMEOUT_MS } from '../../../game/social-model.ts'
import type { ThreadRecord } from '../../../game/social-model.ts'
import type { ErrorFrame, PresenceFrame } from '../../../types/protocol.ts'
import type { Conversation, KnockState, Message, PeopleFrame, PeopleListing, PersonCard, SocialOverview, SocialPushFrame, ThreadItem } from '../../../types/social.ts'
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
}

/** The socket, as far as this client uses it. */
export interface SocketLike {
  readyState: number
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
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
type Incoming = SocialPushFrame | PeopleFrame | PresenceFrame | ErrorFrame

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
    people: null, peopleAt: 0, peopleLoading: false,
    threads: new Map(), profiles: new Map(), openConv: null, knock: null, linkHost: null, houseRoom: null,
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

  /** Call `listener` whenever the who-is-here listing changes (the scene host draws its crowd from it). */
  function onPeople(listener: (people: PeopleState | null) => void): () => void { peopleWatchers.add(listener); return () => peopleWatchers.delete(listener) }
  const peopleChanged = (): void => { for (const listener of peopleWatchers) { try { listener(state.people) } catch (error) { console.error('People watcher failed:', error) } } }

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
    } else state.error = result.reason
    refresh()
    if (dirty) { dirty = false; void sync() }
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
    const guard = env.setTimeout(() => { if (outbox.expire(env.now())) refresh() }, SEND_TIMEOUT_MS + 50)
    const result = await call<{ conv: Conversation; message: Message }>('/api/social/messages', { ...entry.target, body: entry.body, clientId: entry.clientId })
    env.clearTimeout(guard)
    if (result.ok) {
      const thread = threadOf(result.conv.id)
      thread.messages = mergeMessages(thread.messages, [result.message])
      const provisional = entry.key
      if (provisional !== result.conv.id) { if (state.openConv === provisional) state.openConv = result.conv.id; outbox.rekey(provisional, result.conv.id); if (!thread.loaded) void openThread(result.conv.id) }
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
      case 'people-presence': {
        const friend = state.me?.friends.find((item) => item.id === message.id)
        if (friend) { friend.status = message.status === 'online' ? 'away' : 'reconnecting'; delete friend.venue; refresh() }
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
      case 'social-sync': case 'friend-request': case 'friend-accepted': case 'invite-knock': case 'invite-house':
        if (message.type === 'social-sync' || message.type === 'friend-request' || message.type === 'friend-accepted') { profileVersion += 1; state.profiles.clear() }
        if (message.type === 'social-sync') refreshLife()
        void sync()
        return
      default:
    }
  }

  function connectSocket(): void {
    env.clearTimeout(timer); timer = null
    if (ws || !connected()) return
    state.socket = attempts ? 'reconnecting' : 'connecting'
    const current = ws = env.openSocket()
    current.onopen = () => { attempts = 0; state.socket = 'open'; for (const [id, thread] of state.threads) if (thread.loaded) void openThread(id); void sync(); watchPeople() }
    current.onmessage = receive
    current.onclose = () => {
      if (ws !== current) return
      ws = null; state.houseRoom = null; joiningHouse = null
      if (connected() && attempts < MAX_ATTEMPTS) { state.socket = 'reconnecting'; timer = env.setTimeout(connectSocket, Math.min(1000 * 2 ** attempts, 15000)); attempts += 1 }
      else state.socket = 'offline'
      refresh()
    }
  }
  /** Manual reconnect after the automatic attempts ran out. */
  function reconnect(): void { attempts = 0; connectSocket(); refresh() }

  /**
   * The device session changed (a new life was started, or the old one is gone): everything this client holds belonged to the
   * previous identity. It is dropped at once — friends, requests, threads, profiles, a knock, the house room and unsent
   * messages — and the socket (opened with the old cookie) is closed so the next one is the new identity's.
   */
  function resetSocial(): void {
    Object.assign(state, freshSocial())
    outbox.clear()
    joiningHouse = null; syncing = false; dirty = false; peopleDirty = false; profileVersion += 1; attempts = 0
    env.clearTimeout(timer); timer = null
    const old = ws; ws = null
    state.socket = 'idle'
    try { old?.close() } catch { /* already closed */ }
    peopleChanged()
  }

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

  return { state, revision: revision as Readonly<Ref<number>>, outbox, onPeople, cityId, newClientId, call, perform, refreshLife, sync, loadPeople, loadProfile, openThread, threadView, send, retry, discard, reconnect, resetSocial, takeLinkHost, attach, start }
}
export type SocialClient = ReturnType<typeof createSocialClient>
