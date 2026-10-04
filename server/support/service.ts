/**
 * OWNER: support
 * "Report a problem": a player files a problem from inside the game and gets a receipt whose
 * status they can read later. No external account is involved at any point.
 *
 * STORED COLLECTION  ctx.collection(db, 'support')
 *   reports  [{ id: 'P-<n>', by, name, cityId, category, text, at, status, note, updatedAt, context }]
 *            newest last, at most LIMITS.reports. When full, the oldest CLOSED report makes room; if
 *            every one is still open the filing is refused with a reason rather than dropping one.
 *   seq      number
 * A filing is applied exactly once per `clientId` (ctx.once, server/routes/once.ts): the id is
 * mandatory, has the timed form `<unix ms>:<uuid>`, and its receipt lives in the player's session.
 * `by` is the public id. The cookie secret is never read into a report: the context below is built
 * field by field from the server-held life and the action receipts, not by copying the session.
 *
 * CONTEXT attached automatically (so a player never has to describe their own state)
 *   build        the server's build id
 *   at, cityId   server time and the city the report is about
 *   life         { cash, location, spot, job, action: { kind, id, remaining } | null, message }
 *   actions      the player's last 10 actions, newest first: { at, type, ok, code }
 *   lastError    the newest of those that was refused, or null
 *   ledger       the last 10 wallet lines: { at, amount, reason, balance }
 *
 * STATUS  received → reviewing → resolved | dismissed   (set by an operator; `note` is shown to the player)
 */
export const LIMITS = Object.freeze({ reports: 2000, own: 30, openPerPlayer: 5, text: 600, note: 300, perHour: 3, perAddressPerHour: 10, actions: 10, ledger: 10 });
export const CATEGORIES = Object.freeze(['money', 'stuck', 'messages', 'people', 'bug', 'other']);
export const STATUSES = Object.freeze(['received', 'reviewing', 'resolved', 'dismissed']);
const OPEN = ['received', 'reviewing'];
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const no = (code, reason) => ({ ok: false, code, reason });

export function supportService(ctx) {
  function col(db) {
    const s = ctx.collection(db, 'support');
    if (!Array.isArray(s.reports)) s.reports = [];
    if (!Number.isSafeInteger(s.seq)) s.seq = 0;
    return s;
  }
  const receipt = (report) => ({ id: report.id, at: report.at, cityId: report.cityId, category: report.category, text: report.text, status: report.status, note: report.note || '', updatedAt: report.updatedAt });
  /** Built from named fields only. Nothing here can carry the session secret. */
  function contextOf(session, cityId, state) {
    const actions = Object.values(isRecord(session.actions) ? session.actions : {})
      .filter((item) => item && Number.isFinite(item.actionAt))
      .sort((a, b) => b.actionAt - a.actionAt).slice(0, LIMITS.actions)
      .map((item) => ({ at: item.actionAt, type: typeof item.type === 'string' ? item.type.slice(0, 40) : 'unknown', ok: item.ok === true, code: String(item.code ?? '').slice(0, 40) }));
    const active = state.activeAction;
    return {
      build: ctx.config?.buildId ?? 'unknown', at: ctx.now(), cityId,
      life: { cash: state.cash, location: state.location, spot: state.spot ?? null, job: state.job ?? null,
        action: active ? { kind: active.kind, id: active.id, remaining: Math.round(active.remaining) } : null, message: String(state.message ?? '').slice(0, 300) },
      actions,
      lastError: actions.find((item) => !item.ok) ?? null,
      ledger: (Array.isArray(state.ledger) ? state.ledger : []).slice(-LIMITS.ledger).map((line) => ({ at: line.at, amount: line.amount, reason: line.reason, balance: line.balance })),
    };
  }
  return {
    LIMITS,
    /** body: { cityId, category, text, clientId }. Exactly once per clientId (ctx.once); the id is mandatory. */
    file(db, session, body, address) {
      if (!ctx.cityIds.includes(body.cityId)) throw ctx.fail(400, 'invalid_city');
      if (!CATEGORIES.includes(body.category)) throw ctx.fail(400, 'invalid_category');
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (text.length < 3 || text.length > LIMITS.text || CONTROL.test(text)) throw ctx.fail(400, 'invalid_report_text');
      ctx.onceId(body.clientId);
      const s = col(db), id = session.publicId;
      const outcome = ctx.once(db, session, { id: body.clientId, kind: 'support.report', fingerprint: [body.cityId, body.category, text] }, () => {
        if (s.reports.filter((report) => report.by === id && OPEN.includes(report.status)).length >= LIMITS.openPerPlayer) {
          return no('too_many_open', `You already have ${LIMITS.openPerPlayer} problem reports waiting. They are listed below with their status; add to one of those when it is answered.`);
        }
        if (!ctx.allow(`support:file:${id}`, LIMITS.perHour, 3600000) || !ctx.allow(`support:address:${address}`, LIMITS.perAddressPerHour, 3600000)) {
          return no('rate_limited', 'You have filed several problem reports this hour. Try again later; the ones you filed are kept.');
        }
        if (s.reports.length >= LIMITS.reports) {
          const closed = s.reports.findIndex((report) => !OPEN.includes(report.status));
          if (closed < 0) return no('inbox_full', 'The problem inbox is full right now. Nothing was filed; please try again later.');
          s.reports.splice(closed, 1);
        }
        const state = ctx.settle(session, body.cityId);
        const report = { id: `P-${++s.seq}`, by: id, name: session.name, cityId: body.cityId, category: body.category, text, at: ctx.now(), status: 'received', note: '', updatedAt: ctx.now(),
          context: contextOf(session, body.cityId, state) };
        s.reports.push(report);
        return { ok: true, code: 'filed', id: report.id };
      });
      if (outcome.ok === false) return outcome;
      // The receipt is read from the report as it stands now, so a repeat shows the current status.
      const report = s.reports.find((item) => item.id === outcome.id && item.by === id);
      return { ok: true, code: 'filed', ...(outcome.duplicate ? { duplicate: true } : {}), receipt: report ? receipt(report) : { id: outcome.id } };
    },
    /** The caller's own receipts, newest first. */
    mine(db, session) {
      const reports = col(db).reports.filter((report) => report.by === session.publicId).slice(-LIMITS.own).reverse().map(receipt);
      return { ok: true, code: 'ok', reports, categories: CATEGORIES, limits: { text: LIMITS.text, open: LIMITS.openPerPlayer } };
    },
    // ---- operator side (routes/moderation.js) ------------------------------------------------
    list(db, status = 'open', limit = 100) {
      const all = col(db).reports;
      return all.filter((report) => status === 'all' || (status === 'open' ? OPEN.includes(report.status) : report.status === status)).slice(-limit).reverse();
    },
    counts(db) {
      const all = col(db).reports;
      return { total: all.length, open: all.filter((report) => OPEN.includes(report.status)).length };
    },
    setStatus(db, id, status, note) {
      const report = col(db).reports.find((item) => item.id === id);
      if (!report) return null;
      report.status = status; report.note = note; report.updatedAt = ctx.now();
      return report;
    },
  };
}
