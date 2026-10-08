import type { Component } from 'vue'

export type PracticePanelId = 'driving-practice' | 'barber-practice'

/** Loaded only after a practice panel opens; its view chunks and styles remain separately lazy. */
export function loadPracticePanel(id: PracticePanelId): Promise<{ default: Component }> {
  switch (id) {
    case 'driving-practice': return import('./DrivingApp.vue')
    case 'barber-practice': return import('./BarberApp.vue')
  }
  const exhaustive: never = id
  throw new Error(`Unknown practice panel: ${exhaustive}`)
}
