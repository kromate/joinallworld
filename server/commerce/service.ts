import { COMMERCE_CATEGORIES } from '../../src/types/commerce.ts'
import type { CommerceAddress, CommerceCategory, OwnCommerce } from '../../src/types/commerce.ts'
import type { CommerceCollection, CommerceRecord } from './types.ts'
import type { Db, RouteContext, SessionRecord } from '../types.ts'
import { characterCity } from '../character.ts'

export function commerceStores(db: Db): CommerceCollection { return db.commerce ??= { stores: {} } }
export function commerceOf(db: Db, accountId: string): CommerceRecord | null { return db.commerce?.stores[accountId] ?? null }
export function commerceAddress(session: SessionRecord): CommerceAddress | null {
  const city = characterCity(session), life = city ? session.cities?.[city] : undefined, plot = life?.state.estate?.plot
  if (plot && life?.state.estate?.lga) return { city: life.state.estate.city, lga: plot.lga, estate: plot.estate, plot: plot.plot }
  return null
}
export function categoryOf(value: unknown): CommerceCategory | null { return COMMERCE_CATEGORIES.find(item => item.id === value)?.id ?? null }
export function profileText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const result = value.trim().replace(/\s+/g, ' ')
  return result && result.length <= max && !/[\u0000-\u001f\u007f]/.test(result) ? result : null
}
export function ownCommerce(row: CommerceRecord, address: CommerceAddress | null, now: number): OwnCommerce {
  const current = row.grant && row.grant.expiresAt > now
  return { id: row.id, name: row.name, description: row.description, category: row.category, serviceArea: row.serviceArea, published: row.published, address,
    connection: row.grant ? current ? 'connected' : 'expired' : 'disconnected', storefrontUrl: current ? row.grant?.overview?.store.publicUrl ?? null : null,
    overview: row.grant?.overview ?? null, observedAt: row.grant?.observedAt ?? null }
}
export const opaque = (): string => bytesToText(crypto.getRandomValues(new Uint8Array(32)))
function bytesToText(bytes: Uint8Array): string { return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
function textToBytes(value: string): Uint8Array { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)) }
export async function challenge(verifier: string): Promise<string> { return bytesToText(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))) }
export function commerceSecrets(ctx: RouteContext) {
  let key: ReturnType<typeof crypto.subtle.importKey> | undefined
  const getKey = (): ReturnType<typeof crypto.subtle.importKey> => key ??= ctx.keyFile('commerce-grants', () => ({ key: opaque() })).then(value => crypto.subtle.importKey('raw', textToBytes(value.key), 'AES-GCM', false, ['encrypt', 'decrypt']))
  return {
    async seal(token: string, accountId: string): Promise<string> {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(accountId) }, await getKey(), new TextEncoder().encode(token))
      return `${bytesToText(iv)}.${bytesToText(new Uint8Array(data))}`
    },
    async open(secret: string, accountId: string): Promise<string> {
      const [iv, data, extra] = secret.split('.')
      if (!iv || !data || extra) throw new Error('Store connection could not be read. Reconnect your store.')
      const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: textToBytes(iv), additionalData: new TextEncoder().encode(accountId) }, await getKey(), textToBytes(data))
      return new TextDecoder().decode(clear)
    },
  }
}
