import './life-ui.css';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => `₦${Math.round(Number(value) || 0).toLocaleString('en-NG')}`;
const needs = [['hunger','🍲','Hunger'],['energy','⚡','Energy'],['fun','🎉','Fun'],['social','💬','Social'],['hygiene','🫧','Hygiene'],['bladder','🚻','Bladder']];
const icons = {
  home:'<path d="m3 10 9-7 9 7v10H6V10m3 10v-7h6v7"/>',
  map:'<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16"/>',
  phone:'<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  buy:'<path d="M5 9V5h14v4m-16 1h18v10H3V10Zm5 0v10m8-10v10"/>',
  chevron:'<path d="m6 9 6 6 6-6"/>',
  send:'<path d="m3 11 18-8-8 18-3-8-7-2Zm7 2L21 3"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
};
const icon = name => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.home}</svg>`;
const list = source => Array.isArray(source) ? source : Object.entries(source || {}).map(([id, value]) => typeof value === 'number' ? {id, cost:value, label:id[0].toUpperCase()+id.slice(1)} : {id,...value});
const venueFor = (catalog, location) => list(catalog).find(v => v.id === location) || catalog?.[location] || {id:location,name:location === 'home' ? 'Your home' : location === 'library' ? 'National Library' : 'Freedom Park',district:'',spots:[]};
const duration = action => action.duration ?? action.seconds;
const price = action => action.cost ?? action.price;

export function createLifeUI(root, callbacks = {}) {
  let state, view, signature = '', travel = 'danfo', destinationId = null;
  root.classList.add('life-ui');
  const handler = event => {
    const button = event.target.closest('button[data-command]');
    if (!button || !root.contains(button) || button.disabled) return;
    const {command, value} = button.dataset;
    if (command === 'navigate') callbacks.onNavigate?.(value);
    if (command === 'panel') callbacks.onPanel?.(value);
    if (command === 'spot') callbacks.onSpot?.(value);
    if (command === 'action') callbacks.onAction?.(value);
    if (command === 'cancel') callbacks.onCancel?.();
    if (command === 'mode') { travel = value; signature = ''; render(state, view); }
    if (command === 'travel' && view?.selectedDestination) callbacks.onTravel?.(view.selectedDestination.id, travel);
  };
  root.addEventListener('click', handler);
  function actionCard(action) {
    const unavailable = action.unavailable || action.locked;
    const effects = action.effects || {};
    const tags = Array.isArray(effects) ? [...effects] : Object.keys(effects).filter(k => effects[k] > 0).map(k => `+${effects[k]} ${k[0].toUpperCase()}${k.slice(1)}`);
    if (action.beta) tags.push('Beta');
    for (const [need, rate] of Object.entries(action.effectsPerSecond || {})) {
      if (rate > 0) tags.push(`+${rate} ${need[0].toUpperCase()}${need.slice(1)}/s`);
    }
    return `<button class="life-action ${unavailable ? 'is-unavailable' : ''}" data-command="action" data-value="${escape(action.id)}" ${unavailable || state.activeAction ? 'disabled' : ''} aria-label="${escape(action.name || action.label)}${unavailable ? ', unavailable in this preview' : ''}"><span class="life-action-meta"><span class="life-action-emoji">${escape(action.icon || action.emoji || ({chill:'🌳','stage-play':'🎭',comedy:'😂','spoken-word':'🗣️','perform-comedy':'🎙️','play-ayo':'🎲',garri:'🥣',bath:'🛁',nap:'🛏️'}[action.id]) || '✨')}</span><span>${duration(action) != null ? `◷ ${escape(duration(action))}s` : ''}<strong>${price(action) != null ? price(action) === 0 ? 'Free' : money(price(action)) : ''}</strong></span></span><span class="life-action-title">${escape(action.name || action.label)}</span><span class="life-tags">${unavailable ? `<span class="life-locked">${escape(action.requirement || action.reason || (action.requiredSkill ? `Needs ${action.requiredSkill.name} ${action.requiredSkill.level}` : 'Unavailable in preview'))}</span>` : tags.map(t => `<span>${escape(t)}</span>`).join('')}</span></button>`;
  }
  function navigation() {
    return `<nav class="life-nav" aria-label="Main navigation">${[['home','Home'],['buy','Buy'],['map','Map'],['phone','Phone']].map(([id,label]) => `<button ${id === 'buy' ? 'disabled title="Shopping is unavailable in this preview"' : `data-command="navigate" data-value="${id}" ${id === 'home' ? 'title="Home · Free beta travel"' : ''}`} class="${(view.mode === 'map' ? id === 'map' : (id === 'home' && state.location === 'home')) ? 'is-selected' : ''}">${icon(id)}<span>${label}</span></button>`).join('')}</nav>`;
  }
  function venuePanel(venue) {
    const spots = list(venue.spots);
    const spot = spots.find(s => s.id === state.spot) || spots[0];
    const actions = list(spot?.actions || spot?.activities || venue.actions).filter(a => !a.spot || a.spot === state.spot);
    return `<section class="life-venue-panel" aria-label="Current venue"><header class="life-venue-header"><button class="life-avatar" data-command="panel" data-value="sim" aria-label="Open your profile">👤</button><div class="life-venue-heading"><h1>${escape(venue.icon || venue.emoji || (venue.id === 'home' ? '🏠' : venue.id === 'library' ? '📚' : '🎭'))} ${escape(venue.name || venue.label)} <span>· ${escape(venue.district || '')}</span></h1><p>${escape(spot?.caption || spot?.description || ({amphitheatre:'Poets warming up by the stage',art:'Art in the heart of Lagos',trees:'Cool breeze under the trees',drinks:'A quiet stop by the kiosk',people:view.connected ? 'Meet your city community' : 'Single-player local preview'}[state.spot]) || venue.caption || 'Explore at your own pace')}</p></div><button class="life-icon-button" data-command="navigate" data-value="map" aria-label="Open map">${icon('map')}</button><button class="life-icon-button" data-command="panel" data-value="help" aria-label="Help">?</button></header><div class="life-chat">${view.connected ? '<button class="life-community-chat" data-command="panel" data-value="people"><span>💬 Open community chat</span><span aria-hidden="true">→</span></button>' : `<input aria-label="Chat unavailable in offline preview" placeholder="Offline preview · chat is unavailable" disabled><button disabled aria-label="Send message unavailable">${icon('send')}</button>`}</div><div class="life-spots"><button class="life-expand ${view.expanded ? 'is-expanded' : ''}" data-command="panel" data-value="activities" aria-expanded="${!!view.expanded}" aria-label="${view.expanded ? 'Collapse' : 'Expand'} activities">${icon('chevron')}</button>${spots.map(s => `<button class="${s.id === state.spot ? 'is-selected' : ''}" data-command="spot" data-value="${escape(s.id)}">${escape(s.icon || s.emoji || ({amphitheatre:'🎭',art:'🖼️',trees:'🌳',drinks:'🍹',people:'👥',kitchen:'🥣',bathroom:'🛁',bedroom:'🛏️'}[s.id]) || '')} ${escape(s.name || s.label)}</button>`).join('')}${spots.some(s=>s.id==='people') ? '' : '<button data-command="panel" data-value="people">👥 People</button>'}</div>${view.expanded ? `<div class="life-actions">${actions.length ? actions.map(actionCard).join('') : '<p class="life-empty">No activities at this spot yet.</p>'}</div>` : ''}</section>`;
  }
  function mapPanel() {
    const dest = view.selectedDestination;
    if (!dest) return `<section class="life-map-hint"><span>🗺️</span><div><h1>Where to?</h1><p>Choose a place on the map to visit.</p></div></section>`;
    const modes = list(view.travelModes).length ? list(view.travelModes) : [{id:'trek',name:'Trek',cost:0},{id:'keke',name:'Keke',cost:150},{id:'danfo',name:'Danfo',cost:150},{id:'okada',name:'Okada',cost:200},{id:'cab',name:'Cab',cost:400}];
    const selectedMode = modes.find(m => m.id === travel) || modes[0];
    const cost = selectedMode?.cost ?? selectedMode?.price ?? 0;
    return `<section class="life-destination" aria-label="Travel to ${escape(dest.name || dest.label)}"><div class="life-destination-preview ${escape(dest.id)}"><span>${escape(dest.icon || dest.emoji || (dest.id === 'home' ? '🏠' : dest.id === 'library' ? '📚' : '🌳'))}</span><span class="life-preview-label">Destination</span></div><div class="life-destination-body"><header><div><h1>${escape(dest.name || dest.label)}</h1><p>${escape(dest.district || '')}</p></div><button class="life-icon-button" data-command="navigate" data-value="map" aria-label="Close travel sheet">${icon('close')}</button></header><p class="life-destination-description">${escape(dest.description || '')}</p><div class="life-transit" role="group" aria-label="Travel method">${modes.map(m => `<button data-command="mode" data-value="${escape(m.id)}" aria-pressed="${m.id === travel}" class="${m.id === travel ? 'is-selected' : ''}"><span>${escape(m.icon || m.emoji || ({trek:'🚶',keke:'🛺',danfo:'🚌',okada:'🏍️',cab:'🚕'}[m.id]) || '🚶')}</span>${escape(m.name || m.label || m.id)}<small>${(m.cost ?? m.price ?? 0) === 0 ? 'Free' : money(m.cost ?? m.price)}</small></button>`).join('')}</div><button class="life-go" data-command="travel" ${state.cash < cost || state.activeAction ? 'disabled' : ''}>${state.cash < cost ? 'Not enough cash' : `Go${cost ? ` · ${money(cost)}` : ''}`} <span>→</span></button></div></section>`;
  }
  function update() {
    root.querySelector('[data-clock]').textContent = new Intl.DateTimeFormat('en-NG',{timeZone:'Africa/Lagos',weekday:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date()).replace(',', ' ·');
    const uneasy = needs.some(([id]) => Number(state.needs?.[id] ?? 100) < 35);
    const mood = root.querySelector('[data-mood]'); mood.textContent = uneasy ? '😟 Uneasy' : '🙂 Okay'; mood.classList.toggle('is-uneasy',uneasy);
    root.querySelector('[data-cash]').textContent = money(state.cash);
    for (const [id] of needs) { const meter = root.querySelector(`[data-need="${id}"]`); const value = Math.max(0,Math.min(100,Number(state.needs?.[id] ?? 100))); meter.style.setProperty('--need',`${value}%`); meter.setAttribute('aria-valuenow',String(Math.round(value))); meter.classList.toggle('is-low',value < 35); }
    const message = root.querySelector('[data-message]'); message.textContent = state.message || ''; message.hidden = !state.message;
    const progress = root.querySelector('[data-progress]');
    if (progress && state.activeAction) { const a=state.activeAction; const ratio=Math.max(0,Math.min(1,1-a.remaining/(a.duration || 1))); progress.value=ratio; root.querySelector('[data-remaining]').textContent=`${Math.ceil(a.remaining)}s remaining`; }
  }
  function render(nextState, nextView) {
    state=nextState; view=nextView;
    if (!state || !view) return;
    if (destinationId !== view.selectedDestination?.id) { destinationId=view.selectedDestination?.id; travel=view.selectedTravel || 'danfo'; }
    const venue=venueFor(view.catalog,state.location);
    const starter=state.location === 'home' ? {icon:'🥣',title:'Make yourself at home',hint:'Kitchen → Eat Garri'} : state.location === 'library' ? {icon:'🗺️',title:'Explore your city',hint:'Open Map'} : {icon:'🌳',title:'Settle into the city',hint:'Under the trees → Chill'};
    const affordability=list(view.travelModes).map(m=>state.cash >= (m.cost ?? m.price ?? 0));
    const nextSignature=JSON.stringify([affordability,!!view.connected,view.mode,view.expanded,state.location,state.spot,view.selectedDestination,travel,view.travelModes,view.name,venue,state.activeAction?.id,state.activeAction?.kind,!!state.activeAction]);
    if (signature !== nextSignature) {
      signature=nextSignature;
      const action=state.activeAction;
      const allActions=list(venue.spots).flatMap(s=>list(s.actions || s.activities)).concat(list(venue.actions));
      const activeCatalogAction=allActions.find(a=>a.id===action?.id);
      const actionName=activeCatalogAction?.label || activeCatalogAction?.name || (action?.kind==='travel' ? 'Travelling' : 'Activity in progress');
      root.innerHTML=`<div class="life-identity"><strong>Join<span>Allworld</span></strong><small>${view.connected ? 'City beta' : 'Local preview'}</small></div><section class="life-status" aria-label="Player status"><span class="life-clock" data-clock></span><span class="life-mood" data-mood></span><button class="life-status-profile" data-command="panel" data-value="sim">👤 ${escape(view.name || 'Your sim')}</button><span class="life-cash" data-cash></span></section><aside class="life-sidebar"><button class="life-job" data-command="panel" data-value="first-activity"><span>${starter.icon}</span><div><strong>${starter.title}</strong><small>${starter.hint}</small></div></button><div class="life-needs" aria-label="Your needs">${needs.map(([id,emoji,label])=>`<div class="life-need" title="${label}"><span aria-hidden="true">${emoji}</span><div role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" data-need="${id}"><i></i></div></div>`).join('')}</div><button class="life-help" data-command="panel" data-value="help">? How to play</button></aside><div class="life-message" role="status" data-message></div>${action ? `<section class="life-progress"><div><strong>${escape(actionName)}</strong><small data-remaining></small></div><progress max="1" value="0" data-progress aria-label="Activity progress"></progress><button data-command="cancel" aria-label="Cancel current activity">Cancel</button></section>` : ''}<div class="life-bottom">${view.mode==='map' ? mapPanel() : venuePanel(venue)}${navigation()}</div>`;
    }
    update();
  }
  return {render,destroy(){root.removeEventListener('click',handler);root.replaceChildren();root.classList.remove('life-ui');}};
}
