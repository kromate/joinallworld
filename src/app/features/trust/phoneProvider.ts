const BASE = 'https://identitytoolkit.googleapis.com/v1/'
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
export function phoneProvider(apiKey: string, request: typeof fetch = fetch) {
  async function call(path: string, body?: object): Promise<Record<string, unknown>> {
    let response: Response
    try { response = await request(`${BASE}${path}?key=${encodeURIComponent(apiKey)}`, { method: body ? 'POST' : 'GET', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000) }) }
    catch { throw Error('Google could not be reached. Check your connection and try again.') }
    const raw = await response.text()
    if (raw.length > 16384) throw Error('Google returned an unexpected response.')
    let value: unknown
    try { value = JSON.parse(raw) } catch { throw Error('Google returned an unexpected response.') }
    if (!response.ok || !record(value)) {
      const code = record(value) && record(value.error) ? value.error.message : ''
      if (code === 'INVALID_CODE') throw Error('That code did not match. Check the latest SMS and try again.')
      if (code === 'SESSION_EXPIRED') throw Error('That code expired. Start a new phone check.')
      if (code === 'TOO_MANY_ATTEMPTS_TRY_LATER' || code === 'QUOTA_EXCEEDED') throw Error('Phone checks are temporarily limited. Try again later.')
      throw Error('Google could not verify this number. Check the number and start again.')
    }
    return value
  }
  return {
    async siteKey() { const value = await call('recaptchaParams'); if (typeof value.recaptchaSiteKey !== 'string') throw Error('The phone challenge is unavailable.'); return value.recaptchaSiteKey },
    async send(phoneNumber: string, recaptchaToken: string) {
      if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber) || !recaptchaToken) throw Error('Use an international number, such as +234…, and complete the challenge.')
      const value = await call('accounts:sendVerificationCode', { phoneNumber, recaptchaToken })
      if (typeof value.sessionInfo !== 'string' || value.sessionInfo.length > 8192) throw Error('A verification code could not be sent.')
      return value.sessionInfo
    },
    async link(sessionInfo: string, code: string, idToken: string) {
      if (!/^\d{6}$/.test(code)) throw Error('Enter the six-digit code from the SMS.')
      const value = await call('accounts:signInWithPhoneNumber', { sessionInfo, code, idToken })
      if (value.temporaryProof || value.isNewUser === true || typeof value.localId !== 'string' || typeof value.idToken !== 'string') throw Error('This number could not be linked to your account. It may belong to another account.')
    },
  }
}

interface Recaptcha { ready(callback: () => void): void; render(host: HTMLElement, options: object): number; reset(id: number): void }
let loading: Promise<Recaptcha> | null = null
function captchaApi(): Recaptcha | null {
  const api: unknown = Reflect.get(globalThis, 'grecaptcha')
  return record(api) && typeof api.ready === 'function' && typeof api.render === 'function' && typeof api.reset === 'function' ? api as unknown as Recaptcha : null
}
function loadCaptcha(): Promise<Recaptcha> {
  if (loading) return loading
  loading = new Promise<Recaptcha>((resolve, reject) => {
    const script = document.createElement('script'), timer = setTimeout(() => fail(), 12000)
    function fail() { clearTimeout(timer); script.remove(); loading = null; reject(Error('The phone challenge could not load. Try again.')) }
    script.src = 'https://www.google.com/recaptcha/api.js?render=explicit'; script.async = true; script.onerror = fail
    script.onload = () => { const api = captchaApi(); if (!api) { fail(); return }; api.ready(() => { clearTimeout(timer); resolve(api) }) }
    document.head.append(script)
  })
  return loading
}
export async function mountPhoneCaptcha(host: HTMLElement, apiKey: string, onToken: (token: string) => void): Promise<() => void> {
  const [api, sitekey] = await Promise.all([loadCaptcha(), phoneProvider(apiKey).siteKey()])
  if (!host.isConnected) return () => {}
  const id = api.render(host, { sitekey, size: 'compact', callback: onToken, 'expired-callback': () => onToken(''), 'error-callback': () => onToken('') })
  return () => { api.reset(id); host.replaceChildren(); onToken('') }
}
