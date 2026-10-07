import { PLAYS, LEFT_OUT } from '../profile.ts'
import { isDeparting } from '../registry.ts'
import { busy, fail, ok } from '../util.ts'
import { authoredDraft, cloneContent, layoutFailure, publishable, sanitizeStories, storyId, STORY_LIMITS } from '../stories/model.ts'
import type { SavedInput } from '../../types/registry.ts'
import type { LifeContext } from '../../types/life.ts'
import type { StoryLife } from '../../types/stories.ts'

const guard = (state: StoryLife) => state.location !== 'home' ? fail(state, 'not_home', 'Go to your own home to create or play a scene.') : busy(state)
const sceneOf = (state: StoryLife, id: unknown) => storyId(id) ? state.stories.scenes.find(scene => scene.id === id) : undefined
const layoutWords = (code: 'props_unavailable' | 'invalid_layout'): string => code === 'props_unavailable' ? 'Some scene props are no longer yours. Save the scene again with furniture you own.' : 'The scene layout no longer fits this home. Arrange your furniture and save the scene again.'

/** The host may call this after an ordinary departure action; it never touches possessions. */
export function settleStoryRun(state: StoryLife): void {
    if (PLAYS && state.stories.running && (state.location !== 'home' || isDeparting(state) || layoutFailure(state, state.stories.running.content.items))) state.stories.running = null
}

const play = PLAYS ? {
  actions: {
    'stories.save'(state: StoryLife, payload: Record<string, unknown>) {
      const blocked = guard(state)
      if (blocked) return blocked
      const existing = payload.id === undefined ? null : sceneOf(state, payload.id)
      if (payload.id !== undefined && !existing) return fail(state, 'invalid_scene', 'Choose a scene you created.')
      if (!existing && (state.stories.scenes.length >= STORY_LIMITS.scenes || state.stories.seq > 999999999)) return fail(state, 'scene_limit', 'You can keep eight scenes. Remove one before creating another.')
      const draft = authoredDraft(payload, state.home.items)
      if (!draft) return fail(state, 'invalid_scene', 'Give the scene a title and up to eight moments with a title and prompt each.')
      const problem = layoutFailure(state, draft.items)
      if (problem) return fail(state, problem, layoutWords(problem))
      if (existing) { existing.draft = draft; existing.draftRevision++; }
      else state.stories.scenes.push({ id: `story${state.stories.seq++}`, draftRevision: 1, draft, publication: { kind: 'unpublished' } })
      state.message = 'Scene draft saved. Publish it when you are ready to play.'
      return ok(state, 'saved')
    },
    'stories.remove'(state: StoryLife, payload: Record<string, unknown>) {
      const blocked = guard(state)
      if (blocked) return blocked
      const scene = sceneOf(state, payload.id)
      if (!scene) return fail(state, 'unknown_scene', 'That scene was not found.')
      if (state.stories.running?.sceneId === scene.id) return fail(state, 'scene_running', 'End this scene before removing it.')
      state.stories.scenes = state.stories.scenes.filter(item => item.id !== scene.id)
      state.message = 'Scene removed. Your furniture stays yours.'
      return ok(state, 'removed')
    },
    'stories.publish'(state: StoryLife, payload: Record<string, unknown>) {
      const blocked = guard(state)
      if (blocked) return blocked
      const scene = sceneOf(state, payload.id)
      if (!scene) return fail(state, 'unknown_scene', 'That scene was not found.')
      if (state.stories.running?.sceneId === scene.id) return fail(state, 'scene_running', 'End this scene before publishing its next version.')
      const content = publishable(scene.draft)
      if (!content) return fail(state, 'invalid_scene', 'Add at least one moment before publishing.')
      const problem = layoutFailure(state, content.items)
      if (problem) return fail(state, problem, layoutWords(problem))
      scene.publication = { kind: 'published', revision: scene.draftRevision, content }
      state.message = `${content.title} is ready to play at your home.`
      return ok(state, 'published')
    },
    'stories.start'(state: StoryLife, payload: Record<string, unknown>, ctx: LifeContext) {
      const blocked = guard(state)
      if (blocked) return blocked
      if (state.stories.running) return fail(state, 'scene_running', 'End the current scene before starting another.')
      const scene = sceneOf(state, payload.id)
      if (!scene) return fail(state, 'unknown_scene', 'That scene was not found.')
      if (scene.publication.kind !== 'published') return fail(state, 'not_published', 'Publish this scene first.')
      const problem = layoutFailure(state, scene.publication.content.items)
      if (problem) return fail(state, problem, layoutWords(problem))
      state.stories.running = { sceneId: scene.id, revision: scene.publication.revision, step: 0, startedAt: ctx.now, content: cloneContent(scene.publication.content) }
      state.message = `${scene.publication.content.title} started. Invite friends over or play it yourself.`
      return ok(state, 'started')
    },
    'stories.next'(state: StoryLife) {
      if (state.location !== 'home' || isDeparting(state)) return fail(state, 'not_home', 'Return home to continue a scene.')
      settleStoryRun(state)
      const run = state.stories.running
      if (!run) return fail(state, 'not_running', 'Start a scene first.')
      if (run.step + 1 >= run.content.moments.length) { state.stories.running = null; state.message = 'Scene finished. Your usual home layout is back.'; return ok(state, 'ended') }
      run.step++
      state.message = run.content.moments[run.step]?.title ?? 'Next moment.'
      return ok(state, 'advanced')
    },
    'stories.end'(state: StoryLife) { state.stories.running = null; state.message = 'Scene ended. Your usual home layout is back.'; return ok(state, 'ended') },
  },
  advance: settleStoryRun,
  on: {
    'travel.arrived'(state: StoryLife) { state.stories.running = null },
    'house.moved'(state: StoryLife) { state.stories.running = null },
    'lga.changed'(state: StoryLife) { state.stories.running = null },
    'city.changed'(state: StoryLife) { state.stories.running = null },
    'item.sold': settleStoryRun,
  },
} : LEFT_OUT

/** Register after home: validation reads the already-sanitized possessions and floor plan. */
export default {
  id: 'stories',
  stateKeys: ['stories'],
  sanitize(input: SavedInput, state: StoryLife, ctx: LifeContext) {
    state.stories = sanitizeStories(input.stories, ctx.now)
    settleStoryRun(state)
  },
  ...play,
}
