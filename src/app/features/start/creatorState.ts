// What the creator keeps between openings, as the panels it replaces kept it in module variables: the
// choices being made (so closing the creator and opening it again resumes where it was), the step on
// screen, the pending request, the last refusal and the looks to go back to. The device keeps only
// the look (and, on the landing, the name); everything else is confirmed by the server step by step.
import { reactive } from 'vue'
import type { DreamId, Look, TraitId } from '../../../types/life.ts'
import type { PanelView } from '../../types/panel.ts'
import type { AreaChoice } from './onboardingModel.ts'
import type { StepId } from './creatorModel.ts'

export interface CreatorDraft { look: Look; name: string; traits: TraitId[]; dream: DreamId | null; area: AreaChoice | undefined; spiritChosen: boolean }
export interface CreatorUi {
  draft: CreatorDraft | null
  owner: string | null
  step: StepId
  /** The look the creator opened with: "Reset" goes back to it. */
  origin: Look | null
  history: Look[]
  error: string
  pending: string
  /** A Play of the whole creator is on its way: when the life exists, the rest of the choices are sent. */
  settling: boolean
  /** Play was sent from this creator: the life exists (or is being made), so the rest is a move-in, not a Play. */
  played: boolean
  offered: boolean
  /** The city a life that does not exist yet will be born in (chosen on the Home step); null is the one the device is showing. */
  city: string | null
}
export const cr = reactive<CreatorUi>({ draft: null, owner: null, step: 'who', origin: null, history: [], error: '', pending: '', settling: false, played: false, offered: false, city: null })

/** Whose draft this is: the session and the city. */
export const ownerOf = (view: Pick<PanelView, 'session' | 'cityId'>, mode: string): string => `${mode}:${view.session?.id ?? 'local'}:${view.cityId}`
