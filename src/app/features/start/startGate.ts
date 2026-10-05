import type { PanelView } from '../../types/panel.ts'

export const PLAY_HELD = 'Choose your look and tap Play to start.'

/** The life is held for its look, and the connection to confirm it is there. */
export const held = (view: Pick<PanelView, 'onboarding' | 'connected'>): boolean => view.onboarding?.required === true && view.connected
/**
 * A life whose look the server has not confirmed is held here — unless its Play is being sent right
 * now (the same rule is on its stub in src/ui/panels/index.js, so it holds before this file has arrived).
 */
export const quickStartRequired = (view: Pick<PanelView, 'onboarding' | 'connected'>, sending: boolean): string | null => (held(view) && !sending ? PLAY_HELD : null)
