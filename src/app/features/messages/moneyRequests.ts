// What the chat does for requests for money: ask a friend, and answer a card (pay, decline, cancel). Each choice keeps one client id
// until the server has answered, so a double tap or a retry after a lost reply is the same call and cannot act twice; while a call is
// out its card is busy. The network and the thread are handed in, so this is tested without either (moneyRequests.test.ts).
import { reactive } from 'vue'
import { checkRequest, doneText, refusalText } from './moneyRequestModel.ts'
import type { AmountLimits, RequestOp } from './moneyRequestModel.ts'
import type { Message, MoneyRequestView } from '../../../types/social.ts'

/** The reply of either route, as far as the chat reads it. */
type Reply = { ok: true; request: MoneyRequestView; message?: Message } | { ok: false; code: string; reason: string; transport?: boolean }
export interface RequestHost {
  /** One write. Never throws: a refusal comes back as { ok: false, code, reason }. */
  call(path: string, body: unknown): Promise<Reply>
  newClientId(): string
  cityId(): string
  /** Show a message or a changed request in the open thread. */
  apply(message: Message | null, request: MoneyRequestView): void
  /** Say something to the player (an error that never reached the server). */
  toast(text: string, kind: 'good' | 'error'): void
  /** The cash and counters changed. */
  refreshLife(): void
}

export function createMoneyRequests(host: RequestHost) {
  const ask = reactive({ open: false, amount: '', note: '', clientId: '', busy: false, error: '' })
  /** Requests with a call out. */
  const busy = reactive(new Set<string>())
  const ids = new Map<string, string>()

  function openForm(): void { Object.assign(ask, { open: true, amount: '', note: '', clientId: host.newClientId(), busy: false, error: '' }) }
  function closeForm(): void { ask.open = false; ask.error = '' }

  async function submit(to: string, limits: AmountLimits): Promise<boolean> {
    if (ask.busy) return false
    const checked = checkRequest(ask.amount, ask.note, limits)
    if (!checked.ok) { ask.error = checked.reason; return false }
    ask.error = ''; ask.busy = true
    const result = await host.call('/api/social/money-requests', { to, amount: checked.amount, ...(checked.note ? { note: checked.note } : {}), clientId: ask.clientId })
    ask.busy = false
    // A refusal that reached the server is final for this id; one that did not is retried under the same id.
    if (!result.ok) { if (!result.transport) ask.clientId = host.newClientId(); ask.error = refusalText(result.code, result.reason); host.toast(ask.error, 'error'); return false }
    host.apply(result.message ?? null, result.request)
    ask.open = false; ask.amount = ''; ask.note = ''; ask.clientId = host.newClientId()
    host.toast('Request sent', 'good')
    return true
  }

  async function answer(id: string, op: RequestOp, name: string, amount: number): Promise<void> {
    if (busy.has(id)) return
    busy.add(id)
    const key = `${id}:${op}`
    const clientId = ids.get(key) ?? host.newClientId()
    ids.set(key, clientId)
    const result = await host.call('/api/social/money-requests/answer', { id, op, ...(op === 'pay' ? { cityId: host.cityId() } : {}), clientId })
    busy.delete(id)
    if (!result.ok) {
      // The card stays as it was. Only a call that never reached the server keeps its id for the retry.
      if (!result.transport) ids.delete(key)
      host.toast(refusalText(result.code, result.reason), 'error')
      return
    }
    ids.delete(key)
    host.apply(null, result.request)
    host.toast(doneText(op, amount, name), 'good')
    if (op === 'pay') host.refreshLife()
  }

  return { ask, busy, openForm, closeForm, submit, answer }
}
export type MoneyRequests = ReturnType<typeof createMoneyRequests>
