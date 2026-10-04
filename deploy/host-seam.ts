/**
 * What the Worker adapter consumes from server/** (the route and socket registries, the host-context helpers, the
 * store), described here as local structural interfaces so this lane does not depend on types inferred from
 * JavaScript. At the merge with the server conversion each `as` seam in cloudflare-worker.ts is re-pointed at the
 * real exports and re-checked.
 */
/** An Error carrying the host's refusal fields (server/protocol.js protocolError / storageError). */
export interface CodedError extends Error { status?: number; code?: string; reason?: string; cause?: unknown }

export type JsonObject = Record<string, unknown>

/** A stored receipt (action_receipts / once_receipts rows are their JSON). */
export interface ReceiptRecord { actionAt?: number; at?: number; kind?: string; [key: string]: unknown }

/** A device session as the store holds it: `actions` and `once` are lazy maps over their tables inside a transaction. */
export interface SessionRecord {
  secret?: string
  publicId: string
  expiresAt: number
  actions?: Record<string, ReceiptRecord | undefined>
  once?: Record<string, ReceiptRecord | undefined>
  cities?: Record<string, { state?: unknown } | undefined>
  [key: string]: unknown
}

export interface StoreHelpers {
  scanSessions(predicate: (session: SessionRecord) => boolean): string[]
  sessionKeyByPublicId(publicId: string): string | undefined
  onceCounts(liveSince: number, lightKinds?: readonly string[]): { money: number; light: number }
}

/** The document a transaction sees: sessions, archives and feature collections by name. */
export interface Draft {
  version: number
  sessions: Record<string, SessionRecord | undefined>
  archivedLives: Record<string, unknown>
  readonly $store: StoreHelpers
  [collection: string]: unknown
}

export interface TransactOptions<T> { committed?: (result: T) => void; durable?: boolean; waitForObserved?: boolean }

export interface Store {
  transact<T>(fn: (db: Draft) => T | Promise<T>, options?: TransactOptions<T>): Promise<T>
  read<T>(fn: (db: Draft) => T | Promise<T>): Promise<T>
  stats(): { mode: string; failed: boolean; failing: boolean; transactions: number; reads: number; writes: number; aborted: number; writeFailures: number }
  flush(): Promise<void>
  close(): Promise<void>
}

// ---- The Worker host's side of the contract -------------------------------------------------------------------

/** The public face of a session (server/protocol.js publicSession). */
export interface PublicSession { id: string; [key: string]: unknown }

/** A socket's private state, carried through hibernation as its attachment. */
export interface SocketInfo {
  secret: string
  session: PublicSession
  expiresAt: number
  ip: string
  room: string | null
  closed: boolean
  alive: boolean
  pingedAt: number
  seenAt: number
  lastSessionRenewedAt: number
  position?: { x: number; z: number }
  voice?: { enabled: boolean; muted: boolean }
  lastMoves?: unknown[]
  look?: unknown
  [key: string]: unknown
}

/** A socket as the modules see it: the attachment fields plus the live handle. */
export interface HostSocket extends SocketInfo {
  position: { x: number; z: number }
  voice: { enabled: boolean; muted: boolean }
  lastMoves: unknown[]
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  socket: WebSocket
  released?: boolean
  chatBodyHash?: string
}

export interface RouteRequest {
  method: string
  path: string
  query: URLSearchParams
  ip: string
  secret: string | undefined
  params: Record<string, string>
  raw: Request
  moderator(): boolean
  json(): Promise<JsonObject>
  session(db: Draft, options?: { renew?: boolean }): SessionRecord | undefined
  requireSession(db: Draft, options?: { renew?: boolean }): SessionRecord
  body?: JsonObject
  publicId?: string
}

export interface RouteResult {
  status?: number
  body?: unknown
  renew?: boolean
  headers?: Record<string, string>
  after?: () => unknown
}

export interface MatchedRoute { key: string; params: Record<string, string>; handler(request: RouteRequest): Promise<RouteResult | void> | RouteResult | void }
export interface RouteTable { match(method: string, path: string): MatchedRoute | undefined }

export interface SocketMessageEntry { room?: boolean; handle(ws: HostSocket, message: JsonObject): unknown }
export interface SocketHandlers {
  messages: Map<string, SocketMessageEntry>
  open(ws: HostSocket): void
  close(ws: HostSocket): void
  restore(ws: HostSocket): void
}

export interface Telemetry {
  socketOut(ws: HostSocket, message: unknown): void
  socketIn(ws: HostSocket, message: unknown): void
  socketClosed(ws: HostSocket): void
  socketFailed(ws: HostSocket, message: unknown, code: string, coded: boolean, thrown: unknown): void
  http(event: { method: string; route: string; status: number; ms: number; publicId?: string; body?: unknown; action?: { type?: unknown; code?: unknown } }): void
  httpFailed(thrown: unknown, event: { method: string; route?: string; status: number; code?: string; body?: unknown; publicId?: string }): void
  flush(): Promise<unknown>
  attach(ctx: HostContext): void
}

export interface OnceReceipts {
  once: unknown
  onceId: unknown
  action: unknown
}

export interface ShardStore { [method: string]: unknown }

/** The host surface `ctx` handed to every route and socket module (the contract is in server/routes/index.js and server/ws/index.js). */
export interface HostContext {
  store: Store
  shards: ShardStore
  now: () => number
  fail: (status: number, code: string, reason?: string) => CodedError
  collection: unknown
  publicSession: (session: SessionRecord) => PublicSession
  cityIds: readonly string[]
  telemetry: Telemetry
  randomId: () => string
  allow: (key: string, count?: number, windowMs?: number) => boolean
  send: (ws: HostSocket, message: unknown) => void
  on: (event: string, fn: (value: unknown) => void) => void
  emit: (event: string, value: unknown) => void
  settle: (session: SessionRecord, cityId: string) => unknown
  act: unknown
  once: unknown
  onceId: unknown
  push: (id: string, message: unknown) => number
  online: (id: string) => boolean
  atHome: (db: Draft, id: unknown, city: string) => boolean
  checks: Record<string, unknown>
  pages: Map<string, (page: { path: string; query: URLSearchParams; origin: string; ip: string; method: string }) => PageResult | Promise<PageResult | null | undefined> | null | undefined>
  env: (name: string) => string
  fetch: unknown
  keyFile: (name: string, make: () => unknown | Promise<unknown>) => Promise<unknown>
  waitUntil: (promise: unknown) => void
  config: { publicOrigin: string; sessionTtlMs: number; actionWindowMs: number; maxActiveSessions: number; buildId: string; votesPerAddress: number; voteCapMode: string; heartbeatMs: number; moderation: boolean }
  startup: Promise<unknown>[]
  closing: unknown[]
  core: HostCore
  command?: (request: RouteRequest, body: unknown, options?: unknown) => unknown
}

export interface PageResult { html: string; status?: number; cache?: boolean }

export interface HostCore {
  archiveSession: (db: Draft, secret: string, session: SessionRecord | undefined) => void
  expiredSessionKeys: (db: Draft) => string[]
  sessionByPublicId: (db: Draft, id: string) => SessionRecord | undefined
  unresponsive: (ws: HostSocket) => boolean
  storeStats: () => ReturnType<Store['stats']>
  newIdentity: () => { secret: string; publicId: string }
  newId: () => string
  cookieHeader: (_: unknown, secret: string) => string
  sockets: () => HostSocket[]
  isOpen: (ws: HostSocket) => boolean
  sessionOf: (ws: HostSocket, db: Draft) => SessionRecord | undefined
  playerAct: unknown
  actionOnce: unknown
  storageFailing: () => boolean
  log: (line: unknown) => void
  hibernates: boolean
  chatHistory: (ws: HostSocket, body: unknown) => unknown
  validateMemberships: () => Promise<void>
  refreshNames: () => void
  roomStillValid: (ws: HostSocket, db: Draft, session: SessionRecord, cityId: string, state: unknown) => boolean
  revalidate: (publicId: string) => Promise<void>
}
