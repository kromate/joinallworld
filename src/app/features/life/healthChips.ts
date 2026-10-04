// The HUD's health warning and weather chips, worked out from view.health. Pure, so it is tested
// without a browser. Everything comes from view.health (src/game/systems/health.ts).
import type { HealthView } from '../../../types/view.ts'

export type Warning = NonNullable<HealthView['warning']>

/** Something to act on now (sick, run down) stays in view as an alert; the rain warning and the weather live in the tray. */
export const alertOf = (health: Pick<HealthView, 'warning'> | undefined): Warning | null => (health?.warning && health.warning.level !== 'rain' ? health.warning : null)

export type TrayChip =
  | { kind: 'warning'; warning: Warning }
  | { kind: 'weather'; id: string; label: string; icon: string }

/** What the tray chip shows: the rain warning, else the weather now; nothing without a health view. */
export function trayOf(health: Pick<HealthView, 'warning' | 'weather'> | undefined): TrayChip | null {
  const warning = health?.warning
  if (warning?.level === 'rain') return { kind: 'warning', warning }
  const sky = health?.weather
  return sky ? { kind: 'weather', id: sky.id, label: sky.label, icon: sky.icon } : null
}

/** The chip's text alternative: a warning says what it is and where it leads; the weather names itself. */
export const warningLabel = (warning: Pick<Warning, 'text'>): string => `${warning.text}. Open the Health app.`
export const weatherLabel = (label: string): string => `Weather: ${label}. Open the Health app.`
