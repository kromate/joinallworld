import type { AsyncComponentLoader, Component } from 'vue'
import type { PanelBody } from './panelBodies.ts'

export class PanelBodyLoadError extends Error {
  constructor(cause: unknown) { super('This app could not load', { cause }) }
}

// Each existing async component invokes this on first mount. Rejections pass through for retry.
export function bodyLoader(key: PanelBody): AsyncComponentLoader<Component> {
  return () => import('./panelBodies.ts').then((module) => module.loadPanelBody(key)).catch((error: unknown) => { throw new PanelBodyLoadError(error) })
}
