/**
 * OWNER: social
 * VISITING A HOME: the wire types of server/routes/visit.ts. The rules are server/social/visit.ts; numbers and words are
 * src/game/visit.ts. The frames a visit uses are the existing house frames (invite-knock, invite-answer, invite-house).
 */
import type { HostErrorCode, JsonBodyErrorCode, Ok, Refusal, SessionErrorCode, StorageErrorCode } from './protocol.ts'
import type { Done, HouseView, Repeat } from './social.ts'
import type { DoorWho } from '../game/visit.ts'
import type { CityId } from './protocol.ts'
import type { HouseStyle, PlacedItem, PlotAddress } from './life.ts'

export interface DoorView { who: DoorWho; out: boolean; chosen: boolean }
/** A house link as its host sees it. `path` is `/h/<token>`: send it with the site's address in front. */
export interface HouseLinkView { id: string; path: string; at: number; expiresAt: number; uses: number; max?: number; open: boolean; ended: boolean }

export interface DoorBody { who?: DoorWho; out?: boolean }
export interface CloseBody { closed: boolean }
export interface EnterBody { host: string }
export interface PlotEnterBody { city: CityId; plot: PlotAddress; host: string }
export interface CaptureConsentBody { host: string; visitId: string; allow: boolean }
export type VisitHomeItem = Pick<PlacedItem, 'id' | 'itemId' | 'x' | 'y' | 'rot'> & { floor?: number }
export interface VisitStory { title: string; description: string; moment: { title: string; prompt: string }; step: number; total: number; revision: number }
export interface VisitHomeProjection { host: { id: string; name: string }; city: CityId; plot: PlotAddress | null; owned: boolean; grid: number; style: HouseStyle; items: VisitHomeItem[]; story?: VisitStory }
export type VisitHomeResult = Done<'home', { home: VisitHomeProjection }> | Refused
export interface InviteBody { to: string[] }
export interface LinkBody { hours?: number; max?: number; open?: boolean }
export interface LinkEndBody { id: string }
export interface TokenBody { token: string }

type Refused = Refusal<string>
export type DoorResult = Done<'ok', { door: DoorView; closed: boolean }>
export type DoorSetResult = Done<'ok', { door: DoorView }>
export type CloseResult = Done<'ok', { closed: boolean; house: HouseView }>
export type EndResult = Done<'ended', { count: number }>
/** Visit home: 'inside' (in the host's Home room), 'knocking' (the host answers), or a sentence saying why not. */
export type EnterResult = Done<'inside', { house: HouseView } & Repeat> | Done<'knocking', { expiresAt: number } & Repeat> | Refused
export type InviteResult = Done<'invited', { invited: { id: string; name: string }[]; skipped: { id: string; name: string; reason: string }[]; expiresAt: number }> | Refused
export type LinkResult = Done<'made', { link: HouseLinkView }> | Refused
export type LinksResult = Done<'ok', { links: HouseLinkView[] }>
export type LinkEndResult = Done<'ended', { link: HouseLinkView } & Repeat> | Refused
export type CaptureConsentResult = Done<'consented' | 'revoked', { house: HouseView } & Repeat> | Refused
/** What a link is to someone with no session: 'open' (with the host's display name and nothing else), 'ended' or 'expired'. */
export type PeekResult = Done<'open', { host: { name: string } }> | Done<'ended' | 'expired'>
export type LinkEnterResult = Done<'inside', { house: HouseView } & Repeat> | Done<'knocking', { expiresAt: number } & Repeat> | Refused

type Common = HostErrorCode | SessionErrorCode | StorageErrorCode | 'onboarding_required'
type Post = Common | JsonBodyErrorCode
export interface VisitHttpRoutes {
  'POST /api/social/visit/plot/enter': { body: PlotEnterBody; response: Ok<EnterResult>; errors: Post | 'invalid_player' | 'invalid_city' | 'invalid_plot' | 'world_unavailable' }
  'POST /api/social/visit/capture-consent': { body: CaptureConsentBody; response: Ok<CaptureConsentResult>; errors: Post | 'invalid_player' | 'invalid_capture_consent' | 'visit_required' | 'visit_changed' | 'visit_ended' | 'host_not_home' }
  'GET /api/social/visit/home': { query: { host: string }; response: Ok<VisitHomeResult>; errors: Common | 'invalid_player' }
  'GET /api/social/visit/door': { response: Ok<DoorResult>; errors: Common }
  'POST /api/social/visit/door': { body: DoorBody; response: Ok<DoorSetResult>; errors: Post | 'invalid_door' }
  'POST /api/social/visit/close': { body: CloseBody; response: Ok<CloseResult>; errors: Post | 'invalid_door' }
  'POST /api/social/visit/end': { response: Ok<EndResult>; errors: Post }
  'POST /api/social/visit/enter': { body: EnterBody; response: Ok<EnterResult>; errors: Post | 'invalid_player' }
  'POST /api/social/visit/invite': { body: InviteBody; response: Ok<InviteResult>; errors: Post | 'invalid_player' }
  'POST /api/social/visit/link': { body: LinkBody; response: Ok<LinkResult>; errors: Post | 'invalid_link' }
  'GET /api/social/visit/links': { response: Ok<LinksResult>; errors: Common }
  'POST /api/social/visit/link/end': { body: LinkEndBody; response: Ok<LinkEndResult>; errors: Post }
  'POST /api/social/visit/peek': { body: TokenBody; response: Ok<PeekResult>; errors: HostErrorCode | JsonBodyErrorCode | StorageErrorCode }
  'POST /api/social/visit/link/enter': { body: TokenBody; response: Ok<LinkEnterResult>; errors: Post }
}
