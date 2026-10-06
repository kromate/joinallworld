// "Get a notification when Joy replies?" is asked once per device, after the player has written a message. Remembered on this device only.
const KEY = 'joinallworld-notify-asked'
const store = (): Storage | null => { try { return globalThis.localStorage ?? null } catch { return null } }
export const askedAboutNotifications = (): boolean => store()?.getItem(KEY) === '1'
export function noteAskedAboutNotifications(): void { try { store()?.setItem(KEY, '1') } catch { /* asked again next time */ } }
