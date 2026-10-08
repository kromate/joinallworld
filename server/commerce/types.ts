import type { CommerceCategory, CommerceOverview } from '../../src/types/commerce.ts'

export interface CommerceBinding {
  accountId: string
  siteId: string
  installationId: string
  packageId: string
  lifecycleGeneration: number
  storeId: string
}
export interface CommerceGrant {
  secret: string
  expiresAt: number
  binding: CommerceBinding
  overview: CommerceOverview | null
  observedAt: number | null
}
export interface CommerceRecord {
  id: string
  accountId: string
  name: string
  description: string
  category: CommerceCategory
  serviceArea: string
  published: boolean
  createdAt: number
  updatedAt: number
  grant: CommerceGrant | null
  attempt: { state: string; verifier: string; device: string; redirectUri: string; expiresAt: number; busy: boolean } | null
}
export interface CommerceCollection { stores: Record<string, CommerceRecord | undefined> }
export interface CommerceExchange {
  grantToken: string
  expiresAt: number
  binding: CommerceBinding
}
export interface CommerceGateway {
  redirectUri: string
  authorizationUrl(state: string, challenge: string): string
  exchange(code: string, verifier: string): Promise<CommerceExchange>
  overview(token: string): Promise<CommerceOverview>
  revoke(token: string): Promise<void>
}
