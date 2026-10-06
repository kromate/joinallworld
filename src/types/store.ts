/**
 * The operator's view of how the big collections are stored (server/routes/storage-mod.ts, docs/STORAGE.md). Same access rules as the
 * other operator routes: 404 unless the server has a MODERATOR_TOKEN, the token only in `Authorization: Bearer`. No answer carries
 * a player's data: counts, fingerprints and the names of collections and keys' maps only.
 */
import type { HostErrorCode, JsonBodyErrorCode, Ok, StorageErrorCode } from './protocol.ts'

type StoreError = HostErrorCode | JsonBodyErrorCode | StorageErrorCode | 'not_found' | 'moderator_token_required' | 'rate_limited' | 'not_supported'
type LayoutError = StoreError | 'invalid_layout' | 'shadow_mismatch' | 'not_equal' | 'migration_failed'
type SafetyError = StoreError | 'invalid_action' | 'not_switched' | 'too_early' | 'dropped'
/** The layout and what it holds; the exact fields are the ones the store builds (deploy/sqlite-store.ts layoutStatus). */
export type StoreStatus = Record<string, unknown>

export interface StoreHttpRoutes {
  'GET /api/mod/store': { response: Ok<StoreStatus>; errors: StoreError }
  'GET /api/mod/store/compare': { response: Ok<{ collections: Record<string, unknown> }>; errors: StoreError }
  'GET /api/mod/store/hashes': { response: Ok<{ collections: Record<string, string | null> }>; errors: StoreError }
  'POST /api/mod/store/migrate': { body: { collections?: string[] }; response: Ok<{ moved: Record<string, { entries: number; rows: number; ms: number }> }>; errors: StoreError | 'invalid_collections' | 'migration_failed' | 'unknown_collection' }
  'POST /api/mod/store/layout': { body: { layout: 'legacy' | 'shadow' | 'entries'; force?: boolean }; response: Ok<StoreStatus>; errors: LayoutError }
  'POST /api/mod/store/safety': { body: { action: 'drop' | 'restore'; force?: boolean }; response: Ok<StoreStatus>; errors: SafetyError }
}
