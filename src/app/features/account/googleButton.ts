// The Google button. Google's own script draws it (so its look follows Google's branding rules by
// construction) and hands back a credential when the person has chosen an account. The script is
// added to the page only when the sign-in screen is open and Google sign-in is configured; nothing
// here runs on a page that never opens sign-in.
import { credentialClaim } from './accountModel.ts'

export const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client'
const LOAD_TIMEOUT_MS = 8000

/** The part of Google's identity API this page uses. */
export interface GoogleIdentity {
  initialize(options: { client_id: string; nonce: string; auto_select: false; callback(reply: unknown): void }): void
  renderButton(host: HTMLElement, options: { type: 'standard'; theme: 'outline'; size: 'large'; text: 'continue_with'; shape: 'rectangular'; logo_alignment: 'left'; width: number }): void
  cancel(): void
}
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && (typeof value === 'object' || typeof value === 'function')
function present(): GoogleIdentity | null {
  const google: unknown = Reflect.get(globalThis, 'google')
  const id = isRecord(google) && isRecord(google.accounts) ? google.accounts.id : null
  return isRecord(id) && typeof id.initialize === 'function' && typeof id.renderButton === 'function' && typeof id.cancel === 'function' ? id as unknown as GoogleIdentity : null
}

/** Google's identity API, loading its script the first time. Rejects when it cannot be loaded (blocked, offline). */
export function loadGoogleIdentity(doc: Document = document): Promise<GoogleIdentity> {
  const ready = present()
  if (ready) return Promise.resolve(ready)
  return new Promise((resolve, reject) => {
    const script = doc.createElement('script')
    script.src = GOOGLE_SCRIPT; script.async = true; script.referrerPolicy = 'strict-origin-when-cross-origin'
    const timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS)
    function finish(loaded: boolean): void {
      clearTimeout(timer); script.onload = null; script.onerror = null
      const api = loaded ? present() : null
      if (api) resolve(api); else { script.remove(); reject(new Error('Google sign-in could not be loaded')) }
    }
    script.onload = () => finish(true); script.onerror = () => finish(false)
    doc.head.append(script)
  })
}

/** 128 random bits as text: tied into the credential Google returns, so one made for another page view is not accepted here. */
export function newNonce(source: Pick<Crypto, 'getRandomValues'> = globalThis.crypto): string {
  return [...source.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** What was handed to `initialize` for one page's Google API: it is initialised ONCE (a second call logs a warning and is ignored), so what changes between buttons lives here. */
interface Started { clientId: string; nonce: string; handler: ((credential: string) => void) | null }
const started = new WeakMap<object, Started>()

/**
 * Draw the button into `host`. `onCredential` is called with Google's credential once the person has chosen an account
 * — only for a credential that carries the page's nonce (made when the API was first initialised; the server accepts a
 * token once, so a fresh nonce per button adds nothing). Initialises the API once per page and client id and only
 * re-renders after that. Returns how to remove the button.
 */
export function renderGoogleButton(api: GoogleIdentity, host: HTMLElement, clientId: string, onCredential: (credential: string) => void, nonce: string = newNonce()): () => void {
  let page = started.get(api)
  if (!page || page.clientId !== clientId) {
    const fresh: Started = { clientId, nonce, handler: null }
    page = fresh
    started.set(api, fresh)
    api.initialize({ client_id: clientId, nonce, auto_select: false, callback(reply) {
      const credential = isRecord(reply) ? reply.credential : null
      if (!fresh.handler || typeof credential !== 'string' || credential.length < 100 || credential.length > 4096 || credentialClaim(credential, 'nonce') !== fresh.nonce) return
      fresh.handler(credential)
    } })
  }
  const mine = onCredential
  page.handler = mine
  const current = page
  api.renderButton(host, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', logo_alignment: 'left', width: Math.max(200, Math.min(400, Math.round(host.clientWidth) || 280)) })
  return () => { if (current.handler === mine) current.handler = null; try { api.cancel() } catch { /* nothing to cancel */ } host.replaceChildren() }
}
