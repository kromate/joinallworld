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
 *             middle of a send) is released after a day for ONE last attempt and then abandoned: it cannot sit in the
 *             queue for good, and a message that may already have gone out is never sent a third time.
 *   one ledger  The welcome counts as one of the character's mails in the comeback ledger (growth.comeback[id].sent, type
 *             'welcome'; server/growth/comeback.ts adds it on its next look), under the same daily and weekly caps and the
 *             same EMAIL_DAILY_CAP as every other mail: a new account is not sent a welcome and a comeback mail on one day.
 *   bounded   An address is welcomed at most once in 30 days (a salted hash is remembered), so deleting an account
 *             and making it again earns no second message; and every welcome counts against the mailer's daily
 *             allowance (EMAIL_DAILY_CAP) — at the allowance it waits for the next day.
 * The send runs after the sign-in has been answered (ctx.waitUntil) and again from the host's heartbeat for what is
 * due. Nothing it does can fail or delay a sign-in.
 *
 * OFF WHEN THE MAILER IS NOT CONFIGURED (ZEPTOMAIL_AUTH, EMAIL_FROM_ADDRESS and PUBLIC_ORIGIN): nothing is marked,
 * queued, sent or logged. The operator's e-mail switch (Stay in touch → outreach) holds this message back too; it
 * waits, without using up an attempt.
 *
 * Nothing here logs an address or a name. Portable: no Node imports.
 */
import { mailConfig, sendMail } from '../growth/email/zeptomail.ts';
import { accountWelcomeMail } from '../growth/email/templates.ts';
import { lagosTime } from '../../src/game/clock.ts';
import { growthOf } from '../growth/data.ts';
import { claimWelcome, dueWelcomes, reviveWelcomes, settleWelcome } from './service.ts';
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
  /** The mailer's daily allowance (EMAIL_DAILY_CAP, as server/growth/outreach.ts reads it): a welcome message counts against it like any other e-mail. */
  const dailyCap = (): number => { const raw = ctx.env('EMAIL_DAILY_CAP').trim(), value = Number(raw); return /^\d{1,9}$/.test(raw) && Number.isSafeInteger(value) ? value : 500; };
  const today = (): string => String(lagosTime(ctx.now()).day);

  /** Send the welcome message owed to this account, if it is owed, due and nobody else is sending it. Never throws. */
  function send(id: string): Promise<void> {
    const work = (async () => {
      const bound = deps;
      if (!bound || stopped || !ready()) return;
      try {
        // Claimed, and — in the same transaction — checked against what may go out at all: the operator's switch, and the day's allowance.
        const claim = await ctx.store.transact((db) => {
          const owed = claimWelcome(db, bound, id);
          if (!owed) return null;
          // One ledger with comeback mail (server/growth/comeback.ts): a mail already sent to this character in the last day holds the welcome back, as it would hold another comeback mail.
          const character = db.accounts?.[id]?.publicId, ledger = character ? db.growth?.comeback?.[character]?.sent : undefined;
          const recent = Array.isArray(ledger) && ledger.some((entry) => entry.at <= ctx.now() && ctx.now() - entry.at < 86400000);
          const held = db.growth?.outreach?.off?.email === true || (db.growth?.outreach?.sent?.[today()]?.email ?? 0) >= dailyCap() || recent;
          // Held back: nothing was attempted, so no try is spent; it waits its turn.
          if (held) settleWelcome(db, bound, id, { ok: false, retry: true, counted: false });
          return held ? null : owed;
        });
        if (!claim) return;
        const result = await sendMail(ctx, { to: claim.email, ...accountWelcomeMail({ name: claim.name, playUrl: `${origin()}/`, contact: contact() }) });
        const status = result.status ?? 0;
        // Worth another try: the mailer could not be reached or asked to wait. A 4xx is the mailer refusing THIS message (a bad or bounced address): never again.
        const retry = status === 0 || status === 429 || status >= 500;
        await ctx.store.transact((db) => {
          settleWelcome(db, bound, id, { ok: result.ok, retry });
          if (!result.ok) return;
          // It went out: one of today's e-mails, counted where the mailer's other messages are counted.
          const g = growthOf(ctx, db), book = (g.outreach ||= { off: {}, log: [], sent: {}, previews: [] }), day = today();
          const sent = (book.sent[day] ||= { email: 0, push: 0 });
          sent.email = (sent.email ?? 0) + 1;
        });
        if (!result.ok) ctx.core.log?.(`Welcome message was not sent: ${String(result.error ?? 'failed').slice(0, 40)}`);
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
    const bound = deps;
    let due: string[] = [];
    try {
      // A claim left unsettled for a day is released for its one last attempt, or abandoned (service.ts reviveWelcomes).
      if (await ctx.store.read(db => (db.accountLog?.welcome ?? []).some(item => item.claimedAt !== undefined && ctx.now() - item.claimedAt >= 86400000))) await ctx.store.transact(db => reviveWelcomes(db, bound));
      due = await ctx.store.read(db => dueWelcomes(db, ctx.now()));
    } catch { return 0; }
    for (const id of due) await send(id);
    return due.length;
  }
  ctx.on?.('heartbeat', () => { ctx.waitUntil?.(tick()); });
  // A message being sent when the host stops is waited for, so that "sent" is recorded and it can never go twice.
  ctx.closing?.push(async () => { stopped = true; await Promise.allSettled([...inFlight]); });
  return { ready, send, tick, bind(value: AccountDeps): void { deps = value; } };
}
