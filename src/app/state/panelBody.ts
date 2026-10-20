import type { AsyncComponentLoader, Component } from 'vue'
import type { PanelBody } from './panelBodies.ts'

// Each lazy panel (lazyComponent) invokes this on first mount; a failed download is retried and reported there.
export function bodyLoader(key: PanelBody): AsyncComponentLoader<Component> {
  return () => import('./panelBodies.ts').then((module) => module.loadPanelBody(key))
}
