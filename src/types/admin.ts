/**
 * The admin section's wire shapes (server/routes/admin.ts), used by the admin app (src/app/features/admin). Every route needs a
 * signed-in ACCOUNT whose verified address is an admin's; anyone else gets 404 `not_found`, exactly as for a route that does not exist.
 * No answer carries an address (only a masked one), a token, a cookie, a device secret or an IP.
 * Every POST carries a `clientId` (`<server ms>:<uuid>`): it is applied once, and a repeat answers the first result with `duplicate: true`.
 */
import type { ApiEnvelope, HostErrorCode, JsonBodyErrorCode, OnceErrorCode, Ok, StorageErrorCode } from './protocol.ts'

export type AdminError = HostErrorCode | JsonBodyErrorCode | StorageErrorCode | OnceErrorCode | 'origin_required' | 'protected_target' | 'invalid_player' | 'unknown_action' | 'reason_required' | 'invalid_amount' | 'over_action_limit' | 'over_target_day_limit' | 'over_admin_day_limit' | 'no_life' | 'life_not_started' | 'player_expired' | 'confirmation_required' | 'invalid_confirmation'
/** A flat bag the UI renders; the exact shapes are the ones the server builds (server/admin/*.ts). */
export type AdminJson = Record<string, unknown>
export interface AdminTool { id: string; title: string; group: 'moderation' | 'world' | 'players' | 'other'; kind: 'queue' | 'switch' | 'link'; list?: string; actions?: { id: string; label: string; danger?: boolean; path: string }[] }
export interface AdminMe extends ApiEnvelope { admin: true; level: 'root' | 'admin'; name: string; ref: string; cities: string[]; tools: AdminTool[]; limits: Record<string, number> }
export interface PlayerRow { id: string; name: string; kind: 'guest' | 'account'; city: string | null; online: boolean; cash: number; lastSeen: number; since: number; flags: string[]; admin: boolean }
export interface PlayersPage extends ApiEnvelope { rows: PlayerRow[]; total: number; page: number; pageSize: number; scanned: number }
export interface AuditView { n: number; at: number; admin: string; adminName: string; action: string; target: string; targetName: string; params: Record<string, string | number | boolean | null>; summary: string; reason: string; amount?: number }
export interface ActionDone extends ApiEnvelope { ok: true; code: string; summary: string; before?: number; after?: number; applied?: number; clamped?: boolean; line: number; duplicate?: true }
export interface ConfirmNeeded extends ApiEnvelope { ok: false; code: 'confirmation_required'; token: string; expiresAt: number; summary: string; players?: number; total?: number }

type Get<Response> = { response: Ok<Response>; errors: AdminError; query?: Record<string, string | number | undefined> }
type Post<Body, Response> = { body: Body; response: Ok<Response>; errors: AdminError }
export interface AdminHttpRoutes {
  'GET /api/admin/me': Get<AdminMe>
  'GET /api/admin/dashboard': Get<AdminJson>
  'GET /api/admin/economy': Get<AdminJson>
  'GET /api/admin/history': Get<AdminJson>
  'POST /api/admin/players/bulk': Post<{ clientId: string; ids: string[]; action: 'message' | 'credit'; text?: string; amount?: number; reason?: string; confirm?: string }, AdminJson>
  'GET /api/admin/players': Get<PlayersPage>
  'GET /api/admin/players/:id': Get<AdminJson>
  'POST /api/admin/players/:id/act': Post<{ clientId: string; action: string; reason?: string; confirm?: string; [param: string]: unknown }, ActionDone | ConfirmNeeded>
  'POST /api/admin/world/grant': Post<{ clientId: string; audience: 'online' | 'city'; city?: string; amount: number; reason: string; preview?: boolean; confirm?: string }, AdminJson>
  'GET /api/admin/announcements': Get<AdminJson>
  'POST /api/admin/announcements': Post<{ clientId: string; title: string; body: string; action?: string | null; audience: string; city?: string; at?: number; expiresAt?: number; push?: boolean; email?: boolean; preview?: boolean; confirmCount?: number }, AdminJson>
  'POST /api/admin/announcements/:id/cancel': Post<{ clientId: string }, AdminJson>
  'GET /api/admin/settings': Get<AdminJson>
  'POST /api/admin/settings': Post<{ clientId: string; key: string; value: boolean | number | null }, AdminJson>
  'POST /api/admin/notice': Post<{ clientId: string; minutes: number }, AdminJson>
  'GET /api/admin/moderation/reports': Get<AdminJson>
  'POST /api/admin/moderation/reports/:id/act': Post<{ clientId: string; action: 'dismiss' | 'warn' | 'mute'; note?: string; minutes?: number }, AdminJson>
  'GET /api/admin/moderation/shops': Get<AdminJson>
  'POST /api/admin/moderation/shops/act': Post<{ clientId: string; shop: string; action: 'rename' | 'close'; reason?: string }, AdminJson>
  'GET /api/admin/politics': Get<AdminJson>
  'POST /api/admin/politics/act': Post<{ clientId: string; action: 'remove-officeholder' | 'release' | 'dismiss'; scope?: string; player?: string; role?: 'police' | 'judge'; typed?: string; reason: string }, AdminJson>
  'GET /api/admin/moderation/content': Get<AdminJson>
  'POST /api/admin/moderation/content/remove': Post<{ clientId: string; cityId: string; kind: string; slot?: string; id?: string; venue?: string; reason?: string }, AdminJson>
  'GET /api/admin/audit': Get<{ lines: AuditView[]; total: number; next: number | null }>
  'GET /api/admin/tools': Get<{ tools: AdminTool[] }>
  'GET /api/admin/trust/reports': Get<AdminJson>
  'POST /api/admin/trust/reports/:id/act': Post<{ clientId: string; action: 'uphold' | 'dismiss'; note?: string }, AdminJson>
  'POST /api/admin/trust/players/:id/act': Post<{ clientId: string; action: 'verify' | 'release'; tier?: 'phone' | 'id' | 'business' | 'none'; reason: string }, AdminJson>
  'GET /api/admin/moderation/pictures': Get<AdminJson>
  'GET /api/admin/moderation/pictures/:id': Get<AdminJson>
  'POST /api/admin/moderation/pictures/:id/act': Post<{ clientId: string; action: 'remove' | 'restore' }, AdminJson>
  'POST /api/admin/moderation/pictures/player': Post<{ clientId: string; player: string; allowed: boolean }, AdminJson>
  'POST /api/admin/companion/test': Post<{ clientId: string }, AdminJson>
}
