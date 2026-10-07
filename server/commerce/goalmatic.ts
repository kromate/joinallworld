import type { CommerceOverview } from '../../src/types/commerce.ts'
import type { CommerceBinding, CommerceExchange, CommerceGateway } from './types.ts'

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Store response is invalid.')
  return Object.fromEntries(Object.entries(value))
}
function text(value: unknown, limit = 300): string {
  if (typeof value !== 'string' || !value || value.length > limit) throw new Error('Store response is invalid.')
  return value
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Store response is invalid.')
  return value
}
export function safeCommerceUrl(value: unknown, allowFragment = false): string {
  const url = new URL(text(value, 2048))
  if (url.protocol !== 'https:' || url.username || url.password || (!allowFragment && url.hash)) throw new Error('Store link is invalid.')
  return url.href
}
function binding(value: unknown): CommerceBinding {
  const row = object(value)
  return { accountId: text(row.accountId), siteId: text(row.siteId), installationId: text(row.installationId), packageId: text(row.packageId), lifecycleGeneration: count(row.lifecycleGeneration), storeId: text(row.storeId) }
}
function overview(value: unknown): CommerceOverview {
  const row = object(value), store = object(row.store), summary = object(row.summary), payout = object(row.payout)
  const scope = object(row.binding)
  const currency = text(summary.currency, 3)
  if (!/^[A-Z]{3}$/.test(currency) || store.currency !== currency || payout.kind !== 'provider-managed' || !['production', 'test'].includes(String(scope.environment)) || typeof row.paymentsEnabled !== 'boolean' || (row.paymentProvider !== null && row.paymentProvider !== 'PAYSTACK' && row.paymentProvider !== 'BACHS') || !Number.isFinite(Date.parse(text(summary.updatedAt)))) throw new Error('Store response is invalid.')
  const payoutUrl = payout.url === null ? null : safeCommerceUrl(payout.url)
  const providerUrl = payout.providerUrl ? safeCommerceUrl(payout.providerUrl) : null
  for (const url of [payoutUrl, providerUrl]) if (url && !['dashboard.paystack.com', 'app.bachs.io'].includes(new URL(url).hostname)) throw new Error('Payout link is invalid.')
  return {
    environment: scope.environment === 'production' ? 'production' : 'test', paymentsEnabled: row.paymentsEnabled,
    paymentProvider: row.paymentProvider === 'PAYSTACK' ? 'PAYSTACK' : row.paymentProvider === 'BACHS' ? 'BACHS' : null,
    store: { id: text(store.id), name: text(store.name), slug: text(store.slug), currency, publicUrl: safeCommerceUrl(store.publicUrl, true) },
    summary: { currency, collectedMinor: count(summary.collectedMinor), refundedMinor: count(summary.refundedMinor), orderCount: count(summary.orderCount), paidOrderCount: count(summary.paidOrderCount), pendingOrderCount: count(summary.pendingOrderCount) },
    managementUrl: safeCommerceUrl(row.managementUrl), payout: { kind: 'provider-managed', url: payoutUrl, providerUrl },
  }
}
export function createCommerceGateway(env: Readonly<Record<string, unknown>>, request: (url: string, init: RequestInit) => Promise<Response>): CommerceGateway | undefined {
  const rawApi = env.GOALMATIC_COMMERCE_API_URL, rawStore = env.GOALMATIC_STORE_URL, rawOrigin = env.PUBLIC_ORIGIN
  if (!rawApi && !rawStore) return undefined
  let api: string, storeUrl: URL, redirectUri: string, channelId: string
  try {
    api = safeCommerceUrl(rawApi)
    storeUrl = new URL(safeCommerceUrl(rawStore))
    const origin = new URL(text(rawOrigin, 2048))
    if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))) return undefined
    redirectUri = `${origin.origin}/?commerce_return=1`
    channelId = typeof env.COMMERCE_CHANNEL_ID === 'string' ? env.COMMERCE_CHANNEL_ID : 'allworld'
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(channelId)) return undefined
  } catch { return undefined }
  async function call(body: Record<string, unknown>, token?: string): Promise<unknown> {
    const response = await request(api, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw Object.assign(new Error(response.status === 401 || response.status === 403 ? 'Reconnect your store to continue.' : 'Your store could not be reached. Try again.'), { status: response.status })
    const raw = await response.text()
    if (raw.length > 65536) throw new Error('Store response is too large.')
    return JSON.parse(raw)
  }
  return {
    redirectUri,
    authorizationUrl(state, challenge) {
      const url = new URL(storeUrl)
      url.searchParams.set('commerce_channel', channelId)
      url.searchParams.set('commerce_redirect', redirectUri)
      url.searchParams.set('commerce_state', state)
      url.searchParams.set('commerce_challenge', challenge)
      return url.href
    },
    async exchange(code, verifier): Promise<CommerceExchange> {
      const row = object(await call({ action: 'exchange', code, verifier, redirectUri }))
      const grantToken = text(row.grantToken, 256)
      if (!/^gmc_[A-Za-z0-9_-]{43}$/.test(grantToken)) throw new Error('Store authorization is invalid.')
      const expiresAt = typeof row.expiresAt === 'number' ? row.expiresAt : Date.parse(text(row.expiresAt))
      if (!Number.isFinite(expiresAt)) throw new Error('Store authorization expiry is invalid.')
      return { grantToken, expiresAt, binding: binding(row.binding) }
    },
    async overview(token) { return overview(await call({ action: 'overview' }, token)) },
    async revoke(token) { await call({ action: 'revoke' }, token) },
  }
}
