// Engine-level feature switches. Every switch is OFF until the host that runs the engine turns it on at startup.
//
//   dilemmas   work dilemmas after a shift (src/game/dilemmas.ts) and the place actions of src/game/place-actions.ts.
//              Host: the server reads DILEMMAS=1 (server/server.ts createServer option `dilemmas`, deploy/local.ts, the Worker).
//              Browser: `?models=dilemmas` (src/models/integration/flags.ts) only decides whether the card is drawn; the life is
//              always played by the server, so the server's switch is the authority.
//
// With a switch off the engine behaves exactly as before: no new state is written, no new activity or view field exists.
// A switch is set once, before the first life is loaded. The activity catalogue is cached per city, so a test that flips
// one afterwards calls rebuildCatalogue(city) (src/game/systems/activities.ts).

const switches = { dilemmas: false };
export type FeatureSwitch = keyof typeof switches;

export const featureEnabled = (name: FeatureSwitch): boolean => switches[name];
export const dilemmasEnabled = (): boolean => switches.dilemmas;
export function setFeature(name: FeatureSwitch, on: boolean): void { switches[name] = on === true; }

/** Reads an on/off environment value: only `1`, `true`, `on` or `yes` (any case) turn a feature on. */
export function flagFromEnv(value: unknown): boolean {
  return typeof value === 'string' && ['1', 'true', 'on', 'yes'].includes(value.trim().toLowerCase());
}
