const KEY = 'allworld-commerce-return'
export interface StoreReturn { code: string; state: string; at: number }
function valid(value: unknown): value is StoreReturn {
  return Boolean(value && typeof value === 'object' && 'code' in value && typeof value.code === 'string' && /^gmcc_[A-Za-z0-9_-]{43}$/.test(value.code)
    && 'state' in value && typeof value.state === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.state)
    && 'at' in value && typeof value.at === 'number' && value.at <= Date.now() && Date.now() - value.at < 5 * 60000)
}
export function takeStoreReturn(): StoreReturn | null {
  const url = new URL(globalThis.location.href)
  let result: StoreReturn | null = null
  try {
    if (url.searchParams.get('commerce_return') === '1') {
      const candidate = { code: url.searchParams.get('code'), state: url.searchParams.get('state'), at: Date.now() }
      if (valid(candidate)) { result = candidate; globalThis.sessionStorage.setItem(KEY, JSON.stringify(candidate)) }
      else globalThis.sessionStorage.removeItem(KEY)
    } else {
      const stored: unknown = JSON.parse(globalThis.sessionStorage.getItem(KEY) || 'null')
      if (valid(stored)) result = stored
      else globalThis.sessionStorage.removeItem(KEY)
    }
  } catch { /* The current callback can still complete if this browser refuses storage. */ }
  if (url.searchParams.get('commerce_return') === '1') {
    for (const key of ['commerce_return', 'code', 'state']) url.searchParams.delete(key)
    globalThis.history.replaceState(null, '', url)
  }
  return result
}
export function clearStoreReturn(): void { try { globalThis.sessionStorage.removeItem(KEY) } catch { /* no stored callback */ } }
