// Report a problem: the form's state and the two requests behind it. The draft lives here, not in
// the component, so what the player typed is still there after the phone is closed and reopened.
// The server attaches the context by itself (build, city, last actions, last wallet lines): the
// form sends only a category, the text and one retry key.
import { reactive, ref, shallowRef } from 'vue'
import type { FileReportBody, FileReportResponse, MyReportsResponse, SupportCategory, SupportLimits, SupportReceipt, SupportStatus } from '../../../types/support.ts'
import type { CityId } from '../../../types/protocol.ts'
import type { ApiError, FetchJson } from '../../types/client.ts'

export const CATEGORY_LABELS: Readonly<Record<SupportCategory, string>> = { money: 'Money or balance', stuck: 'I am stuck', messages: 'Messages or invites', people: 'Another player', bug: 'Something is broken', other: 'Something else' }
export const STATUS_LABELS: Readonly<Record<SupportStatus, string>> = { received: 'Received — waiting for a moderator', reviewing: 'Being looked at', resolved: 'Resolved', dismissed: 'Closed without action' }
export const DEFAULT_LIMITS: SupportLimits = { text: 600, open: 5 }
export const MIN_TEXT = 3
export const SENT_WITH_RULES: readonly string[] = [
  'Sent with your report automatically: the game build, your city and where you are, your last 10 actions and their results, the last thing that was refused, and your last 10 wallet lines.',
  'Your device’s secret is never included.',
  'The report is filed on this server and you get a receipt number at once — no e-mail or other account is needed.',
  'Its status and any reply from a moderator appear under “Your reports”, and as a red badge on this app.',
]

export const isCategory = (value: unknown): value is SupportCategory => typeof value === 'string' && Object.hasOwn(CATEGORY_LABELS, value)
export const statusTone = (status: SupportStatus): 'good' | 'neutral' | 'warn' => (status === 'resolved' ? 'good' : status === 'dismissed' ? 'neutral' : 'warn')
/** Why the text cannot be sent yet, or null. */
export const textProblem = (text: string): string | null => (text.trim().length < MIN_TEXT ? 'Write a few words about what happened, then send.' : null)
/** What to say when the request itself failed. The text is kept either way, and a retry reuses the same key. */
export const sendFailure = (error: Pick<ApiError, 'status'> | null | undefined): string => (error?.status === 429
  ? 'Too many requests just now. Your text is kept; try again in a minute.'
  : 'The report could not be sent. Your text is kept; press Send report to try again — it will not be filed twice.')

export interface SupportNotice { kind: 'good' | 'error'; text: string }
export interface ReportList { reports: SupportReceipt[]; limits: SupportLimits; failed: boolean }
export interface SupportDeps {
  fetchJson: FetchJson
  newId: () => string
  cityId: () => CityId
  /** Called with every list that loads, so the Phone's badge knows about replies (src/ui/phone/reports.js). */
  onLoaded?: (reports: SupportReceipt[]) => void
  onFiled?: () => void
}

export function createSupport(deps: SupportDeps) {
  const draft = reactive<{ category: SupportCategory; text: string; clientId: string | null }>({ category: 'bug', text: '', clientId: null })
  const list = shallowRef<ReportList | null>(null)
  const loading = ref(false)
  const sending = ref(false)
  const notice = shallowRef<SupportNotice | null>(null)
  /** The id of the report filed last, for the toast. */
  const lastReceipt = ref('')

  async function load(): Promise<void> {
    if (loading.value) return
    loading.value = true
    try {
      const reply = await deps.fetchJson<MyReportsResponse>('/api/support/reports')
      list.value = { reports: reply.reports, limits: reply.limits, failed: false }
      deps.onLoaded?.(reply.reports)
    } catch {
      // What was loaded before stays on screen, with the failure said beside it.
      list.value = { reports: list.value?.reports ?? [], limits: list.value?.limits ?? DEFAULT_LIMITS, failed: true }
    } finally { loading.value = false }
  }

  /** A category handed over by another screen is applied only while nothing has been typed. */
  function preset(category: unknown): void { if (isCategory(category) && !draft.text) draft.category = category }

  /** Send the draft. Resolves true when the report was filed. */
  async function submit(): Promise<boolean> {
    if (sending.value) return false
    const text = draft.text.trim()
    const problem = textProblem(text)
    if (problem) { notice.value = { kind: 'error', text: problem }; return false }
    // One id per report, reused if the send has to be retried, so a retry can never file it twice.
    draft.clientId ||= deps.newId()
    sending.value = true
    notice.value = null
    try {
      const body: FileReportBody = { cityId: deps.cityId(), category: draft.category, text, clientId: draft.clientId as FileReportBody['clientId'] }
      const reply = await deps.fetchJson<FileReportResponse>('/api/support/reports', { method: 'POST', body })
      if (reply.ok) {
        lastReceipt.value = reply.receipt.id
        notice.value = { kind: 'good', text: `Report ${reply.receipt.id} was received. Its status will appear below; you can close this page.` }
        draft.text = ''; draft.clientId = null
        deps.onFiled?.()
        list.value = null
        void load()
        return true
      }
      notice.value = { kind: 'error', text: reply.reason || 'The report was not filed. Nothing was sent; try again.' }
    } catch (error) {
      notice.value = { kind: 'error', text: sendFailure(error as ApiError) }
    } finally { sending.value = false }
    return false
  }

  return { draft, list, loading, sending, notice, lastReceipt, load, preset, submit, reload(): void { list.value = null; void load() } }
}
export type Support = ReturnType<typeof createSupport>
