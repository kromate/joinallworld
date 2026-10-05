// What every social screen starts with: the shared social client (started, which is idempotent),
// the gate it shows until the overview has loaded, and the one-tap way out of a connection state.
import { computed, onMounted } from 'vue'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import { gateOf } from './socialWords.ts'
import { useSocial } from './useSocial.ts'

export function useSocialScreen() {
  const app = useApp()
  const { game, shell, api } = app
  const client = useSocial()
  const view = game.view
  const gate = computed(() => gateOf({
    onboardingRequired: Boolean(view.value.onboarding?.required),
    connected: view.value.connected,
    why: linkWords(view.value)?.why ?? 'Not connected.',
    error: client.state.error,
    hasOverview: Boolean(client.state.me),
  }))
  const action = computed(() => linkWords(view.value)?.action ?? null)
  /** The connection state's action: reconnect, or open the session panel for a new or expired life. */
  function runAction(): void {
    const next = action.value
    if (!next) return
    if (next.menu) app.menu(next.menu)
    else if (next.gate) { const target = shell.sessionGate(next.gate); if (target) shell.open(target.id, { reason: next.gate }) }
  }
  function retryLoad(): void { client.state.error = null; void client.sync() }
  /** Why nothing can be changed, as a sentence for `what` ('call', 'search'); '' when connected. */
  const cannot = (what: string): string => (view.value.connected ? '' : linkWords(view.value)?.cannot(what) ?? 'Not connected.')
  onMounted(() => client.start(api))
  return { app, game, shell, client, state: client.state, view, gate, action, runAction, retryLoad, cannot }
}
