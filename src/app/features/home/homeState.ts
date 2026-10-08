// What Buy mode and the home chip share, and what the scene tells them. The scene (src/scene/home-scene.ts)
// and these panels talk through window events, so a tap on an object works before Buy mode's code
// has ever been downloaded: the home chip is part of the HUD from the first paint, and this state
// and homeScene.ts, which owns the events, load with it.
import { reactive, ref } from 'vue'
import type { Ghost } from './buyModel.ts'

export const H = reactive<{
  /** The piece being placed. */
  ghost: Ghost | null
  /** Id of the placed object the player tapped. */
  selected: string | null
  /** The catalogue is collapsed. */
  hidden: boolean
  /** Buy mode is the nav panel in front. */
  inBuy: boolean
  /** The floor of the house Buy mode is furnishing (0, the ground floor, in a rented room). */
  floor: number
}>({ ghost: null, selected: null, hidden: false, inBuy: false, floor: 0 })

export type SceneStatus = 'loading' | 'ready' | 'empty' | 'error'
/** What the home scene last said about the room. */
export const scene = reactive<{ status: SceneStatus; placed: number }>({ status: 'loading', placed: 0 })

export const kitchenOpen = ref(false)
/** The catalogue tab. */
export const tab = ref('sleep')
