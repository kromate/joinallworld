/**
 * OWNER: admin
 * THE EXTENSION POINT FOR OTHER FEATURES. A feature that has an operator side (pictures in chat, calls, anything with
 * a moderation route under /api/mod/) adds a descriptor here, from its own module, and the admin UI lists it under
 * "Tools" and, for `kind: 'queue'`, in Moderation. Nothing here knows any feature:
 *
 *   import { registerAdminTool } from '../admin/tools.ts';
 *   registerAdminTool(ctx, { id: 'pictures', title: 'Pictures in chat', group: 'moderation', kind: 'queue',
 *     list: '/api/mod/pictures', actions: [{ id: 'remove', label: 'Remove picture', danger: true, path: '/api/mod/pictures/:id/remove' }] });
 *
 * A descriptor is data: the admin routes list them (GET /api/admin/tools). A tool whose `path` is under /api/mod/ is reached
 * by the operator token, not by the admin session; a tool that wants an admin-session route adds its own under /api/admin/
 * through the admin route guard (server/admin/gate.ts) and names that path here.
 *
 * Statistics work the same way: registerAdminStat(ctx, { id, label, read }) adds a number to the dashboard (calls placed
 * and connected, relay use, pictures sent). `read` must be cheap and read memory or the snapshot it is given.
 */
import type { Db, RouteContext } from '../types.ts';

export interface AdminToolAction { id: string; label: string; danger?: boolean; path: string }
export interface AdminTool { id: string; title: string; group: 'moderation' | 'world' | 'players' | 'other'; kind: 'queue' | 'switch' | 'link'; list?: string; actions?: AdminToolAction[] }
export interface AdminStat { id: string; label: string; /** Stats with the same group are shown together on one card. */ group?: string; /** What it costs to read, shown beside the number. */ cost: string; read(db: Db): number | string | null }

const tools = new WeakMap<object, Map<string, AdminTool>>(), stats = new WeakMap<object, Map<string, AdminStat>>();
const mapOf = <T>(table: WeakMap<object, Map<string, T>>, ctx: object): Map<string, T> => { let found = table.get(ctx); if (!found) table.set(ctx, found = new Map()); return found; };

export function registerAdminTool(ctx: object, tool: AdminTool): void {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(tool.id)) throw new Error(`Invalid admin tool id: ${tool.id}`);
  mapOf(tools, ctx).set(tool.id, Object.freeze({ ...tool }));
}
export function registerAdminStat(ctx: object, stat: AdminStat): void {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(stat.id)) throw new Error(`Invalid admin stat id: ${stat.id}`);
  mapOf(stats, ctx).set(stat.id, stat);
}
export const adminTools = (ctx: RouteContext): AdminTool[] => [...mapOf(tools, ctx).values()];
export const adminStats = (ctx: RouteContext): AdminStat[] => [...mapOf(stats, ctx).values()];
