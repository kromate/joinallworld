// The one social client of the page, for every social screen:
//
//   const social = useSocial()
//   social.state.me / .threads / .people …    reactive; read it in a computed or a template
//   social.start(api)                         idempotent: opens the socket, reads the overview once
//   social.call / perform / sync / openThread / send / retry / discard / threadView
//
// It is created without the application (the client is handed the host's `api` by start()), so
// the registry's badge() functions and src/app/legacy/social.ts can import it from the entry
// chunk. The client itself is in socialClient.ts, with the tests.
import { createSocialClient } from './socialClient.ts'
import type { SocialClient } from './socialClient.ts'

export * from './socialClient.ts'

const shared: SocialClient = createSocialClient()
export function useSocial(): SocialClient { return shared }
/** The reactive state of the shared client (the same object as `useSocial().state`). */
export const social = shared.state
export const {
  call, perform, sync, loadPeople, loadProfile, openThread, threadView, send, retry, discard, reconnect, resetSocial,
  refreshLife, takeLinkHost, onPeople, onLive, liveNow, watchLive, cityId, newClientId, attach, start, sendFrame, onCallFrame, onSocketClose, onLifeFrame, onSocketOpen, wakeSocket,
} = shared
