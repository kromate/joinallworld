import type { VenueScene } from '../../../types/content.ts'

/**
 * The scene of each Port Harcourt venue that has one of its own, by venue id: the scene kind, its variant
 * (src/scene/venues-rivers.ts) and, where a spot's id is not a landmark of the scene, the landmark it is pinned to.
 * A venue that is not listed keeps the bare scene of its kind.
 */
export const PORT_HARCOURT_SCENES: Readonly<Record<string, VenueScene>> = Object.freeze({})
