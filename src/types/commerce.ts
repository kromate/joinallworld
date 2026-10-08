import type { ApiEnvelope, CityId, HostErrorCode, JsonBodyErrorCode, StorageErrorCode } from './protocol.ts'

export const COMMERCE_CATEGORIES = [
  { id: 'food', name: 'Food and groceries' },
  { id: 'fashion', name: 'Clothing and accessories' },
  { id: 'beauty', name: 'Beauty products' },
  { id: 'electronics', name: 'Electronics and accessories' },
  { id: 'home', name: 'Home and furniture' },
  { id: 'craft', name: 'Art, crafts and gifts' },
  { id: 'books', name: 'Books and stationery' },
  { id: 'tools', name: 'Tools and supplies' },
  { id: 'other', name: 'Other physical products' },
] as const
export type CommerceCategory = (typeof COMMERCE_CATEGORIES)[number]['id']
export interface CommerceAddress { city: CityId; lga: string; estate: number; plot: number }
export interface CommerceListing {
  id: string
  name: string
  description: string
  category: CommerceCategory
  serviceArea: string
  address: CommerceAddress
  storefrontUrl: string
}
export interface CommerceSummary {
  currency: string
  collectedMinor: number
  refundedMinor: number
  orderCount: number
  paidOrderCount: number
  pendingOrderCount: number
}
export interface CommerceOverview {
  environment: 'production' | 'test'
  paymentsEnabled: boolean
  paymentProvider: 'PAYSTACK' | 'BACHS' | null
  store: { id: string; name: string; slug: string; currency: string; publicUrl: string }
  summary: CommerceSummary
  managementUrl: string
  payout: { kind: 'provider-managed'; url: string | null; providerUrl: string | null }
}
export interface OwnCommerce {
  id: string
  name: string
  description: string
  category: CommerceCategory
  serviceArea: string
  published: boolean
  address: CommerceAddress | null
  connection: 'disconnected' | 'connected' | 'expired'
  storefrontUrl: string | null
  overview: CommerceOverview | null
  observedAt: number | null
}
export interface CommerceResponse {
  enabled: boolean
  signedIn: boolean
  accountEnabled: boolean
  csrf: string | null
  commerce: OwnCommerce | null
  address: CommerceAddress | null
  connectionError?: string
}
export interface CommerceDirectory { items: CommerceListing[]; next: string | null }

type CommerceErrorCode = HostErrorCode | JsonBodyErrorCode | StorageErrorCode | 'invalid_city' | 'commerce_account_required' | 'commerce_csrf' | 'commerce_rate_limited' | 'commerce_required' | 'commerce_profile_invalid' | 'commerce_terms_required' | 'commerce_plot_required' | 'commerce_unavailable' | 'commerce_callback_invalid' | 'commerce_connection_expired' | 'commerce_currency_invalid' | 'commerce_connection_changed' | 'commerce_connect_failed' | 'commerce_state_invalid' | 'commerce_verification_required' | 'commerce_not_ready' | 'commerce_filter_invalid'
interface CommerceMutation { response: CommerceResponse & ApiEnvelope; errors: CommerceErrorCode }
interface CommerceProfile { name: string; description: string; category: CommerceCategory; serviceArea: string; csrf: string }
export interface CommerceHttpRoutes {
  'GET /api/commerce': CommerceMutation
  'GET /api/commerce/directory': { response: CommerceDirectory & ApiEnvelope; errors: CommerceErrorCode }
  'POST /api/commerce/start': CommerceMutation & { body: CommerceProfile & { adultAndTerms: true } }
  'POST /api/commerce/profile': CommerceMutation & { body: CommerceProfile }
  'POST /api/commerce/refresh': CommerceMutation & { body: { csrf: string } }
  'POST /api/commerce/connect': { body: { csrf: string }; response: ApiEnvelope & { authorizationUrl: string }; errors: CommerceErrorCode }
  'POST /api/commerce/connect/complete': CommerceMutation & { body: { code: string; state: string; csrf: string } }
  'POST /api/commerce/publish': CommerceMutation & { body: { published: boolean; csrf: string } }
  'POST /api/commerce/disconnect': CommerceMutation & { body: { csrf: string } }
}
