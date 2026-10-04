// The Stay in touch form, kept for the page: closing the sheet does not lose a half-typed address.
import { reactive, ref } from 'vue'
import type { EmailResult } from '../../../types/growth.ts'
import type { PushKind } from './boundary.ts'

export interface TouchDraft {
  /** Which request is on its way: it disables the controls it belongs to. */
  busy: 'age' | 'push' | 'email' | null
  /** The address as typed (trimmed when sent). */
  email: string
  tick: boolean
  /** The notification question is open. */
  pushAsk: boolean
  /** The answer to the last e-mail request (carries the confirmation path in dry-run). */
  note: Extract<EmailResult, { ok: true }> | null
}
export const touch = reactive<TouchDraft>({ busy: null, email: '', tick: false, pushAsk: false, note: null })
/** What this browser can do about notifications, once known. */
export const pushKind = ref<PushKind | null>(null)
