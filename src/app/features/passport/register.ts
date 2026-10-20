
import { bodyLoader } from '../../state/panelBody.ts'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'
import { lazyComponent } from '../../state/lazy.ts'

export const passport = definePanel({
  id: 'passport', title: 'My Life', short: 'My Life', placement: 'phone', order: 9, group: 'life', tint: '#315c9b',
  component: lazyComponent(bodyLoader('passport/PassportApp')),
})

export const PASSPORT_PANELS: readonly VuePanel[] = [passport]
