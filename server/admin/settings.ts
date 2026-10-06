/**
 * OWNER: admin
 * RUNTIME SETTINGS: the few knobs an admin may turn without a deploy, each defaulting to the value the environment gave it.
 *
 * A setting is a descriptor { key, label, kind, default, apply }. Only the VALUES that differ from the default are stored
 * (collection adminSettings), each with who set it and when; removing one (reset) puts the default back. Values are applied to
 * the running host when they are set and again at start-up, before the host takes requests.
 *
 * BUILT IN (all of them already exist as settings of the host and are read on every request, so changing them is safe):
 *   newSessionsPerAddress   new sessions one network address may make in an hour (NEW_SESSIONS_PER_ADDRESS)
 *   maxActiveSessions       stored device sessions the host takes (MAX_ACTIVE_SESSIONS)
 *   chatPictures            a switch other features read through ctx.checks.setting('chatPictures'): pictures in chat on/off
 * EXTENSION POINT: registerAdminSetting(ctx, descriptor) from a feature's own module adds one to the list.
 * The e-mail and push kill switches already exist under /api/mod/growth/outreach/switch; the admin routes call that same function.
 */
import { collectionOf, peek } from './store.ts';
import type { Db, RouteContext } from '../types.ts';

export interface SettingDescriptor { key: string; label: string; help: string; kind: 'boolean' | 'number'; min?: number; max?: number; default(): boolean | number; apply?(value: boolean | number): void }
const registered = new WeakMap<object, Map<string, SettingDescriptor>>();
export function registerAdminSetting(ctx: object, descriptor: SettingDescriptor): void {
  if (!/^[a-zA-Z][a-zA-Z0-9]{0,31}$/.test(descriptor.key)) throw new Error(`Invalid setting key: ${descriptor.key}`);
  let table = registered.get(ctx);
  if (!table) registered.set(ctx, table = new Map());
  table.set(descriptor.key, descriptor);
}
const services = new WeakMap<RouteContext, ReturnType<typeof build>>();
export function settingsOf(ctx: RouteContext) {
  let found = services.get(ctx);
  if (!found) services.set(ctx, found = build(ctx));
  return found;
}

function build(ctx: RouteContext) {
  const live = new Map<string, boolean | number>();
  const config = ctx.config as unknown as Record<string, number>;
  const builtIn: SettingDescriptor[] = [
    { key: 'newSessionsPerAddress', label: 'New sessions per address per hour', help: 'How many new players one network address may start in an hour.', kind: 'number', min: 1, max: 100000, default: (() => { const first = config['newSessionsPerAddress'] ?? 0; return () => first; })(), apply: (value) => { config['newSessionsPerAddress'] = Number(value); } },
    { key: 'maxActiveSessions', label: 'Stored sessions the host takes', help: 'At the cap a new visitor is asked to wait; nobody with a session is affected.', kind: 'number', min: 1, max: 5000000, default: (() => { const first = config['maxActiveSessions'] ?? 0; return () => first; })(), apply: (value) => { config['maxActiveSessions'] = Number(value); } },
    { key: 'chatPictures', label: 'Pictures in chat', help: 'Switches pictures in chat on or off for everyone (read by the chat features through ctx.checks.setting).', kind: 'boolean', default: () => true },
  ];
  const table = (): Map<string, SettingDescriptor> => new Map([...builtIn, ...(registered.get(ctx)?.values() ?? [])].map((item) => [item.key, item]));
  const clean = (item: SettingDescriptor, value: unknown): boolean | number | null => {
    if (item.kind === 'boolean') return typeof value === 'boolean' ? value : null;
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= (item.min ?? 0) && value <= (item.max ?? 1e9) ? value : null;
  };
  const service = {
    descriptors: table,
    /** The value in force. */
    get(key: string): boolean | number | undefined { const item = table().get(key); return item ? live.get(key) ?? item.default() : undefined; },
    /** Apply stored values to the running host (start-up, and after a committed change). */
    sync(values: Record<string, { value: boolean | number }>): void {
      live.clear();
      for (const [key, item] of table()) {
        const stored = Object.hasOwn(values, key) ? clean(item, values[key]?.value) : null;
        if (stored !== null) live.set(key, stored);
        item.apply?.(stored ?? item.default());
      }
    },
    load: (): Promise<void> => ctx.store.read((db) => ({ ...peek(db, 'adminSettings').values })).then((values) => service.sync(values)),
    list(db: Db) {
      const stored = peek(db, 'adminSettings').values;
      return [...table().values()].map((item) => ({ key: item.key, label: item.label, help: item.help, kind: item.kind, min: item.min ?? null, max: item.max ?? null, default: item.default(), value: Object.hasOwn(stored, item.key) ? stored[item.key]?.value ?? item.default() : item.default(),
        changed: Object.hasOwn(stored, item.key) ? { at: stored[item.key]?.at ?? 0, by: stored[item.key]?.by ?? '' } : null }));
    },
    /** Inside a transaction: store (or, with value null, remove) one setting. Returns [before, after] and the values to apply after the commit. */
    change(db: Db, key: string, value: unknown, by: string) {
      const item = table().get(key);
      if (!item) throw ctx.fail(404, 'unknown_setting');
      const col = collectionOf(ctx, db, 'adminSettings'), before = Object.hasOwn(col.values, key) ? col.values[key]?.value ?? item.default() : item.default();
      if (value === null) delete col.values[key];
      else { const next = clean(item, value); if (next === null) throw ctx.fail(400, 'invalid_value'); if (next === item.default()) delete col.values[key]; else col.values[key] = { value: next, at: ctx.now(), by }; }
      const after = Object.hasOwn(col.values, key) ? col.values[key]?.value ?? item.default() : item.default();
      return { before, after, values: { ...col.values } };
    },
  };
  if (ctx.checks) ctx.checks.setting = (key) => service.get(key);
  return service;
}
