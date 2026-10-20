
import { definePanel } from '../../state/panels.ts'
import { bodyLoader } from '../../state/panelBody.ts'
import { lazyComponent } from '../../state/lazy.ts'

export const COMMERCE_PANELS = [definePanel({
  id: 'commerce', title: 'My Store', placement: 'phone', group: 'money', order: 13, live: false, tint: '#9a4f25',
  component: lazyComponent(bodyLoader('commerce/CommerceApp')),
})]
