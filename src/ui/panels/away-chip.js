/**
 * OWNER: growth
 * The "While you were away" chip — the STUB that is in the first download. The card itself (./away-card.js: the digest,
 * the calendar and the growth client behind it) is fetched once, after the HUD is up, for a connected player who has
 * settled in; until it has arrived — and for a guest in their first minutes, who has nothing to come back to — the chip
 * draws nothing. No timer: the fetch is asked for from bind(), when something was drawn.
 */
let card = null, loading = false;

const wanted = (view) => Boolean(view?.connected) && view.onboarding?.required !== true && view.onboarding?.guest !== true;

const chip = {
  id: 'away', title: 'While you were away', icon: 'bell', placement: 'hud', order: 5,
  slot: (state, view) => (card && wanted(view) ? card.slot(state, view) : 'hud'),
  render: (state, view) => (card && wanted(view) ? card.render(state, view) : '<span data-away-idle hidden></span>'),
  bind(root, api) {
    if (card) { if (wanted(api.view())) card.bind(root, api); return; }
    if (loading || !wanted(api.view())) return;
    loading = true;
    import('./away-card.js').then((module) => { card = module.card; api.refresh(); }).catch(() => { loading = false; });
  },
};

export default [chip];
