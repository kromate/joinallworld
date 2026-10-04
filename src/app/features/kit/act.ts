// What a Vue panel does when a control sends one action, shared by the panels of this batch.
//
// An existing panel's `data-action` button is handled by src/app/legacy/declarative.ts: send the
// action, close the sheet on success when the markup said `data-then="close"`, and otherwise
// confirm a success with the server's own message as a toast, because a sheet covers the scene.
// `useAct()` is the same behaviour for a component, with one addition: while an action is on its
// way the control that sent it is disabled (`pending`), so it cannot be pressed twice.
import { ref } from 'vue'
import { useApp } from '../../state/app.ts'

export interface Acted { ok: boolean }
export interface ActOptions {
  /** Close the sheet when the action succeeds (`data-then="close"`). */
  close?: boolean
}

export function useAct() {
  const { game, shell } = useApp()
  /** The key of the action that is on its way, or null. One at a time: the server refuses a second as 'busy'. */
  const pending = ref<string | null>(null)
  async function act(key: string, send: () => Promise<Acted>, options: ActOptions = {}): Promise<boolean> {
    if (pending.value !== null) return false
    pending.value = key
    try {
      const result = await send()
      if (result.ok && options.close) shell.close()
      else if (result.ok && shell.sheet.value && game.state.value.message) game.toast(game.state.value.message, 'good')
      return result.ok
    } finally { pending.value = null }
  }
  return { act, pending }
}

/** Why nothing can change while the game is not connected, in the words of the real link state; null when connected. */
export function readOnlyReason(why: string | null | undefined): string | null {
  return why ? `${why} Read-only until that is resolved.` : null
}
