// The social client for the rest of the application: People, Messages, Contacts, Family, Invite,
// the Inbox chip, the badges and the crowd all share ONE state, the typed reactive client in
// src/app/features/social/ (useSocial.ts). This file only keeps the names the earlier code used.
// The old JavaScript client (src/ui/panels/social-client.js) is still loaded by the existing
// shell (index.html) and is not used by this one.
import { call, discard, loadPeople, newClientId, onPeople, openThread, perform, reconnect, retry, send, social, start, sync, takeLinkHost, threadView, cityId } from '../features/social/useSocial.ts'
import type { SocialState, SendTarget, SocialResult, SocialSocketState } from '../features/social/useSocial.ts'
import type { Conversation, Message, OutboxEntry, SocialOverview, ThreadItem } from '../../types/social.ts'

export type SocialClientState = SocialState
export type { SendTarget, SocialResult, SocialSocketState }
export { social, call, perform, sync, loadPeople, onPeople, openThread, threadView, send, retry, discard, takeLinkHost, newClientId }
/** Called by every social screen when it shows: idempotent. Opens the socket and reads the overview once. */
export const startSocial = start
export const reconnectSocial = reconnect
export const socialCityId = cityId
export type { Conversation, Message, SocialOverview, OutboxEntry, ThreadItem }
