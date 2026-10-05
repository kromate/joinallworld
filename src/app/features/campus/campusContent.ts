// The campus content (src/campus/unilag, typed modules), read once here and given the types
// its callers rely on. Nothing else in the Campus app imports the content modules.
import type { CampusClubDefinition, CampusJobDefinition, HostelHallId, HostelStorageItemId, LectureSlot, LectureSlotId, ProgrammeDefinition, ProgrammeId, ShuttleStopId, TrailStopDefinition } from '../../../types/campus.ts'
import type { SpotDefinition } from '../../../types/content.ts'
import { DISCOVERY_TRAIL as trail, spots as landmarks } from '../../../campus/unilag/content.ts'
// The Campus app reads the campus views: its chunk brings the campus rules and registers them (a life that does not use the campus has only stand-ins).
import '../../../campus/unilag/register.ts'
import { LECTURE_SLOTS as slots, PROGRAMMES as programmes } from '../../../campus/unilag/curriculum.ts'
import { CAMPUS_CLUBS as clubs, CAMPUS_DISCOVERIES as discoveries } from '../../../campus/unilag/games.ts'
import { CAMPUS_JOBS as jobs, HOSTEL_HALLS as halls, HOSTEL_STORAGE_ITEMS as storage } from '../../../campus/unilag/student.ts'
import { SHUTTLE_STOPS as stops } from '../../../campus/unilag/shuttle.ts'

export interface DiscoverySpot { id: string; label: string }
export interface ShuttleStop { id: ShuttleStopId; label: string }

export const DISCOVERY_TRAIL: readonly TrailStopDefinition[] = trail
export const LANDMARKS: Readonly<Record<string, SpotDefinition>> = landmarks
export const LECTURE_SLOTS: Readonly<Record<LectureSlotId, LectureSlot>> = slots
export const PROGRAMMES: Readonly<Record<ProgrammeId, ProgrammeDefinition>> = programmes
export const CAMPUS_CLUBS: readonly CampusClubDefinition[] = clubs
export const CAMPUS_DISCOVERIES: Readonly<Record<string, DiscoverySpot>> = discoveries
export const CAMPUS_JOBS: Readonly<Record<string, CampusJobDefinition>> = jobs
export const HOSTEL_HALLS: readonly HostelHallId[] = halls
export const HOSTEL_STORAGE_ITEMS: readonly HostelStorageItemId[] = storage
export const SHUTTLE_STOPS: readonly ShuttleStop[] = stops
