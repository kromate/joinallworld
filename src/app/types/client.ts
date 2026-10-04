// The client model's contract: what src/client.js exposes, as the new shell uses it. The module
// itself is still JavaScript (src/app/legacy/modules.ts casts it to these types); when it is
// converted these become its own declarations.
import type { ActionMap, ActionType, PlayerActionType } from '../../types/actions.ts'
import type { LifeState } from '../../types/life.ts'
import type { CityId, OwnSession } from '../../types/protocol.ts'

/**
 * WHY the game is or is not playable. "Offline" is said only for 'offline'.
 *   connecting   a connection attempt is in flight
 *   online       connected; the server holds this life
 *   new          the server is up and this browser has never had a life here (ask for a nickname)
 *   expired      the server is up but does not know this browser's session (401) while a life is cached here
 *   offline      this device has no network
 *   unreachable  the device is online but the server did not answer (down, timed out, 5xx)
 */
export type LinkState = 'connecting' | 'online' | 'new' | 'expired' | 'offline' | 'unreachable'
export const LINK_STATES = ['connecting', 'online', 'new', 'expired', 'offline', 'unreachable'] as const satisfies readonly LinkState[]

/** Set from the moment the server says it cannot save (`storage: "failing"`, or 503 storage_unavailable). */
export interface StorageProblem { reason: string }
/** The connection status line. */
export interface NetStatus { text: string; error: boolean }
/** Why POST /api/session refused the nickname just tried. */
export interface NameProblem { code: 'name_not_allowed' | 'invalid_name' | 'muted'; reason: string; name: string }
export interface City { id: CityId; name: string; region: string }

/** What `fetchJson` rejects with. A network failure has no status. */
export interface ApiError extends Error {
  status?: number
  code?: string
  /** The sentence the server wrote for the player. */
  reason?: string
}
export interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** An object is sent as JSON. */
  body?: unknown
  headers?: Record<string, string>
}
export type FetchJson = <T = Record<string, unknown>>(path: string, options?: FetchOptions) => Promise<T>

/** Codes `command()` produces itself, before or instead of the engine's. Any other string is the server's. */
export type TransportCode = 'busy' | 'offline' | 'storage_unavailable' | 'network'
/** One action's outcome. On failure `reason` is the sentence to show. */
export type CommandResult<T extends ActionType = ActionType> =
  | { ok: true; code: ActionMap[T]['ok']; reason?: undefined }
  | { ok: false; code: ActionMap[T]['fail'] | TransportCode | (string & {}); reason?: string }
/** The payload argument of `command(type, payload)`: optional exactly when the action reads none. */
export type CommandArgs<T extends ActionType> = Record<string, never> extends ActionMap[T]['payload']
  ? [payload?: ActionMap[T]['payload'] | null]
  : [payload: ActionMap[T]['payload']]
export type Command = <T extends PlayerActionType>(type: T, ...args: CommandArgs<T>) => Promise<CommandResult<T>>

export interface SwitchCityResult { ok: boolean; code: 'switched' | 'invalid_city' | TransportCode | (string & {}); reason?: string }

export interface ClientOptions {
  fetch?: typeof fetch
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  now?: () => number
  setTimeout?: (run: () => void, ms: number) => unknown
  clearTimeout?: (handle: never) => void
  randomUUID?: () => string
  /** True while the page is hidden: polling pauses. */
  isHidden?: () => boolean
  /** False when the device itself has no network. */
  isOnline?: () => boolean
  /** After every accepted server state, and (with the same state twice) when only the link or storage changed. */
  onChange?: (state: LifeState, previous: LifeState) => void
  onStatus?: (text: string, isError: boolean) => void
  /** The device session is gone (401). */
  onSessionExpired?: () => void
  /** No session yet: ask for a nickname, then call connect(true). */
  onNeedName?: (problem?: NameProblem) => void
  onSession?: (session: OwnSession, created: boolean) => void
}

/** The object `createClient()` returns. Fields change in place; nothing here is reactive by itself. */
export interface GameClient {
  state: LifeState
  cityId: CityId
  identity: { name: string }
  hasSavedIdentity: boolean
  /** The caller's own session: `cities` lists where it has a life (absent from an older server). */
  session: OwnSession | null
  ready: boolean
  busy: boolean
  serverTimeOffset: number
  link: LinkState
  storage: StorageProblem | null
  readonly online: boolean
  serverNow(): number
  /** A retry key for an exactly-once write: `<server ms>:<uuid>`. One per thing the player does; reuse it on a retry. */
  newId(): string
  api: FetchJson
  fetchJson: FetchJson
  connect(createNew?: boolean): Promise<boolean>
  command(type: string, payload?: unknown): Promise<{ ok: boolean; code: string; reason?: string }>
  switchCity(id: string): Promise<SwitchCityResult>
  refresh(lostText?: string): Promise<boolean>
  schedule(): void
  stop(): void
}
