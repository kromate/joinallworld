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
  /** The group's member list is showing. */
  manage: boolean
}>({ tab: 'chats', open: null, openName: null, draft: '', manage: false })

function deviceStorage(): Storage | null { try { return globalThis.localStorage ?? null } catch { return null } }
export const noticeMarks = createNoticeMarks(deviceStorage())
