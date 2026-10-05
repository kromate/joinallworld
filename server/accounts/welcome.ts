/**
 * OWNER: accounts
 * THE WELCOME MESSAGE: one e-mail to the verified address of a NEW account, through the game's existing mailer
 * (server/growth/email/zeptomail.ts; the words are server/growth/email/templates.ts accountWelcomeMail).
 *
 * It is a message about the account the person has just made — not a subscription, so it needs no marketing consent,
 * carries no unsubscribe link (nothing follows it) and is never sent again.
 *
 * EXACTLY ONCE PER ACCOUNT, AND NEVER IN THE WAY OF SIGNING IN
 *   owed      The transaction that CREATES the account marks it `welcome: 'pending'` and queues it (service.ts signIn).
 *             An account is created by a verified token only, so the address is one its owner confirmed; a guest, a
 *             later sign-in, another device and a restored character create nothing and so owe nothing.
 *   claimed   Before an attempt the message is claimed in a saved transaction. Only the claimant sends, so two
 *             requests — or a request and the retry below — can never both send it.
 *   settled   Sent: the account records when, and it is never owed again. A failure the mailer says is worth retrying
 *             (network, 429, 5xx — after its own three attempts) is tried again after 5 minutes, then 20, 80 … up to
 *             five times in all; anything else is given up. A claim that was never settled (the host stopped in the
 *             middle of a send) is not retried: one message too few rather than two.
 * The send runs after the sign-in has been answered (ctx.waitUntil) and again from the host's heartbeat for what is
 * due. Nothing it does can fail or delay a sign-in.
 *
 * OFF WHEN THE MAILER IS NOT CONFIGURED (ZEPTOMAIL_AUTH, EMAIL_FROM_ADDRESS and PUBLIC_ORIGIN): nothing is marked,
 * queued, sent or logged. The operator's e-mail switch (Stay in touch → outreach) stops this message too; it is
 * retried later like any other failure.
 *
 * Nothing here logs an address or a name. Portable: no Node imports.
 */
import { mailConfig, sendMail } from '../growth/email/zeptomail.ts';
import { accountWelcomeMail } from '../growth/email/templates.ts';
import { claimWelcome, dueWelcomes, settleWelcome } from './service.ts';
import type { AccountDeps } from './service.ts';
import type { RouteContext } from '../types.ts';

const TICK_MS = 60000;
const services = new WeakMap<object, ReturnType<typeof build>>();
export function welcomeService(ctx: RouteContext) {
  const cached = services.get(ctx);
  if (cached) return cached;
  const made = build(ctx);
  services.set(ctx, made);
  return made;
}

function build(ctx: RouteContext) {
  let deps: AccountDeps | null = null, lastTick = Number.NEGATIVE_INFINITY, stopped = false;
  const inFlight = new Set<Promise<void>>();
  const origin = (): string => ctx.config.publicOrigin || '';
  /** Can a message be sent at all? */
  const ready = (): boolean => mailConfig(ctx).configured && Boolean(origin());
  const contact = (): string => ctx.env('EMAIL_CONTACT_LINE').replace(/[\r\n<>]/g, ' ').slice(0, 200);

  /** Send the welcome message owed to this account, if it is owed, due and nobody else is sending it. Never throws. */
  function send(id: string): Promise<void> {
    const work = (async () => {
      const bound = deps;
      if (!bound || stopped || !ready()) return;
      try {
        const owed = await ctx.store.transact(db => claimWelcome(db, bound, id));
        if (!owed) return;
        // The operator's switch stops every e-mail; this one waits its turn like a failed send.
        const off = await ctx.store.read(db => db.growth?.outreach?.off?.email === true);
        const result = off ? { ok: false, status: 0, error: 'switched_off' } : await sendMail(ctx, { to: owed.email, ...accountWelcomeMail({ name: owed.name, playUrl: `${origin()}/`, contact: contact() }) });
        const status = result.status ?? 0;
        // Worth another try: the mailer could not be reached or asked to wait. A 4xx is the mailer refusing THIS message (a bad or bounced address): never again.
        const retry = off || status === 0 || status === 429 || status >= 500;
        await ctx.store.transact(db => settleWelcome(db, bound, id, { ok: result.ok, retry }));
        if (!result.ok && !off) ctx.core.log?.(`Welcome message was not sent: ${String(result.error ?? 'failed').slice(0, 40)}`);
      } catch (error) { ctx.core.log?.(`Welcome message could not be recorded: ${String((error as { code?: unknown } | null)?.code ?? 'error').slice(0, 40)}`); }
    })();
    inFlight.add(work);
    void work.finally(() => inFlight.delete(work));
    return work;
  }
  /** Send what is owed and due (a message whose first attempt failed, or was owed when the host stopped). At most once a minute. */
  async function tick(force = false): Promise<number> {
    if (!deps || stopped || !ready() || (!force && ctx.now() - lastTick < TICK_MS)) return 0;
    lastTick = ctx.now();
    let due: string[] = [];
    try { due = await ctx.store.read(db => dueWelcomes(db, ctx.now())); } catch { return 0; }
    for (const id of due) await send(id);
    return due.length;
  }
  ctx.on?.('heartbeat', () => { ctx.waitUntil?.(tick()); });
  // A message being sent when the host stops is waited for, so that "sent" is recorded and it can never go twice.
  ctx.closing?.push(async () => { stopped = true; await Promise.allSettled([...inFlight]); });
  return { ready, send, tick, bind(value: AccountDeps): void { deps = value; } };
}
