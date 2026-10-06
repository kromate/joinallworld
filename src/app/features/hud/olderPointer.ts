// The one-time pointer to "Older characters", fetched a few seconds after the page is up (GuestBarSlot.vue): not part of the first download.
import { callVisible } from '../calls/callState.ts'
import { tour } from '../tour/tourState.ts'
import { OLDER_TEXT, markOlderSeen, olderAskDue, olderSeen } from './olderNoticeModel.ts'
import type { App } from '../../state/app.ts'

const askedFor = new Set<string>()
const storage = (): Storage | null => { try { return globalThis.localStorage } catch { return null } }
/** Asked once per character on this device, shown only when one exists and nothing is in front. */
export async function pointToOlder({ game, shell }: Pick<App, 'game' | 'shell'>): Promise<void> {
  // The launch bonus's chip and its moment are mounted from here too: this file is already fetched a few seconds after the page is up (bonus/mount.ts).
  if (game.view.value.connected) void import('../bonus/mount.ts').then((m) => m.mountBonus())
  const view = game.view.value, who = view.session?.id ?? ''
  const facts = { connected: view.connected, who, creating: view.onboarding?.required === true, tour: tour.active || tour.pending, busy: Boolean(shell.sheet.value) || Boolean(game.state.value.activeAction) || callVisible(), seen: askedFor.has(who) || olderSeen(storage(), who) }
  if (!olderAskDue(facts)) return
  askedFor.add(who)
  try {
    const older = (await game.client.api<{ legacy: unknown[] }>('/api/characters')).legacy.length
    if (older > 0) { game.toast(OLDER_TEXT); markOlderSeen(storage(), who) }
  } catch { askedFor.delete(who) }
}
