// The Services app (showcase shops) as a Vue panel. Static metadata only: the component, its model and everything it reads are
// fetched the first time the app is opened, so the entry chunk carries this file and nothing of the feature.
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'
import { bodyLoader } from '../../state/panelBody.ts'

export const showcase = definePanel({
  id: 'showcase', title: 'Services', placement: 'phone', order: 13.5, live: false, group: 'money', tint: '#7a4bb0',
  component: defineAsyncComponent(bodyLoader('showcase/ShowcaseApp')),
})

export const SHOWCASE_PANELS: readonly VuePanel[] = [showcase]
