// The Messages app's own UI state: which tab, which conversation, the draft. It lives outside the
// component so it survives closing and reopening the phone, as it does in the existing panel.
import { reactive } from 'vue'
import { createNoticeMarks } from './messagesModel.ts'

export const ui = reactive<{
  tab: 'chats' | 'updates'
  /** The conversation on screen: its id, or `to:<publicId>` for a chat the server has not created yet. */
  open: string | null
  /** The name to show for a provisional chat. */
  openName: string | null
  draft: string
  /** A sentence another screen has ready (a stuck player asking a friend): it fills the box of the next conversation opened. */
  prefill: string
  /** The group's member list is showing. */
  manage: boolean
}>({ tab: 'chats', open: null, openName: null, draft: '', prefill: '', manage: false })

function deviceStorage(): Storage | null { try { return globalThis.localStorage ?? null } catch { return null } }
export const noticeMarks = createNoticeMarks(deviceStorage())

/** Another conversation (or the list) is on screen: the group list closes and the old draft is not carried over. */
export function showConversation(key: string | null): void {
  ui.open = key; ui.manage = false; ui.draft = key ? ui.prefill : ''
  if (key) ui.prefill = ''
}
/** The draft to send, or null when there is nothing to send. Taking it clears the field. */
export function takeDraft(): string | null {
  const body = ui.draft.trim()
  if (!body || !ui.open) return null
  ui.draft = ''
  return body
}
