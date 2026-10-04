// "Your own house", the section the Houses app shows first, is still drawn by the world panels
// (src/ui/panels/world-panels.js) as an existing panel. It is hosted as one so the Houses app can
// be a component today; it goes when world-panels.js is converted.
import { bindMyHouse as bindMyHouseJs, renderMyHouse as renderMyHouseJs } from '../../ui/panels/world-panels.js'
import type { LifeState } from '../../types/life.ts'
import type { LegacyPanel, PanelView } from '../types/panel.ts'

const render = renderMyHouseJs as unknown as (state: LifeState, view: PanelView) => string
const bind = bindMyHouseJs as unknown as (root: HTMLElement) => void

/** The section as a panel for LegacyPanel: nothing registers it, it is only hosted. */
export const MY_HOUSE: LegacyPanel = { id: 'my-house', title: 'Your own house', placement: 'modal', render: (state, view) => render(state, view), bind: (root) => bind(root) }
