/**
 * OWNER: admin
 * WHAT THE OTHER FEATURES PUT INTO THE ADMIN SECTION, through the extension points of ./tools.ts and ./settings.ts: dashboard numbers for
 * calls, the hosted guide and pictures in chat, the pictures queue for Moderation, and the two runtime switches (pictures in chat and
 * phone notifications for messages) that default to the host's environment. Each number reads memory the feature already keeps, or one
 * pass over stored messages inside the dashboard's own 45 second cache; nothing here writes.
 */
import { companionService } from '../companion/service.ts';
import { callService } from '../social/calls.ts';
import { pictureSettings } from '../social/images.ts';
import { linkBonus } from '../bonus/service.ts';
import { registerAdminSetting } from './settings.ts';
import { registerAdminStat, registerAdminTool } from './tools.ts';
import { forEachValue } from '../keyed.ts';
import type { Db, RouteContext } from '../types.ts';

const bytesText = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} kB`);
const linked = new WeakSet<object>();

/** What the pictures in stored conversations come to. */
export function pictureCounts(db: Db): { stored: number; reported: number; hidden: number } {
  let stored = 0, reported = 0, hidden = 0;
  // One conversation at a time: the operator's page must not hold every conversation in memory at once.
  forEachValue(db.social?.convs ?? {}, (conv) => { for (const line of conv.messages) {
    const image = line.img;
    if (!image || image.gone) continue;
    stored += 1;
    if (image.rp?.length) reported += 1;
    if (image.hid) hidden += 1;
  } });
  return { stored, reported, hidden };
}

export function linkFeatures(ctx: RouteContext): void {
  if (linked.has(ctx)) return;
  linked.add(ctx);
  const env = (name: string): string => (typeof ctx.env === 'function' ? ctx.env(name) : '');
  linkBonus(ctx);

  // ---- calls: today's counters (UTC day) and whether the relay is configured; no names, no ids ----------------------------------
  const calls = (): ReturnType<ReturnType<typeof callService>['stats']> => callService(ctx).stats();
  const call = (id: string, label: string, read: () => number | string): void => registerAdminStat(ctx, { id: `calls-${id}`, group: 'Calls today', label, cost: 'memory', read });
  call('placed', 'Placed', () => calls().placed);
  call('direct', 'Connected direct', () => calls().connectedDirect);
  call('relay', 'Connected via relay', () => calls().connectedViaRelay);
  call('failed', 'Failed to connect', () => calls().failedToConnect);
  call('credentials', 'Relay credentials issued', () => calls().relayMintsToday);
  call('relay-set', 'Relay configured', () => (calls().relay ? 'yes' : 'no'));

  // ---- the guide: today's requests and the hosted model's counters, memory only -------------------------------------------------
  const guide = () => companionService(ctx).overview();
  const note = (id: string, label: string, read: () => number | string): void => registerAdminStat(ctx, { id: `guide-${id}`, group: 'AI guide today', label, cost: 'memory', read });
  note('on', 'Hosted model configured (companionAi)', () => (guide().enabled ? 'yes' : 'no'));
  note('requests', 'Requests', () => guide().today.requests);
  note('outcomes', 'Outcomes', () => Object.entries(guide().today.outcomes).filter(([, n]) => n > 0).map(([name, n]) => `${name} ${n}`).join(' · ') || 'none yet');
  note('tokens', 'Tokens in / out', () => { const t = guide().today.tokens; return `${t.input} / ${t.output}`; });
  note('cost', 'Estimated cost (USD)', () => guide().today.estimatedCostUsd);

  // ---- pictures in chat -------------------------------------------------------------------------------------------------------
  let used: { count: number; bytes: number } | null = null, asked = 0;
  const lookup = (): void => {
    const images = ctx.images;
    if (!images || ctx.now() - asked < 60000) return;
    asked = ctx.now();
    void images.stats().then((found) => { used = found; }, () => {});
  };
  const picture = (id: string, label: string, cost: string, read: (db: Db) => number | string): void => registerAdminStat(ctx, { id: `pictures-${id}`, group: 'Pictures in chat', label, cost, read });
  picture('on', 'Switched on (CHAT_IMAGES or the setting)', 'memory', () => (pictureSettings(env, (key) => ctx.checks?.setting?.(key)).mode !== 'off' && ctx.images ? 'yes' : 'no'));
  picture('stored', 'Stored', 'one pass over stored messages', (db) => pictureCounts(db).stored);
  picture('reports', 'Reported, not removed', 'one pass over stored messages', (db) => pictureCounts(db).reported);
  picture('storage', 'Storage used', 'the image store, read at most once a minute', () => { lookup(); return used ? bytesText(used.bytes) : '-'; });
  registerAdminTool(ctx, { id: 'pictures', title: 'Pictures in chat', group: 'moderation', kind: 'queue', list: '/api/admin/moderation/pictures',
    actions: [{ id: 'remove', label: 'Remove picture', danger: true, path: '/api/admin/moderation/pictures/:id/act' }, { id: 'restore', label: 'Restore picture', path: '/api/admin/moderation/pictures/:id/act' }, { id: 'ban', label: 'Stop or allow a player sending pictures', path: '/api/admin/moderation/pictures/player' }] });

  // ---- two switches that start at the environment's value -----------------------------------------------------------------------
  registerAdminSetting(ctx, { key: 'chatPictures', label: 'Pictures in chat (friends only)', help: 'Starts at CHAT_IMAGES, which is off unless the host sets it. Turning it on asks you to type a confirmation.', kind: 'boolean', confirmOn: true,
    default: () => pictureSettings(env).mode !== 'off' });
  registerAdminSetting(ctx, { key: 'chatPush', label: 'Phone notifications for messages', help: 'Starts at CHAT_PUSH (on unless the host says off). Players who did not allow notifications get none either way.', kind: 'boolean',
    default: () => env('CHAT_PUSH') !== 'off' });
}
