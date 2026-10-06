/**
 * "Report a problem", the wallet statement, and the operator's API.
 *
 * Derived from server/routes/support.ts + server/support/service.ts, server/routes/moderation.ts +
 * server/moderation/service.ts, the operator helpers at the end of server/social/service.ts
 * (modReports, modSetReport) and src/game/systems/wallet.ts statementOf(); the browser side is
 * src/ui/panels/support.js and statement.js. Nothing in the browser calls `/api/mod/*`: it is
 * used with curl and a bearer token.
 * WORKER: none of these routes exist on the Cloudflare Worker.
 */
import type { ApiEnvelope, CityId, HostErrorCode, JsonBodyErrorCode, Ok, OnceErrorCode, PlayerRef, Refusal, SessionErrorCode, StorageErrorCode, TimedId } from './protocol.ts'
import type { PlayerReportReceipt, ReportReason } from './social.ts'
import type { AdKind } from './civic.ts'

// ---- problem reports (a player about the game) ---------------------------------------------------

export type SupportCategory = 'money' | 'stuck' | 'messages' | 'people' | 'bug' | 'other'
/** received → reviewing → resolved | dismissed, set by an operator. */
export type SupportStatus = 'received' | 'reviewing' | 'resolved' | 'dismissed'

/** What the player sees of a report they filed. */
export interface SupportReceipt {
  /** `P-<n>`. */
  id: string
  at: number
  cityId: CityId
  category: SupportCategory
  text: string
  status: SupportStatus
  /** The operator's note to the player; `''` when there is none. */
  note: string
  updatedAt: number
}

/** One of the player's last actions, from their receipts. `type` is `'unknown'` for a receipt stored before types were kept. */
export interface SupportActionLine { at: number; type: string; ok: boolean; code: string }
export interface SupportLedgerLine { at: number; amount: number; reason: string; balance: number }
/** Attached by the server when the report is filed, built field by field from the server-held life. */
export interface SupportContext {
  build: string
  at: number
  cityId: CityId
  life: {
    cash: number
    location: string
    spot: string | null
    job: unknown
    action: { kind: string; id: string; remaining: number } | null
    message: string
  }
  /** Newest first, at most 10. */
  actions: SupportActionLine[]
  /** The newest of `actions` that was refused. */
  lastError: SupportActionLine | null
  /** The last 10 wallet lines, oldest first. */
  ledger: SupportLedgerLine[]
}
/** The stored report, as the operator reads it (GET /api/mod/problems). `by` is the public id. */
export interface SupportReport extends SupportReceipt {
  by: string
  name: string
  context: SupportContext
}

export interface SupportLimits {
  /** Longest report text. */
  text: number
  /** Most reports one player may have waiting. */
  open: number
}

export interface FileReportBody { cityId: CityId; category: SupportCategory; /** 3–600 characters */ text: string; clientId: TimedId }
/**
 * `receipt` is read from the report as it stands NOW, so a repeat shows the current status. If the
 * report has since been dropped from a full inbox, a repeat answers with `{ id }` alone.
 */
export type FileReportResponse =
  | { ok: true; code: 'filed'; duplicate?: true; receipt: SupportReceipt | { id: string } }
  | Refusal<'too_many_open' | 'rate_limited' | 'inbox_full'>
/** The caller's own receipts, newest first, at most 30. */
// INCONSISTENT: server/routes/support.ts:8 documents `{ ok, reports, categories, limits }`; the answer also has
// `code: 'ok'`. src/ui/panels/support.js:21 ignores `categories` and uses its own hard-coded label map.
export interface MyReportsResponse {
  ok: true
  code: 'ok'
  reports: SupportReceipt[]
  categories: SupportCategory[]
  limits: SupportLimits
}

// ---- statement -----------------------------------------------------------------------------------

export interface StatementLine { at: number; amount: number; reason: string; balance: number }
export interface StatementDay {
  /** Lagos day index (src/game/clock.ts). */
  day: number
  open: number
  close: number
  in: number
  out: number
  changes: number
  /** Largest movement first. */
  groups: { group: string; net: number; count: number }[]
}
/** src/game/systems/wallet.ts statementOf(): the kept history with its arithmetic checked. */
export interface Statement {
  closing: number
  /** `day` is null when no day totals are kept yet (then `balance` is the balance before the first kept line). */
  opening: { balance: number; day: number | null }
  days: StatementDay[]
  lines: StatementLine[]
  /** Balance before the first kept line. */
  linesOpening: number
  totals: { in: number; out: number; changes: number; net: number }
  reconciled: boolean
  /** Empty when `reconciled`. */
  problems: string[]
  /** How many lines and days are kept at most. */
  kept: { lines: number; days: number }
}
/** GET /api/support/statement?city= */
export interface StatementResponse {
  ok: true
  city: CityId
  name: string
  statement: Statement
}

export interface SupportHttpRoutes {
  'POST /api/support/reports': {
    body: FileReportBody
    response: Ok<FileReportResponse>
    errors: HostErrorCode | JsonBodyErrorCode | SessionErrorCode | StorageErrorCode | OnceErrorCode | 'invalid_city' | 'invalid_category' | 'invalid_report_text'
  }
  'GET /api/support/reports': { response: Ok<MyReportsResponse>; errors: HostErrorCode | SessionErrorCode }
  'GET /api/support/statement': {
    query: { city: CityId }
    response: Ok<StatementResponse>
    errors: HostErrorCode | SessionErrorCode | StorageErrorCode | 'invalid_city'
  }
}

// ---- operator API (/api/mod/*) -------------------------------------------------------------------
//
// `Authorization: Bearer <MODERATOR_TOKEN>` on every request; no cookie, no origin check. While the
// server runs without a token every path answers 404 `not_found`. Without the right token: 401
// `moderator_token_required`, or 429 `rate_limited` once the failed-attempt budget is spent.

export type PlayerReportStatus = 'received' | 'dismissed' | 'actioned'
/** A player's report about another player, as stored (`R-<n>`) plus the two names resolved at read time. */
export interface ModPlayerReport {
  id: string
  by: string
  about: string
  /** The reported player's name when the report was filed. */
  aboutName: string
  reason: ReportReason
  text: string
  at: number
  status: PlayerReportStatus
  /** Up to five of the reported player's last direct messages to the reporter. */
  evidence: string[]
  /** Set once an operator has answered. */
  note?: string
  updatedAt?: number
  byName: string
  /** The reported player's current name, or null if they are gone. */
  aboutNow: string | null
}

export interface Mute {
  /** Public id. */
  id: string
  at: number
  until: number
  reason: string
  /** The `R-<n>` report the mute answered. */
  report?: string
}
export interface AuditLine {
  n: number
  at: number
  action: string
  target: string
  detail: string
  /** The operator's address, or `'server'` for a line the server wrote itself (the vote cap). */
  from: string
}

/** server/store.ts stats(); null when the store offers none. */
export interface StoreStats {
  /** WORKER: 'sqlite' (deploy/sqlite-store.ts). */
  mode: 'grouped' | 'sqlite'
  transactions: number
  /** Transactions that asked for nothing to be written before they were answered. WORKER: the SQLite store has no byte count, no undo and no failure time, so it omits those three. */
  lazy?: number
  reads: number
  writes: number
  bytes?: number
  aborted: number
  writeFailures: number
  undone?: number
  failing: boolean
  /** WORKER: sessions and collections whose lazy change is in memory, not yet written (deploy/sqlite-store.ts LAZY). */
  held?: number
  /** WORKER: keys the rate limiter holds per class — short windows in memory, long and protected ones stored (server/limiter.ts). */
  limits?: { short: number; long: number; protected: number }
  /** WORKER: rows the object's storage was asked to write since it last started (deploy/write-meter.ts). */
  rows?: RowsWritten
  lastFailureAt?: number | null
  /** JSON characters stored per collection; the operator's overview adds it. Node: also `sessions` and `archivedLives`, as the sum of their records. WORKER: the feature collections only. */
  collections?: Record<string, number>
  /** WORKER: the same flag as `failing`, kept for the Worker's own tests. */
  failed?: boolean
}
/** What the Node store (server/store.ts) keeps: every counter, always. */
/** Rows written, as the storage counted them (an index entry is a row): in all, per table, and per kind of work. Counters only. */
export interface RowsWritten {
  since: number
  total: number
  tables: Record<string, number>
  sources: Record<string, { calls: number; rows: number; tables: Record<string, number> }>
}
export type NodeStoreStats = StoreStats & { mode: 'grouped'; lazy: number; bytes: number; undone: number; lastFailureAt: number | null }
export interface ModOverviewResponse {
  reports: { total: number; open: number }
  problems: { total: number; open: number }
  /** Number of active mutes. */
  mutes: number
  sessions: number
  archivedLives: number
  /** How full the host is: stored sessions and open sockets beside the most it takes (docs/CAPACITY.md). */
  capacity: { sessions: { held: number; most: number }; sockets: { open: number; most: number; perAddress: number; perPlayer: number } }
  store: StoreStats | null
  build: string
  /** Calls today (UTC day) and the relay: no names, no ids. `relayLimits` is null when the host has no relay object. */
  calls: { relay: boolean; placed: number; connectedDirect: number; connectedViaRelay: number; failedToConnect: number; relayMintsToday: number; relayLimits: { perPlayerPerDay: number; perAddressPerHour: number; dailyCeiling: number } | null }
}
export interface ModContentResponse {
  city: CityId
  ads: { kind: AdKind; slot: string; text: string; by: PlayerRef; at: number; expiresAt: number }[]
  radio: { venue: string; id: string; title: string; artist: string; by: PlayerRef; startsAt: number; endsAt: number }[]
  announcements: { id: string; text: string; by: PlayerRef; at: number }[]
}

export interface DismissReportBody { note?: string }
export interface ProblemStatusBody { status: 'reviewing' | 'resolved' | 'dismissed'; note?: string }
/** `minutes`: 1 to 43 200 (30 days). `report`: an `R-<n>` id to mark actioned. */
export interface MuteBody { id: string; minutes: number; reason?: string; report?: string }
export type RemoveContentBody =
  | { cityId: CityId; kind: AdKind; slot: string; reason?: string }
  | { cityId: CityId; kind: 'announcement'; id: string; reason?: string }
  | { cityId: CityId; kind: 'radio'; venue: string; id: string; reason?: string }

/** What every operator route can answer besides its own codes. */
type ModCommon = 'not_found' | 'moderator_token_required' | 'rate_limited' | 'internal_error'
type ModWrite = ModCommon | JsonBodyErrorCode | StorageErrorCode | 'invalid_note'

export interface ModerationHttpRoutes {
  'GET /api/mod/overview': { response: Ok<ModOverviewResponse>; errors: ModCommon }
  /** `status`: open (= received, the default), all, or one status. Newest first, at most 100. */
  'GET /api/mod/reports': { query: { status?: 'open' | 'all' | PlayerReportStatus }; response: Ok<{ reports: ModPlayerReport[] }>; errors: ModCommon | 'invalid_status' }
  /** `status`: open (= received or reviewing, the default), all, or one status. Newest first, at most 100. */
  'GET /api/mod/problems': { query: { status?: 'open' | 'all' | SupportStatus }; response: Ok<{ problems: SupportReport[] }>; errors: ModCommon | 'invalid_status' }
  'GET /api/mod/mutes': { response: Ok<{ mutes: Mute[] }>; errors: ModCommon }
  /** The last 200 lines, newest first. */
  'GET /api/mod/audit': { response: Ok<{ audit: AuditLine[] }>; errors: ModCommon }
  'GET /api/mod/content': { query: { city: CityId }; response: Ok<ModContentResponse>; errors: ModCommon | 'invalid_city' }
  'POST /api/mod/reports/:id/dismiss': {
    params: { id: string }
    body: DismissReportBody
    response: Ok<{ ok: true; code: 'dismissed'; report: Omit<ModPlayerReport, 'byName' | 'aboutNow'> }>
    errors: ModWrite | 'unknown_report'
  }
  'POST /api/mod/problems/:id/status': {
    params: { id: string }
    body: ProblemStatusBody
    response: Ok<{ ok: true; code: 'updated'; problem: SupportReport }>
    errors: ModWrite | 'invalid_status' | 'unknown_report'
  }
  /** 409 `mute_list_full`. The full mute table the handler builds (`mutes`) is stripped before the answer. */
  'POST /api/mod/mutes': {
    body: MuteBody
    response: Ok<{ ok: true; code: 'muted'; mute: Mute }>
    errors: ModWrite | 'invalid_player' | 'invalid_minutes' | 'invalid_report' | 'mute_list_full'
  }
  'POST /api/mod/mutes/:id/lift': {
    params: { id: string }
    body: Record<string, never>
    response: Ok<{ ok: true; code: 'lifted' | 'not_muted' }>
    errors: ModWrite | 'invalid_player'
  }
  /** Removing content refunds nothing; the owner is told in their Updates. */
  'POST /api/mod/content/remove': {
    body: RemoveContentBody
    response: Ok<{ ok: true; code: 'removed'; removed: { kind: AdKind | 'announcement' | 'radio'; text: string; by: PlayerRef } }>
    errors: ModWrite | 'invalid_city' | 'invalid_kind' | 'nothing_to_remove'
  }
}

/** Re-exported so a consumer of the support surface has both kinds of receipt in one place. */
export type { PlayerReportReceipt }

// ---- runtime key lists (protocol.test.ts) --------------------------------------------------------

export const SUPPORT_CATEGORIES = ['money', 'stuck', 'messages', 'people', 'bug', 'other'] as const satisfies readonly SupportCategory[]
export const SUPPORT_STATUSES = ['received', 'reviewing', 'resolved', 'dismissed'] as const satisfies readonly SupportStatus[]
export const FILE_REPORT_RESPONSE_KEYS = ['code', 'ok', 'receipt', 'serverTime'] as const satisfies readonly (keyof Extract<FileReportResponse, { ok: true }> | keyof ApiEnvelope)[]
export const SUPPORT_RECEIPT_KEYS = ['at', 'category', 'cityId', 'id', 'note', 'status', 'text', 'updatedAt'] as const satisfies readonly (keyof SupportReceipt)[]
export const MY_REPORTS_RESPONSE_KEYS = ['categories', 'code', 'limits', 'ok', 'reports', 'serverTime'] as const satisfies readonly (keyof MyReportsResponse | keyof ApiEnvelope)[]
export const STATEMENT_RESPONSE_KEYS = ['city', 'name', 'ok', 'serverTime', 'statement'] as const satisfies readonly (keyof StatementResponse | keyof ApiEnvelope)[]
export const STATEMENT_KEYS = ['closing', 'days', 'kept', 'lines', 'linesOpening', 'opening', 'problems', 'reconciled', 'totals'] as const satisfies readonly (keyof Statement)[]
export const SUPPORT_REPORT_KEYS = ['at', 'by', 'category', 'cityId', 'context', 'id', 'name', 'note', 'status', 'text', 'updatedAt'] as const satisfies readonly (keyof SupportReport)[]
export const SUPPORT_CONTEXT_KEYS = ['actions', 'at', 'build', 'cityId', 'lastError', 'ledger', 'life'] as const satisfies readonly (keyof SupportContext)[]
export const MOD_OVERVIEW_RESPONSE_KEYS = ['archivedLives', 'build', 'calls', 'capacity', 'mutes', 'problems', 'reports', 'serverTime', 'sessions', 'store'] as const satisfies readonly (keyof ModOverviewResponse | keyof ApiEnvelope)[]
/** A mute without the optional `report`. */
export const MUTE_KEYS = ['at', 'id', 'reason', 'until'] as const satisfies readonly (keyof Mute)[]
export const AUDIT_LINE_KEYS = ['action', 'at', 'detail', 'from', 'n', 'target'] as const satisfies readonly (keyof AuditLine)[]
