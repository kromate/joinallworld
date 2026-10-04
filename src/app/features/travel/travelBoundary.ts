// The typed boundary of the Getting around panels to the one existing module they need without a
// browser: the table of connection words (src/ui/link.js is pure strings, so a test reaches it
// under `node --test`; src/app/legacy/modules.ts, which has the same cast, pulls in the panel
// registry and cannot be loaded there). When link.js is converted these lines are deleted.
import { LINK_STATES as LINK_STATES_JS, linkWords as linkWordsJs } from '../../../ui/link.ts'
import type { LinkWords } from '../../legacy/modules.ts'

export type { LinkWords }
/** The one thing that resolves a connection problem: try again (the shell menu), or the session panel. */
export type LinkAction = NonNullable<LinkWords['action']>
/** The words of a connection state, or of a view's; null when online. */
export const linkWords = linkWordsJs as unknown as (link: string | { connected: boolean; link: string }) => LinkWords | null
export const LINK_STATES = LINK_STATES_JS as unknown as readonly string[]
