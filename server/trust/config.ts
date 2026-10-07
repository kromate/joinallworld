export const TRUST_PROVIDER_ENV = ['TRUST_FIREBASE_PHONE_ENABLED', 'DOJAH_APP_ID', 'DOJAH_PUBLIC_KEY', 'DOJAH_WIDGET_ID', 'DOJAH_WEBHOOK_SECRET', 'DOJAH_ENVIRONMENT', 'DOJAH_FLOW_REVIEWED'] as const

export function phoneConfigured(env: (name: string) => string, accounts: unknown): boolean {
  return Boolean(accounts) && env('TRUST_FIREBASE_PHONE_ENABLED') === '1'
}
export function trustHeaderConfig(env: (name: string) => string, accounts: unknown) {
  return { phone: phoneConfigured(env, accounts), id: Boolean(accounts) && dojahConfig(env) !== null }
}

/** Review confirms that this widget checks government ID and minimum age. */
export function dojahConfig(env: (name: string) => string) {
  const appId = env('DOJAH_APP_ID').trim(), publicKey = env('DOJAH_PUBLIC_KEY').trim(), widgetId = env('DOJAH_WIDGET_ID').trim()
  const secret = env('DOJAH_WEBHOOK_SECRET'), environment = env('DOJAH_ENVIRONMENT')
  if (env('DOJAH_FLOW_REVIEWED') !== '1' || !['sandbox', 'production'].includes(environment)
    || !/^[A-Za-z0-9_-]{6,128}$/.test(appId) || !/^[A-Za-z0-9_-]{6,160}$/.test(widgetId)
    || !/^[A-Za-z0-9_-]{16,256}$/.test(publicKey) || secret.length < 24 || secret.length > 512) return null
  return { appId, publicKey, widgetId, secret, environment }
}
