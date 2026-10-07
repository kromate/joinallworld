import type { CommerceDirectory, CommerceListing, CommerceResponse } from '../../src/types/commerce.ts'
import type { CommerceRecord } from '../commerce/types.ts'
import { commerceAddress, commerceStores, commerceOf, commerceSecrets, categoryOf, challenge, opaque, ownCommerce, profileText } from '../commerce/service.ts'
import type { Db, RouteContext, RouteHandler, RouteKey, RouteRequest } from '../types.ts'
const csrfOf = (cookie: string): Promise<string> => challenge(`commerce-csrf:${cookie}`)

export default function commerceRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const { store, fail, commerceGateway: gateway } = ctx
  const secrets = commerceSecrets(ctx)
  const publicChecks = new Map<string, { secret: string; at: number; url: string }>()
  const reject = (status: number, code: string, reason: string): never => { throw Object.assign(fail(status, code), { reason }) }
  const owner = (db: Db, request: RouteRequest): string => {
    const session = request.requireSession(db)
    if (!session.account || !db.accounts?.[session.account]) return reject(401, 'commerce_account_required', 'Sign in to keep a store with your account.')
    return session.account
  }
  const limit = (request: RouteRequest, action: string, maximum: number) => { if (!ctx.allow(`commerce:${action}:${request.ip}`, maximum, 60000)) reject(429, 'commerce_rate_limited', 'Please wait a minute before trying again.') }
  async function guard(request: RouteRequest, body: Record<string, unknown>): Promise<string> {
    if (!request.strictOrigin || !request.cookie || body.csrf !== await csrfOf(request.cookie)) reject(403, 'commerce_csrf', 'Refresh your store and try again.')
    return store.read(db => owner(db, request))
  }
  const requireCommerce = (db: Db, accountId: string): CommerceRecord => commerceOf(db, accountId) ?? reject(409, 'commerce_required', 'Create your starter store first.')
  async function refresh(accountId: string): Promise<string | undefined> {
    if (!gateway) return 'Store connections are not available on this server yet.'
    const grant = await store.read(db => commerceOf(db, accountId)?.grant ?? null)
    if (!grant) return undefined
    if (grant.expiresAt <= ctx.now()) return 'Reconnect your store to refresh its earnings.'
    try {
      const snapshot = await gateway.overview(await secrets.open(grant.secret, accountId))
      if (snapshot.store.id !== grant.binding.storeId || snapshot.store.currency !== 'NGN' || !snapshot.paymentsEnabled) throw new Error('Store identity changed.')
      await store.transact(db => {
        const row = commerceOf(db, accountId)
        if (row?.grant?.secret === grant.secret) { row.grant.overview = snapshot; row.grant.observedAt = ctx.now() }
      })
      return undefined
    } catch (error) {
      const denied = error instanceof Error && 'status' in error && (error.status === 401 || error.status === 403 || error.status === 404)
      if (denied) await store.transact(db => { const row = commerceOf(db, accountId); if (row?.grant?.secret === grant.secret) { row.published = false; row.grant.expiresAt = ctx.now() } })
      return denied ? 'Reconnect your store to continue.' : 'Your store could not be reached. These figures may be out of date.'
    }
  }
  async function view(request: RouteRequest, connectionError?: string): Promise<CommerceResponse> {
    const csrf = request.cookie ? await csrfOf(request.cookie) : null
    return store.read(db => {
      const session = request.session(db), accountId = session?.account
      const signedIn = Boolean(accountId && db.accounts?.[accountId])
      const row = signedIn && accountId ? commerceOf(db, accountId) : null
      const address = session ? commerceAddress(session) : null
      return { enabled: Boolean(gateway), signedIn, accountEnabled: Boolean(ctx.config.accounts), csrf, address, commerce: row ? ownCommerce(row, address, ctx.now()) : null, ...(connectionError ? { connectionError } : {}) }
    })
  }
  async function revoke(secret: string, accountId: string): Promise<void> {
    if (!gateway) return
    try { await gateway.revoke(await secrets.open(secret, accountId)) } catch { ctx.core.log('Store connection revocation could not be confirmed; the grant will expire.') }
  }
  return {
    'GET /api/commerce': async request => {
      limit(request, 'read', 30)
      return { body: await view(request), headers: { 'Cache-Control': 'no-store' } }
    },
    'POST /api/commerce/refresh': async request => {
      limit(request, 'refresh', 8)
      const body = await request.json(), accountId = await guard(request, body)
      return { body: await view(request, await refresh(accountId)), headers: { 'Cache-Control': 'no-store' } }
    },
    'POST /api/commerce/start': async request => {
      limit(request, 'start', 6)
      const body = await request.json(), accountId = await guard(request, body)
      const name = profileText(body.name, 60), category = categoryOf(body.category), serviceArea = profileText(body.serviceArea, 160)
      const description = body.description === '' ? '' : profileText(body.description, 300)
      if (!name || !category || !serviceArea || description === null) return reject(400, 'commerce_profile_invalid', 'Enter a store name, category, description and delivery or pickup area.')
      if (body.adultAndTerms !== true) reject(400, 'commerce_terms_required', 'Confirm that you are at least 18 and will fulfill the products you sell.')
      await store.transact(db => {
        owner(db, request)
        const session = request.requireSession(db)
        if (!commerceAddress(session)) reject(409, 'commerce_plot_required', 'Choose your home plot before opening a starter store.')
        if (commerceOf(db, accountId)) return
        commerceStores(db).stores[accountId] = { id: ctx.randomId(), accountId, name, description, category, serviceArea, published: false, createdAt: ctx.now(), updatedAt: ctx.now(), grant: null, attempt: null }
      })
      return { body: await view(request) }
    },
    'POST /api/commerce/profile': async request => {
      limit(request, 'profile', 12)
      const body = await request.json(), accountId = await guard(request, body)
      const name = profileText(body.name, 60), category = categoryOf(body.category), serviceArea = profileText(body.serviceArea, 160)
      const description = body.description === '' ? '' : profileText(body.description, 300)
      if (!name || !category || !serviceArea || description === null) reject(400, 'commerce_profile_invalid', 'Check your store name, category and service area.')
      await store.transact(db => { owner(db, request); Object.assign(requireCommerce(db, accountId), { name, category, description, serviceArea, updatedAt: ctx.now() }) })
      return { body: await view(request) }
    },
    'POST /api/commerce/connect': async request => {
      limit(request, 'connect', 6)
      const body = await request.json(), accountId = await guard(request, body)
      if (!gateway) return reject(503, 'commerce_unavailable', 'Store connections are not available on this server yet.')
      const state = opaque(), verifier = opaque(), device = await challenge(await csrfOf(request.cookie ?? ''))
      const sealedVerifier = await secrets.seal(verifier, accountId)
      await store.transact(db => {
        owner(db, request)
        const row = requireCommerce(db, accountId)
        row.attempt = { state, verifier: sealedVerifier, device, redirectUri: gateway.redirectUri, expiresAt: ctx.now() + 10 * 60000, busy: false }
      })
      return { body: { authorizationUrl: gateway.authorizationUrl(state, await challenge(verifier)) } }
    },
    'POST /api/commerce/connect/complete': async request => {
      limit(request, 'complete', 8)
      const body = await request.json(), accountId = await guard(request, body)
      if (!gateway) return reject(503, 'commerce_unavailable', 'Store connections are not available on this server yet.')
      if (typeof body.code !== 'string' || !/^gmcc_[A-Za-z0-9_-]{43}$/.test(body.code) || typeof body.state !== 'string') return reject(400, 'commerce_callback_invalid', 'This store connection link is invalid. Connect again.')
      const device = await challenge(await csrfOf(request.cookie ?? ''))
      const attempt = await store.transact(db => {
        owner(db, request)
        const row = requireCommerce(db, accountId), current = row.attempt
        if (!current || current.busy || current.state !== body.state || current.device !== device || current.expiresAt <= ctx.now() || current.redirectUri !== gateway.redirectUri) return reject(409, 'commerce_connection_expired', 'This store connection has expired. Connect again from this device.')
        current.busy = true
        return { ...current }
      })
      let issued: string | undefined
      try {
        const exchanged = await gateway.exchange(body.code, await secrets.open(attempt.verifier, accountId))
        issued = exchanged.grantToken
        if (exchanged.expiresAt <= ctx.now()) throw new Error('Expired grant')
        const snapshot = await gateway.overview(issued)
        if (snapshot.store.id !== exchanged.binding.storeId || snapshot.store.currency !== 'NGN' || !snapshot.paymentsEnabled) return reject(409, 'commerce_currency_invalid', 'Choose an active naira store with a connected payment provider.')
        const secret = await secrets.seal(issued, accountId)
        const previous = await store.transact(db => {
          owner(db, request)
          const row = requireCommerce(db, accountId)
          if (row.attempt?.state !== attempt.state || !row.attempt.busy) return reject(409, 'commerce_connection_changed', 'Your store connection changed. Connect again.')
          const old = row.grant?.secret ?? null
          row.grant = { secret, expiresAt: exchanged.expiresAt, binding: exchanged.binding, overview: snapshot, observedAt: ctx.now() }
          row.attempt = null; row.published = false; row.updatedAt = ctx.now()
          return old
        })
        issued = undefined
        if (previous) await revoke(previous, accountId)
        return { body: await view(request) }
      } catch (error) {
        if (issued) await gateway.revoke(issued).catch(() => ctx.core.log('Unfinished store connection could not be revoked.'))
        await store.transact(db => { const row = commerceOf(db, accountId); if (row?.attempt?.state === attempt.state) row.attempt = null })
        if (error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code.startsWith('commerce_')) throw error
        return reject(502, 'commerce_connect_failed', 'Your store could not be connected. Return to My Store and connect again.')
      }
    },
    'POST /api/commerce/publish': async request => {
      limit(request, 'publish', 8)
      const body = await request.json(), accountId = await guard(request, body)
      if (typeof body.published !== 'boolean') reject(400, 'commerce_state_invalid', 'Choose whether your store is open.')
      if (body.published && await refresh(accountId)) return reject(409, 'commerce_verification_required', 'Reconnect and refresh your store before opening it.')
      await store.transact(db => {
        owner(db, request)
        const row = requireCommerce(db, accountId)
        if (body.published && (!commerceAddress(request.requireSession(db)) || !row.grant?.overview || row.grant.expiresAt <= ctx.now() || row.grant.overview.environment !== 'production' || !row.grant.overview.paymentsEnabled)) reject(409, 'commerce_not_ready', 'Connect a live store and choose a home plot before opening it.')
        row.published = body.published === true; row.updatedAt = ctx.now()
      })
      return { body: await view(request) }
    },
    'POST /api/commerce/disconnect': async request => {
      limit(request, 'disconnect', 6)
      const body = await request.json(), accountId = await guard(request, body)
      const secret = await store.transact(db => { owner(db, request); const row = requireCommerce(db, accountId), secret = row.grant?.secret; row.grant = null; row.attempt = null; row.published = false; row.updatedAt = ctx.now(); return secret })
      if (secret) await revoke(secret, accountId)
      return { body: await view(request) }
    },
    'GET /api/commerce/directory': async request => {
      limit(request, 'directory', 30)
      const city = ctx.cityIds.find(id => id === request.query.get('city'))
      if (!city) reject(400, 'invalid_city', 'Choose a city to browse stores.')
      const after = request.query.get('after') ?? '', lga = request.query.get('lga'), player = request.query.get('owner')
      if (after.length > 100 || (lga?.length ?? 0) > 100 || (player?.length ?? 0) > 100) reject(400, 'commerce_filter_invalid', 'This store search is invalid.')
      const candidates = await store.read(db => {
        request.requireSession(db)
        const items: { listing: CommerceListing; accountId: string; secret: string; storeId: string }[] = []
        for (const row of Object.values(db.commerce?.stores ?? {})) {
          if (!row || !row.published || row.id <= after || !row.grant?.overview || row.grant.expiresAt <= ctx.now() || row.grant.overview.environment !== 'production') continue
          const account = db.accounts?.[row.accountId], session = account?.sessionKey ? db.sessions[account.sessionKey] : undefined
          if (!account || !session || session.account !== row.accountId || (player && session.publicId !== player)) continue
          const address = commerceAddress(session)
          if (!address || address.city !== city || (lga && address.lga !== lga)) continue
          items.push({ listing: { id: row.id, name: row.name, description: row.description, category: row.category, serviceArea: row.serviceArea, address, storefrontUrl: row.grant.overview.store.publicUrl }, accountId: row.accountId, secret: row.grant.secret, storeId: row.grant.binding.storeId })
        }
        items.sort((a, b) => a.listing.id.localeCompare(b.listing.id))
        const page = items.slice(0, 20)
        return { items: page, next: items.length > 20 ? page.at(-1)?.listing.id ?? null : null }
      })
      const checked = await Promise.all(candidates.items.map(async item => {
        if (!gateway) return null
        const recent = publicChecks.get(item.listing.id)
        if (recent && recent.secret === item.secret && recent.at > ctx.now() - 30000) return { ...item.listing, storefrontUrl: recent.url }
        try {
          const snapshot = await gateway.overview(await secrets.open(item.secret, item.accountId))
          if (snapshot.store.id !== item.storeId || snapshot.environment !== 'production' || !snapshot.paymentsEnabled || snapshot.store.currency !== 'NGN') return null
          if (publicChecks.size >= 256) publicChecks.clear()
          publicChecks.set(item.listing.id, { secret: item.secret, at: ctx.now(), url: snapshot.store.publicUrl })
          return { ...item.listing, storefrontUrl: snapshot.store.publicUrl }
        } catch { publicChecks.delete(item.listing.id); return null }
      }))
      const answer: CommerceDirectory = { items: checked.filter((item): item is CommerceListing => item !== null), next: candidates.next }
      return { body: answer, headers: { 'Cache-Control': 'no-store' } }
    },
  }
}
