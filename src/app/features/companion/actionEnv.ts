// The real routes behind the companion's buttons: the shell's own ways of opening a panel, the Map, a chat, a call and a tour.
import { useGrowth } from '../growth/useGrowth.ts'
import { useCall } from '../calls/useCall.ts'
import type { App } from '../../state/app.ts'
import type { ActionEnv } from './actions.ts'

export function actionEnv(app: App, handlers: { tell(text: string): void; ask(text: string): void; setMode(mode: 'lively' | 'quiet' | 'off'): void; dismiss(): void; close(): void }): ActionEnv {
  const { shell } = app
  // Whatever the companion's sheet covers is put away first, so the thing opened is what the player sees.
  const away = (): void => handlers.close()
  return {
    openPanel: (id, params) => { away(); if (id === 'phone') shell.open('phone'); else shell.open(id, params) },
    openMap: (venue) => { away(); shell.open('map', { destination: venue }) },
    openWorld: (city) => { away(); app.showMapLayer('world', { city, level: 2 }) },
    goTo: (venue, spot) => { away(); void app.goTo(venue, spot) },
    openSim: (tab) => { away(); shell.open('sim', { tab }) },
    openChat: (friend, name) => { away(); shell.open('messages', { to: friend, name }) },
    call: (friend, name) => { away(); void useCall().request({ id: friend, name }) },
    invite: () => { away(); void useGrowth().share('invite', { surface: 'prompt' }) },
    startTour: (id) => { away(); globalThis.window?.dispatchEvent(new CustomEvent('jaw:tour', { detail: { tour: id } })) },
    // The help card opens in place when it is on screen; otherwise the Bank, which carries the same card.
    openRelief: () => { away(); const asked = new CustomEvent('jaw:relief', { cancelable: true }); window.dispatchEvent(asked); if (!asked.defaultPrevented) shell.open('bank') },
    ask: handlers.ask, setMode: handlers.setMode, dismiss: handlers.dismiss, tell: handlers.tell,
  }
}
