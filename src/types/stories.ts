import type { LifeState, PlacedItem } from './life.ts'

export interface StoryMoment { title: string; prompt: string }
export interface StoryDraft { title: string; description: string; items: PlacedItem[]; moments: StoryMoment[] }
export interface StoryContent extends Omit<StoryDraft, 'moments'> { moments: [StoryMoment, ...StoryMoment[]] }
export type StoryPublication = { kind: 'unpublished' } | { kind: 'published'; revision: number; content: StoryContent }
export interface StoryScene { id: string; draftRevision: number; draft: StoryDraft; publication: StoryPublication }
export interface StoryRun { sceneId: string; revision: number; step: number; startedAt: number; content: StoryContent }
export interface StoryState { seq: number; scenes: StoryScene[]; running: StoryRun | null }
export interface StoriesSlice { stories: StoryState }
export type StoryLife = LifeState & StoriesSlice

/** Included in ActionMap by the integration owner; every command uses the ordinary action receipt. */
export interface StoryActionMap {
  'stories.save': { payload: { id?: string; title: string; description: string; moments: StoryMoment[] }; ok: 'saved'; fail: 'busy' | 'not_home' | 'invalid_scene' | 'scene_limit' | 'props_unavailable' | 'invalid_layout' }
  'stories.remove': { payload: { id: string }; ok: 'removed'; fail: 'busy' | 'not_home' | 'unknown_scene' | 'scene_running' }
  'stories.publish': { payload: { id: string }; ok: 'published'; fail: 'busy' | 'not_home' | 'unknown_scene' | 'invalid_scene' | 'scene_running' | 'props_unavailable' | 'invalid_layout' }
  'stories.start': { payload: { id: string }; ok: 'started'; fail: 'busy' | 'not_home' | 'unknown_scene' | 'not_published' | 'scene_running' | 'props_unavailable' | 'invalid_layout' }
  'stories.next': { payload: Record<string, never>; ok: 'advanced' | 'ended'; fail: 'not_home' | 'not_running' }
  'stories.end': { payload: Record<string, never>; ok: 'ended'; fail: never }
}
