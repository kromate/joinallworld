import type { HostErrorCode, JsonBodyErrorCode, Ok, OnceErrorCode, SessionErrorCode, StorageErrorCode } from './protocol.ts'
import type { TrustReportReason } from '../game/trust/index.ts'
import type { ShowcaseGo, ShowcaseInput, ShowcaseLinkKind, ShowcaseMine, ShowcasePage, ShowcaseQueueItem, ShowcaseView } from './showcase.ts'

type ReadError = HostErrorCode | SessionErrorCode | StorageErrorCode | 'rate_limited' | 'account_required' | 'shop_unavailable' | 'invalid_cursor' | 'listings_held' | 'adult_self_declaration_required' | 'showcase_storage_invalid'
type WriteError = ReadError | JsonBodyErrorCode | OnceErrorCode | 'verification_required' | 'account_too_new' | 'adults_only' | 'age_required' | 'invalid_shop' | 'invalid_city' | 'market_required'
  | 'slot_taken' | 'market_full' | 'showcase_full' | 'unsupported_shop_field' | 'fee_request' | 'money_doubling' | 'text_blocked' | 'links_not_allowed' | 'contact_not_allowed' | 'home_address_not_allowed'
  | 'chat_link_not_allowed' | 'pay_link_not_allowed' | 'no_shop' | 'shop_incomplete' | 'photos_needed' | 'invalid_picture' | 'picture_rejected' | 'photo_limit' | 'upload_limit' | 'picture_store_full' | 'pictures_unavailable'
  | 'unknown_photo' | 'not_hideable' | 'go_limit' | 'own_shop' | 'invalid_reason' | 'expected_revision_required' | 'revision_conflict'
type OperatorError = HostErrorCode | StorageErrorCode | JsonBodyErrorCode | 'not_found' | 'moderator_token_required' | 'rate_limited' | 'unknown_shop' | 'unknown_photo' | 'invalid_action'
type Receipt = { clientId: string }
type Result = Ok<{ ok: boolean; code: string; id?: string; revision?: number; status?: string; duplicate?: true; reason?: string }>

export interface ShowcaseHttpRoutes {
  'GET /api/showcase/directory': { query: { city?: string; category?: string; q?: string; after?: string }; response: Ok<ShowcasePage>; errors: ReadError }
  'GET /api/showcase/mine': { response: Ok<ShowcaseMine>; errors: ReadError }
  'GET /api/showcase/photo/:id': { params: { id: string }; response: Ok<Record<string, never>>; errors: ReadError | 'unknown_photo' }
  'GET /api/showcase/:id': { params: { id: string }; response: Ok<{ shop: ShowcaseView }>; errors: ReadError }
  'POST /api/showcase/mine': { body: Receipt & { expectedRevision: number } & ShowcaseInput; response: Result; errors: WriteError }
  'POST /api/showcase/mine/photos': { body: Receipt & { type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string }; response: Result & { photo?: string }; errors: WriteError }
  'POST /api/showcase/mine/photos/remove': { body: Receipt & { photo: string }; response: Result; errors: WriteError }
  'POST /api/showcase/mine/submit': { body: Receipt; response: Result; errors: WriteError }
  'POST /api/showcase/mine/hide': { body: Receipt & { hidden: boolean }; response: Result; errors: WriteError }
  'POST /api/showcase/mine/remove': { body: Receipt; response: Result; errors: WriteError }
  'POST /api/showcase/:id/go': { body: Receipt & { kind: ShowcaseLinkKind }; response: Ok<ShowcaseGo>; errors: WriteError }
  'POST /api/showcase/:id/report': { body: Receipt & { reason: TrustReportReason; note?: string; photo?: string }; response: Result; errors: WriteError }
  'GET /api/mod/showcase': { response: Ok<{ queue: ShowcaseQueueItem[]; shops: number }>; errors: OperatorError }
  'GET /api/mod/showcase/photo/:id': { params: { id: string }; response: Ok<Record<string, never>>; errors: OperatorError }
  'POST /api/mod/showcase': { body: { action: 'approve' | 'hide' | 'restore' | 'photo-restore' | 'photo-remove'; shop: string; photo?: string; reason?: string }; response: Ok<{ ok: true; code: string; status: string }>; errors: OperatorError }
}
