// The campus content (src/campus/unilag, data-only JavaScript), read once here and given the types
// its callers rely on. Nothing else in the Campus app imports the content modules, so when they
// are converted this is the one file that changes.
import type { CampusClubDefinition, CampusJobDefinition, HostelHallId, HostelStorageItemId, LectureSlot, LectureSlotId, ProgrammeDefinition, ProgrammeId, ShuttleStopId, TrailStopDefinition } from '../../../types/campus.ts'
import { DISCOVERY_TRAIL as trail, spots as landmarks } from '../../../campus/unilag/content.js'
import { LECTURE_SLOTS as slots, PROGRAMMES as programmes } from '../../../campus/unilag/curriculum.js'
import { CAMPUS_CLUBS as clubs, CAMPUS_DISCOVERIES as discoveries } from '../../../campus/unilag/games.js'
import { CAMPUS_JOBS as jobs, HOSTEL_HALLS as halls, HOSTEL_STORAGE_ITEMS as storage } from '../../../campus/unilag/student.js'
import { SHUTTLE_STOPS as stops } from '../../../campus/unilag/shuttle.js'

/** An activity a landmark offers (content.js BetaActivity); only what the app shows. */
export interface LandmarkActivity { id: string; label: string; icon: string; duration: number; cost: number }
export interface Landmark { id: string; label: string; caption: string; activities: readonly LandmarkActivity[] }
export interface DiscoverySpot { id: string; label: string }
export interface ShuttleStop { id: ShuttleStopId; label: string }

export const DISCOVERY_TRAIL = trail as unknown as readonly TrailStopDefinition[]
export const LANDMARKS = landmarks as unknown as Readonly<Record<string, Landmark>>
export const LECTURE_SLOTS = slots as unknown as Readonly<Record<LectureSlotId, LectureSlot>>
export const PROGRAMMES = programmes as unknown as Readonly<Record<ProgrammeId, ProgrammeDefinition>>
export const CAMPUS_CLUBS = clubs as unknown as readonly CampusClubDefinition[]
export const CAMPUS_DISCOVERIES = discoveries as unknown as Readonly<Record<string, DiscoverySpot>>
export const CAMPUS_JOBS = jobs as unknown as Readonly<Record<string, CampusJobDefinition>>
export const HOSTEL_HALLS = halls as unknown as readonly HostelHallId[]
export const HOSTEL_STORAGE_ITEMS = storage as unknown as readonly HostelStorageItemId[]
export const SHUTTLE_STOPS = stops as unknown as readonly ShuttleStop[]
