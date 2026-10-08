import { onBeforeUnmount, ref, watch } from 'vue'
import type { FamilyCommand, FamilyView } from '../../../types/family.ts'
import type { SocialClient } from './socialClient.ts'

export function useFamily(client: SocialClient) {
  const data = ref<FamilyView | null>(null), error = ref<string | null>(null)
  const loading = ref(false), pending = ref(false)
  let revision = 0, disposed = false
  let retry: { command: FamilyCommand; clientId: string; actor: string } | null = null
  const canRetry = ref(false)
  async function load(): Promise<void> {
    const actor = client.state.me?.me.id, version = ++revision
    if (!actor) { data.value = null; loading.value = false; return }
    loading.value = true
    const result = await client.call<FamilyView>('/api/social/family')
    if (disposed || version !== revision || client.state.me?.me.id !== actor) return
    loading.value = false
    if (result.ok) { data.value = result; if (!canRetry.value) error.value = null }
    else error.value = result.reason
  }
  async function send(command: FamilyCommand, again = false): Promise<boolean> {
    const actor = client.state.me?.me.id
    if (pending.value || !actor) return false
    const request = again && retry?.actor === actor ? retry : { command, clientId: client.newClientId(), actor }
    pending.value = true; error.value = null; canRetry.value = false
    const result = await client.call('/api/social/family', { ...request.command, clientId: request.clientId })
    if (disposed || client.state.me?.me.id !== actor) return false
    pending.value = false
    if (!result.ok) {
      error.value = result.reason
      retry = result.transport ? request : null
      canRetry.value = Boolean(retry)
      return false
    }
    retry = null
    await load()
    return true
  }
  const retrySend = (): Promise<boolean> => retry ? send(retry.command, true) : Promise.resolve(false)
  watch(() => client.state.me, (next, previous) => {
    if (next?.me.id !== previous?.me.id) { data.value = null; retry = null; canRetry.value = false; pending.value = false; error.value = null }
    void load()
  }, { immediate: true })
  onBeforeUnmount(() => { disposed = true; revision += 1 })
  return { data, error, loading, pending, canRetry, load, send, retrySend }
}
