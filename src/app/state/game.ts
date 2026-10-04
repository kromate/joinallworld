// The game store: the browser's read-only mirror of the server-held life, as Vue state.
//
// It owns one client model (src/client.js through its typed contract) and republishes what that
// model reports — the accepted state, the link, the status line, the storage notice, the session —
// as refs. The transport is not reimplemented here: timed action ids, exactly-once retries, the
// server time offset and the six link states are the client model's, unchanged.
//
// The server is authoritative. Nothing here applies a rule: `command()` sends one action and the
// state changes only when the server's answer is accepted.
import { computed, ref, shallowRef } from 'vue'
import type { ComputedRef, Ref, ShallowRef } from 'vue'
import type { LifeState } from '../../types/life.ts'
import type { CityId, PublicSession } from '../../types/protocol.ts'
import type { PlayerActionType } from '../../types/actions.ts'
import type { ClientOptions, CommandArgs, CommandResult, FetchJson, GameClient, LinkState, NameProblem, NetStatus, StorageProblem, SwitchCityResult } from '../types/client.ts'
import type { PanelView, ShellMode, ToastKind } from '../types/panel.ts'
import { CITIES, VENUES, createClient, venueDistrict, venueLabel, viewLife } from '../legacy/engine.ts'
import { toast as sharedToast } from './toasts.ts'

const clockFormat = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })

export interface GameEvents {
  /** After every accepted server state (also when only the link or the storage notice changed: then `previous === state`). */
  accepted: (state: LifeState, previous: LifeState) => void
  /** No session yet: ask for a nickname. */
  needName: (problem: NameProblem | null) => void
  /** The server no longer knows this browser's session. */
  expired: () => void
  /** A session was established or replaced. */
  session: (session: PublicSession, created: boolean) => void
}

export interface Game {
  /** The server's life state. Replaced, never mutated: read-only for every component. */
  state: ShallowRef<LifeState>
  /** Derived display data for the current state and shell mode. */
  view: ComputedRef<PanelView>
  link: Ref<LinkState>
  /** True when connected with a session: the one flag for "can anything change". */
  connected: ComputedRef<boolean>
  net: Ref<NetStatus>
  storage: ShallowRef<StorageProblem | null>
  session: ShallowRef<PublicSession | null>
  cityId: Ref<CityId>
  /** Actions sent and not yet answered. */
  saving: Ref<number>
  mode: Ref<ShellMode>
  /** One server action. Offline or busy: nothing is sent and nothing changes. A refusal's reason is shown as a toast. */
  command<T extends PlayerActionType>(type: T, ...args: CommandArgs<T>): Promise<CommandResult<T>>
  connect(createNew?: boolean, name?: string | null): Promise<boolean>
  switchCity(id: string): Promise<SwitchCityResult>
  refresh(): Promise<boolean>
  fetchJson: FetchJson
  newId(): string
  serverNow(): number
  toast(text: unknown, kind?: ToastKind): void
  on<K extends keyof GameEvents>(event: K, listener: GameEvents[K]): () => void
  /** The page is going away or was hidden: stop polling. */
  stop(): void
  /** The underlying client model, for diagnostics and tests. */
  client: GameClient
}

export interface GameOptions extends Pick<ClientOptions, 'fetch' | 'storage' | 'now' | 'setTimeout' | 'clearTimeout' | 'randomUUID' | 'isHidden' | 'isOnline'> {
  toast?: (text: unknown, kind?: ToastKind) => void
}

export function createGame(options: GameOptions = {}): Game {
  const { toast = sharedToast, ...clientOptions } = options
  const listeners: { [K in keyof GameEvents]: Set<GameEvents[K]> } = { accepted: new Set(), needName: new Set(), expired: new Set(), session: new Set() }
  function emit<K extends keyof GameEvents>(event: K, ...args: Parameters<GameEvents[K]>): void {
    for (const listener of listeners[event]) (listener as (...values: Parameters<GameEvents[K]>) => void)(...args)
  }

  const net = ref<NetStatus>({ text: 'Connecting…', error: false })
  const mode = ref<ShellMode>('venue')
  const saving = ref(0)
  /** Bumped whenever the client model reports anything, so the refs below are re-read from it. */
  let lastMessage: string | null = null
  let lastLife = ''

  const client: GameClient = createClient({
    ...clientOptions,
    onStatus(text, error) { net.value = { text, error } },
    onChange(next, previous) { publish(); announce(next); emit('accepted', next, previous) },
    onSessionExpired() { publish(); emit('expired') },
    onNeedName(problem) { publish(); emit('needName', problem ?? null) },
    onSession(session, created) { publish(); emit('session', session, created) },
  })

  const state = shallowRef<LifeState>(client.state)
  const link = ref<LinkState>(client.link)
  const storage = shallowRef<StorageProblem | null>(client.storage)
  const session = shallowRef<PublicSession | null>(client.session)
  const cityId = ref<CityId>(client.cityId)
  const online = ref(client.online)
  const connected = computed(() => online.value)

  /** Copy what the client model holds into the refs. Cheap: each ref only notifies when its value changed. */
  function publish(): void {
    state.value = client.state
    link.value = client.link
    storage.value = client.storage
    session.value = client.session
    cityId.value = client.cityId
    online.value = client.online
  }

  /** What the server last said becomes a toast when it changes; it never sits on the scene. */
  function announce(next: LifeState): void {
    const life = `${client.session?.id ?? ''}:${client.cityId}`
    if (life !== lastLife) { lastLife = life; lastMessage = null }
    const text = next.message || ''
    const active = next.activeAction
    const activity = active ? view.value.activities?.active?.label ?? '' : ''
    if (lastMessage !== null && text && text !== lastMessage && !(active && (text === activity || text.startsWith('Travelling to ')))) toast(text)
    lastMessage = text
  }

  const view = computed<PanelView>(() => {
    const life = state.value, city = cityId.value
    const now = client.serverNow()
    return {
      ...viewLife(life, { now, cityId: city }),
      cityId: city, city: CITIES[city], connected: online.value, link: link.value, session: session.value, net: net.value, storage: storage.value,
      // The life's own name (the server keeps it equal to the session nickname), so a rename shows as soon as the next state arrives.
      name: life.name || client.identity.name, now,
      clock: clockFormat.format(new Date(now)).replace(',', ' ·'),
      venues: Object.values(VENUES).map((item) => ({ id: item.id, label: venueLabel(item.id, city), district: venueDistrict(item.id, city), icon: item.icon, description: item.description })),
      mode: mode.value, params: null,
    }
  })

  async function command<T extends PlayerActionType>(type: T, ...args: CommandArgs<T>): Promise<CommandResult<T>> {
    saving.value += 1
    try {
      const result = await client.command(type, args[0]) as CommandResult<T>
      publish()
      if (!result.ok && result.reason && result.code !== 'busy') toast(result.reason, 'error')
      return result
    } finally { saving.value -= 1 }
  }

  let connecting = false
  async function connect(createNew = false, name: string | null = null): Promise<boolean> {
    if (connecting) return false
    connecting = true
    try {
      if (name) client.identity.name = name
      const pending = client.connect(createNew)
      publish()
      const ok = await pending
      publish()
      return ok
    } finally { connecting = false }
  }

  async function switchCity(id: string): Promise<SwitchCityResult> {
    const result = await client.switchCity(id)
    publish()
    if (!result.ok && result.reason) toast(result.reason, 'error')
    return result
  }

  return {
    state, view, link, connected, net, storage, session, cityId, saving, mode,
    command, connect, switchCity,
    async refresh() { const ok = client.online ? await client.refresh() : false; publish(); return ok },
    fetchJson: (path, fetchOptions) => client.fetchJson(path, fetchOptions),
    newId: () => client.newId(),
    serverNow: () => client.serverNow(),
    toast,
    on(event, listener) { listeners[event].add(listener); return () => { listeners[event].delete(listener) } },
    stop: () => client.stop(),
    client,
  }
}

let shared: Game | null = null
/** The one game of this page. Created on first use, so importing this module touches nothing. */
export function useGame(): Game {
  if (!shared) {
    let storage: Storage | null = null
    try { storage = globalThis.localStorage ?? null } catch { storage = null }
    shared = createGame({ storage, isHidden: () => globalThis.document?.hidden === true })
  }
  return shared
}
