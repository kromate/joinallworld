// One change to one player from the admin screens: the two requests a destructive change needs (the token, then the change), the line in
// "what just happened" and, for the changes that can be reversed, the Undo that goes with it. The server decides everything; this is the wire.
import { recordDone } from './adminUi.ts'
import { naira } from './adminModel.ts'
import type { useAdmin } from './useAdmin.ts'

export interface Outcome { ok: boolean; text: string; data?: Record<string, unknown> }
type Api = ReturnType<typeof useAdmin>

/** The change that takes `body` back, or null when it cannot be taken back (needs, rename, a message, a note, a sign-out). */
export function reverseOf(body: Record<string, unknown>, data: Record<string, unknown>): { label: string; body: Record<string, unknown> } | null {
  const reason = typeof body.reason === 'string' && body.reason ? `Undo: ${body.reason}`.slice(0, 200) : 'Undone from the admin screen'
  switch (body.action) {
    case 'credit': { const applied = Number(data.applied); return applied > 0 ? { label: `Take back ${naira(applied)}`, body: { action: 'debit', amount: applied, reason } } : null }
    case 'debit': { const applied = Number(data.applied); return applied > 0 ? { label: `Give back ${naira(applied)}`, body: { action: 'credit', amount: applied, reason } } : null }
    case 'mute': return { label: 'Lift the mute', body: { action: 'unmute' } }
    case 'suspend': return { label: 'Lift the suspension', body: { action: 'unsuspend', kind: body.kind } }
    case 'ban': return { label: 'Unban', body: { action: 'unban' } }
    default: return null
  }
}

/** Send one change. A destructive one asks for its token first and is then sent again with it. */
export async function perform(api: Api, id: string, name: string, body: Record<string, unknown>, options: { record?: boolean } = {}): Promise<Outcome> {
  const path = `/api/admin/players/${id}/act`, intent = `${id}:${body.action}:${JSON.stringify(body)}`
  let reply = await api.post<Record<string, unknown>>(path, body, intent)
  if (reply.ok && reply.data.code === 'confirmation_required') reply = await api.post(path, { ...body, confirm: reply.data.token }, intent)
  if (!reply.ok) { const out = { ok: false, text: reply.error.reason }; if (options.record !== false) recordDone(`${name}: ${out.text}`, false); return out }
  if (reply.data.ok !== true) { const out = { ok: false, text: String(reply.data.reason ?? reply.data.code) }; if (options.record !== false) recordDone(`${name}: ${out.text}`, false); return out }
  const text = `${name}: ${String(reply.data.summary)}${reply.data.duplicate ? ' (already applied)' : ''}`
  if (options.record !== false) {
    const back = reverseOf(body, reply.data)
    recordDone(text, true, back ? { label: back.label, run: () => perform(api, id, name, back.body, { record: false }).then((undone) => ({ ok: undone.ok, text: undone.ok ? `Undone for ${name}: ${undone.text}` : `Could not undo for ${name}: ${undone.text}` })) } : undefined)
  }
  return { ok: true, text, data: reply.data }
}
