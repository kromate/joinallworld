/**
 * What the Worker adapter needs beyond the contracts server/types.ts exports. The route and socket registries, the
 * context (`RouteContext`), the stored document (`Db`, `SessionRecord`), the request (`RouteRequest`) and the socket
 * (`WsConnection`) are the real server types; only the shapes below are narrower or wider than those, because the
 * Worker host genuinely differs:
 *
 *   SqliteStore   a `Store` whose optional `stats`/`flush`/`close` are always there (the Durable Object's store has all three).
 *   SocketInfo    the part of a socket that is written into its hibernation attachment (2,048 bytes): narrower than a
 *                 `WsConnection`, which also has live-only fields (`stale`, `guestUntil`, `look` …) that are rebuilt on wake.
 *   HostSocket    a `WsConnection` plus the live Workers handle (`socket`) and the bookkeeping the object keeps.
 *   WorkerRequest a `RouteRequest` whose `raw` is the Workers `Request` and which remembers its parsed body for telemetry.
 */
import type { PublicSession } from '../src/types/protocol.ts'
import type { StoreStats } from '../src/types/support.ts'
import type { RouteRequest, Store, WsConnection } from '../server/types.ts'

export type { PublicSession }

export interface SqliteStore extends Store {
  stats(): StoreStats
  executing(): boolean
  flush(): Promise<void>
  close(): Promise<void>
}

/** A socket's private state, carried through hibernation as its attachment. */
export interface SocketInfo {
  secret: string
  /** The cookie the socket was opened with; differs from `secret` for a signed-in browser (server/types.ts WsConnection). */
  device?: string
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
  lastMoves?: number[]
  look?: WsConnection['look']
}

/** A socket as the modules see it: the attachment fields plus the live handle. */
export interface HostSocket extends WsConnection {
  closed: boolean
  send(data: string): void
  close(code?: number, reason?: string): void
  socket: WebSocket
  released?: boolean
  chatBodyHash?: string
}

export interface WorkerRequest extends RouteRequest {
  raw: Request
  body?: Record<string, unknown>
}
