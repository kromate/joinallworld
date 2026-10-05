// Response types of /api/growth/* are in src/types/growth.ts (derived from the server). This file
// adds only what the client keeps beside them.
import type { ShareFacts } from '../../../types/growth.ts'
import type { PreparedShare } from './boundary.ts'
import type { ShareSurface } from './inviteModel.ts'

/** A share being shown in the share sheet. */
export interface SharingState { facts: ShareFacts; prepared: PreparedShare; /** Where it was started from (the Phone when not said). */ surface?: ShareSurface }
/** Where the page's share link came from, once the landing knows. */
export interface LandingState { kind: string; by: { id: string; name: string } }
