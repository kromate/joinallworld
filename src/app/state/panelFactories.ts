import type { AsyncComponentLoader, Component } from 'vue'
import { defineAsyncComponent } from 'vue'
import { definePanel } from './panels.ts'
import type { PanelMeta, PanelPlacement, VuePanel } from '../types/panel.ts'

type PanelOptions = Omit<PanelMeta, 'id' | 'title' | 'placement'>

/** Declare a lazily loaded panel while keeping its static phone/shell metadata in the registry. */
export function lazyPanel(
  id: string,
  title: string,
  placement: PanelPlacement,
  load: AsyncComponentLoader<Component>,
  options: PanelOptions = {},
): VuePanel {
  return definePanel({ ...options, id, title, placement, component: defineAsyncComponent(load) })
}

/** The common case for a phone app. */
export function phonePanel(
  id: string,
  title: string,
  load: AsyncComponentLoader<Component>,
  options: PanelOptions = {},
): VuePanel {
  return lazyPanel(id, title, 'phone', load, options)
}
