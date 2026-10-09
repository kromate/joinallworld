import { reactive } from 'vue'
import type { FetchJson } from '../../types/client.ts'
import type { Conversation, HistoryResult, Message, MessagePinsBody, MessagePinsChangedFrame, MessagePinsView } from '../../../types/social.ts'

interface PinContext { generation: number; actor: string; conv: string; scope: string }
interface PinIntent { key: string; body: MessagePinsBody }
type PinMutationResult =
  | { ok: true; code: 'updated'; pins: MessagePinsView; duplicate?: true }
  | { ok: false; code: string; reason: string }

const AUTHORITY_REFUSALS = new Set(['owner_only', 'blocked', 'not_a_member', 'conversation_changed'])

export interface MessagePinsState {
  view: MessagePinsView | null
  loading: boolean
  pending: boolean
  retryable: boolean
  error: string
}

export function canPinMessage(message: Message): boolean {
  if (!message.from || message.sys || message.auto || message.gift || message.deleted || message.image?.state || message.voice?.state) return false
  return Boolean(message.body.trim() || message.image || message.voice)
}

export function createMessagePins(options: {
  fetchJson: FetchJson
  newId: () => string
  actor: () => string | null
  connected: () => boolean
}) {
  const state = reactive<MessagePinsState>({ view: null, loading: false, pending: false, retryable: false, error: '' })
  let generation = 0, actor = '', conv = '', contextKey = '', disposed = false
  let projectionGeneration = 0, loadSequence = 0, mutationSequence = 0
  let retry: PinIntent | null = null
  let acceptedScope = '', acceptedRevision = -1, acceptedCanManage: boolean | null = null

  const capture = (scope: string): PinContext => ({ generation, actor, conv, scope })
  const contextCurrent = (context: PinContext): boolean => !disposed && context.generation === generation && context.actor === options.actor() && context.actor === actor && context.conv === conv
  const reason = (error: unknown): string => {
    if (typeof error === 'object' && error !== null) {
      if ('reason' in error && typeof error.reason === 'string' && error.reason) return error.reason
      if ('status' in error && typeof error.status === 'number' && error.status) return 'Shared pins could not be updated.'
    }
    return 'Couldn’t confirm that change. Check your connection and retry the same change.'
  }
  function applyProjection(next: MessagePinsView): boolean {
    if (acceptedScope === next.scope && next.revision < acceptedRevision) return false
    state.view = next; projectionGeneration += 1
    acceptedScope = next.scope; acceptedRevision = next.revision; acceptedCanManage = next.canManage
    return true
  }
  const authorityKey = (next: Conversation): string => `${next.id}:${next.owner ?? ''}:${next.members.map((member) => member.id).join(',')}`
  function resetView(): void {
    retry = null; loadSequence += 1; mutationSequence += 1; projectionGeneration += 1
    acceptedScope = ''; acceptedRevision = -1; acceptedCanManage = null
    Object.assign(state, { view: null, loading: false, pending: false, retryable: false, error: '' })
  }
  function invalidateAuthority(message: string): void { generation += 1; resetView(); state.error = message }
  function authorityError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    const status = 'status' in error && typeof error.status === 'number' ? error.status : 0
    const code = 'code' in error && typeof error.code === 'string' ? error.code : ''
    return status === 401 || status === 403 || status === 404 || ['actor_changed', 'device_session_required', 'not_a_member', 'blocked', 'invalid_conversation'].includes(code)
  }
  const authorityRefusal = (result: PinMutationResult): result is Extract<PinMutationResult, { ok: false }> => !result.ok && AUTHORITY_REFUSALS.has(result.code)
  function acceptAuthoritative(nextConv: Conversation, next: MessagePinsView): void {
    const nextKey = authorityKey(nextConv)
    if (!nextConv.members.some((member) => member.id === actor)) { contextKey = nextKey; invalidateAuthority('You are not in that conversation.'); return }
    const authorityChanged = nextKey !== contextKey || acceptedCanManage !== null && acceptedCanManage !== next.canManage
    const scopeChanged = Boolean(acceptedScope && acceptedScope !== next.scope)
    if (authorityChanged || scopeChanged) {
      generation += 1; contextKey = nextKey; resetView()
    }
    contextKey = nextKey
    applyProjection(next)
  }

  async function load(preserveError = false): Promise<void> {
    if (!actor || !conv || !options.connected()) return
    const request = ++loadSequence, context = capture(state.view?.scope ?? ''), projection = projectionGeneration
    state.loading = true; if (!retry && !preserveError) state.error = ''
    try {
      const result = await options.fetchJson<HistoryResult>(`/api/social/conversations/${encodeURIComponent(context.conv)}?limit=1`)
      if (!contextCurrent(context) || request !== loadSequence || projection !== projectionGeneration) return
      if (!result.ok) { invalidateAuthority(result.reason); return }
      if (!result.pins) { invalidateAuthority('Shared pins are unavailable.'); return }
      acceptAuthoritative(result.conv, result.pins)
    } catch (error) {
      if (contextCurrent(context) && request === loadSequence && projection === projectionGeneration) {
        if (authorityError(error)) invalidateAuthority(reason(error))
        else { state.view = null; state.error = reason(error) }
      }
    } finally {
      if (contextCurrent(context) && request === loadSequence) state.loading = false
    }
  }

  function setContext(nextActor: string | null, nextConv: Conversation | null): void {
    const nextId = nextConv?.id ?? ''
    const nextKey = nextConv ? authorityKey(nextConv) : ''
    if ((nextActor ?? '') === actor && nextId === conv && nextKey === contextKey) return
    generation += 1; actor = nextActor ?? ''; conv = nextId; contextKey = nextKey
    resetView()
    if (actor && conv) void load()
  }

  async function sendIntent(intent: PinIntent): Promise<void> {
    if (!options.connected()) { state.error = 'Reconnect to retry this shared pin change.'; state.retryable = true; return }
    const context = capture(intent.body.scope), attempt = ++mutationSequence, projection = projectionGeneration
    state.pending = true; state.retryable = false; state.error = ''
    try {
      const result = await options.fetchJson<PinMutationResult>(`/api/social/conversations/${encodeURIComponent(context.conv)}/pins`, { method: 'POST', body: intent.body })
      if (!contextCurrent(context) || attempt !== mutationSequence) return
      if (!result.ok) {
        if (authorityRefusal(result)) { invalidateAuthority(result.reason); void load(true) }
        else { retry = null; state.error = result.reason; void load(true) }
        return
      }
      if (result.pins.scope !== context.scope || result.pins.revision < intent.body.pinRevision) {
        state.error = 'The shared pins changed while this request was finishing. Retry the same change.'
        state.retryable = true; void load(); return
      }
      retry = null; state.retryable = false
      if (!state.view || state.view.scope === result.pins.scope) {
        if (projection === projectionGeneration || result.pins.revision > (state.view?.revision ?? -1)) applyProjection(result.pins)
      }
      else { generation += 1; resetView(); state.error = 'That conversation changed. Open it again.'; void load() }
    } catch (error) {
      if (contextCurrent(context) && attempt === mutationSequence) {
        if (authorityError(error)) invalidateAuthority(reason(error))
        else { state.error = reason(error); state.retryable = true }
      }
    } finally {
      if (contextCurrent(context) && attempt === mutationSequence) state.pending = false
    }
  }

  function change(op: { message: Message; pinned: boolean } | { clearAll: true }): void {
    const pins = state.view
    if (!pins || state.pending || !actor || !conv) return
    if (retry) { state.error = 'Retry or dismiss the earlier pin change before starting another.'; state.retryable = true; return }
    const key = 'clearAll' in op ? `clear:${pins.scope}:${pins.revision}` : `set:${pins.scope}:${pins.revision}:${op.message.seq}:${op.message.version ?? 0}:${op.pinned}`
    const body: MessagePinsBody = 'clearAll' in op
      ? { scope: pins.scope, pinRevision: pins.revision, clientId: options.newId(), op: 'clear-all' }
      : { scope: pins.scope, pinRevision: pins.revision, clientId: options.newId(), op: 'set', seq: op.message.seq, messageVersion: op.message.version ?? 0, pinned: op.pinned }
    retry = { key, body }
    void sendIntent(retry)
  }

  function retryChange(): void { if (retry && !state.pending) void sendIntent(retry) }
  function dismissRetry(): void { if (!state.pending) { retry = null; state.retryable = false; state.error = '' } }

  function receive(frame: MessagePinsChangedFrame): void {
    if (disposed || frame.conv.id !== conv || actor !== options.actor()) return
    acceptAuthoritative(frame.conv, frame.pins)
    if (!retry) state.error = ''
  }

  function reconnect(): void { if (actor && conv) void load() }
  function dispose(): void { disposed = true; generation += 1; resetView() }

  return { state, setContext, load, change, retryChange, dismissRetry, receive, reconnect, dispose }
}
