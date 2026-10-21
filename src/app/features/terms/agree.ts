type Request = (path: string, options?: { method?: string; body?: Record<string, unknown> }) => Promise<object>
const pending = new Map<string, Promise<boolean>>()

export function agreeToShare(request: Request, actor = ''): Promise<boolean> {
  const current = pending.get(actor)
  if (current) return current
  const work = check(request).finally(() => { pending.delete(actor) })
  pending.set(actor, work)
  return work
}

async function check(request: Request): Promise<boolean> {
  const state = await request('/api/sharing/terms')
  if ('accepted' in state && state.accepted === true) return true
  if (!('version' in state) || typeof state.version !== 'string' || typeof document === 'undefined') return false
  const version = state.version
  await import('./agree.css')
  return new Promise<boolean>(resolve => {
    const previous = document.activeElement
    const dialog = document.createElement('dialog')
    dialog.className = 'sharing-rules'
    dialog.setAttribute('aria-labelledby', 'sharing-rules-title')
    dialog.innerHTML = `<form method="dialog"><h2 id="sharing-rules-title">Allworld's rules</h2><ul><li>Treat people with care. No hate, harassment or sexual content.</li><li>Protect children and private details. Report and block abuse.</li><li>No scams, illegal goods or real-money gambling. Game coins have no cash value.</li></ul><p><a href="/terms" target="_blank" rel="noopener">Read the full terms</a></p><label><input type="checkbox" name="over13"> I am 13 or over and agree to Allworld's rules.</label><p class="sharing-error" role="alert"></p><div class="sharing-buttons"><button type="button" data-cancel>Cancel</button><button type="submit" disabled>Agree</button></div></form>`
    const form = dialog.querySelector('form'), age = dialog.querySelector('input'), agree = dialog.querySelector('button[type=submit]'), error = dialog.querySelector('.sharing-error')
    if (!(form instanceof HTMLFormElement) || !(age instanceof HTMLInputElement) || !(agree instanceof HTMLButtonElement) || !error) { resolve(false); return }
    let saving = false
    const finish = (accepted: boolean): void => { dialog.close(); dialog.remove(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); resolve(accepted) }
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!saving) finish(false) })
    dialog.querySelector('[data-cancel]')?.addEventListener('click', () => { if (!saving) finish(false) })
    age.addEventListener('change', () => { agree.disabled = !age.checked || saving })
    form.addEventListener('submit', event => {
      event.preventDefault()
      if (!age.checked || saving) return
      saving = true; agree.disabled = true; error.textContent = ''
      void request('/api/sharing/terms', { method: 'POST', body: { version, over13: true } }).then(result => {
        if (!('accepted' in result) || result.accepted !== true) throw Error('Your agreement could not be saved. Try again.')
        finish(true)
      }).catch(failure => { saving = false; agree.disabled = !age.checked; error.textContent = failure instanceof Error ? failure.message : 'Your agreement could not be saved. Try again.' })
    })
    document.body.append(dialog); dialog.showModal(); age.focus()
  })
}

export async function agreeBeforeSocketSharing(): Promise<boolean> {
  const identity = await fetch('/api/session', { credentials: 'same-origin' })
  const view: unknown = await identity.json()
  if (!identity.ok || !view || typeof view !== 'object' || !('session' in view) || !view.session || typeof view.session !== 'object' || !('id' in view.session) || typeof view.session.id !== 'string') throw Error('Your player could not be checked. Try again.')
  const actor = view.session.id
  return agreeToShare(async (path, options) => {
    const response = await fetch(path, { method: options?.method ?? 'GET', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Allworld-Actor': actor }, ...(options?.body ? { body: JSON.stringify(options.body) } : {}) })
    const body: unknown = await response.json()
    if (!response.ok || body === null || typeof body !== 'object') throw Error('Your agreement could not be checked. Try again.')
    return body
  }, actor)
}
