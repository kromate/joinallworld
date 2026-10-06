// How the admin screens reach the server. The screens do not know whether they run inside the game (which has its own client, with the
// session it already holds) or on the admin address (a page of their own, src/admin): whichever hosts them sets this once before they draw.
import type { FetchJson } from '../../types/client.ts'

export interface AdminTransport {
  fetchJson: FetchJson
  /** A new client id for a change: `<server ms>:<uuid>`. */
  newId(): string
  /** The server's clock now (ms). */
  now(): number
}
let current: AdminTransport | null = null
export function setAdminTransport(next: AdminTransport): void { current = next }
export function adminTransport(): AdminTransport {
  if (!current) throw new Error('The admin screens were drawn before a transport was set')
  return current
}
