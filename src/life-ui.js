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
const cap = id => `${id[0].toUpperCase()}${id.slice(1)}`;
const actionsOf = venue => list(venue?.spots).flatMap(s => list(s.actions || s.activities)).concat(list(venue?.actions));

export function createLifeUI(root, callbacks = {}) {
  let state, view, signature = '', travel = 'danfo', destinationId = null, activeLabel = '', spotKey = '';
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
    const jobMissing=action.requiresJob && state.job !== action.requiresJob;
    const needRequirements=Object.entries(action.minimumNeeds || {});
    const needsMissing=needRequirements.some(([need, minimum]) => (state.needs?.[need] ?? 100) < minimum);
    // Need rows are filled in update() so the current values stay live without rebuilding the card.
    const requirementRows=`${jobMissing ? `<span class="is-unmet">✗ ${escape(action.requiresJob === 'community-helper' ? 'Community helper job' : action.requiresJob)}</span>` : ''}${needRequirements.map(([need,minimum]) => `<span data-requirement="${escape(need)}" data-minimum="${escape(minimum)}"></span>`).join('')}`;
    const blockedReason=jobMissing ? 'Apply in Phone → Jobs' : needsMissing ? 'Eat and rest at Home first' : '';
    const effects = action.effects || {};
    const tags = Array.isArray(effects) ? effects.map(text => ({text})) : Object.keys(effects).filter(k => effects[k]).map(k => effects[k] > 0 ? {text:`+${effects[k]} ${cap(k)}`} : {text:`−${-effects[k]} ${cap(k)}`,cost:true});
    if (action.beta) tags.push({text:'Beta'});
    for (const [need, rate] of Object.entries(action.effectsPerSecond || {})) {
      if (rate > 0) tags.push({text:`+${rate} ${cap(need)}/s`});
    }
    const blocked = unavailable || jobMissing || needsMissing || state.activeAction;
    const summary = [duration(action) != null ? `${duration(action)} seconds` : '', action.reward > 0 ? `earns ${money(action.reward)}` : '', ...tags.filter(t => t.cost).map(t => `uses ${t.text.slice(1)}`)].filter(Boolean).join(', ');
    return `<button class="life-action ${unavailable ? 'is-unavailable' : ''} ${requirementRows ? 'has-requirements' : ''}" data-command="action" data-value="${escape(action.id)}" ${blocked ? 'disabled' : ''} aria-label="${escape(action.name || action.label)}${unavailable ? ', unavailable in this preview' : `${summary ? `, ${escape(summary)}` : ''}${blockedReason ? `, ${escape(blockedReason)}` : ''}`}"><span class="life-action-meta"><span class="life-action-emoji">${escape(action.icon || action.emoji || ({chill:'🌳','stage-play':'🎭',comedy:'😂','spoken-word':'🗣️','perform-comedy':'🎙️','play-ayo':'🎲',garri:'🥣',bath:'🛁',nap:'🛏️','helper-shift':'💼'}[action.id]) || '✨')}</span><span>${duration(action) != null ? `◷ ${escape(duration(action))}s` : ''}<strong>${action.reward > 0 ? `+${money(action.reward)}` : price(action) != null ? price(action) === 0 ? 'Free' : money(price(action)) : ''}</strong></span></span><span class="life-action-title">${escape(action.name || action.label)}</span><span class="life-tags">${unavailable ? `<span class="life-locked">${escape(action.requirement || action.reason || (action.requiredSkill ? `Needs ${action.requiredSkill.name} ${action.requiredSkill.level}` : 'Unavailable in preview'))}</span>` : tags.map(t => `<span${t.cost ? ' class="is-cost"' : ''}>${escape(t.text)}</span>`).join('')}</span>${requirementRows ? `<span class="life-requirements">${requirementRows}${blockedReason ? `<strong>${escape(blockedReason)}</strong>` : ''}</span>` : ''}${action.reward > 0 && !blocked ? '<span class="life-action-cta">Start shift →</span>' : ''}</button>`;
  }
  function navigation() {
    return `<nav class="life-nav" aria-label="Main navigation">${[['home','Home'],['buy','Buy'],['map','Map'],['phone','Phone']].map(([id,label]) => `<button ${id === 'buy' ? 'disabled title="Shopping is unavailable in this preview"' : `data-command="navigate" data-value="${id}" ${id === 'home' ? 'title="Home · Free beta travel"' : ''}`} class="${(view.mode === 'map' ? id === 'map' : (id === 'home' && state.location === 'home')) ? 'is-selected' : ''}">${icon(id)}<span>${label}</span></button>`).join('')}</nav>`;
  }
  function venuePanel(venue) {
    const privateHome = state.location === 'home';
    const spots = list(venue.spots).filter(s => !privateHome || s.id !== 'people');
    const spot = spots.find(s => s.id === state.spot) || spots[0];
    const actions = list(spot?.actions || spot?.activities || venue.actions).filter(a => !a.spot || a.spot === state.spot);
    return `<section class="life-venue-panel" aria-label="Current venue"><header class="life-venue-header"><button class="life-avatar" data-command="panel" data-value="sim" aria-label="Open your profile">👤</button><div class="life-venue-heading"><h1>${escape(venue.icon || venue.emoji || (venue.id === 'home' ? '🏠' : venue.id === 'library' ? '📚' : '🌳'))} ${escape(venue.name || venue.label)} <span>· ${escape(venue.district || '')}</span></h1><p>${escape(spot?.caption || spot?.description || ({amphitheatre:'Poets warming up by the stage',art:'Art in the heart of the city',trees:'Cool breeze under the trees',drinks:'A quiet stop by the kiosk',work:'Lend a hand at the Community desk',people:view.connected ? 'Meet your city community' : 'Single-player local preview'}[state.spot]) || venue.caption || 'Explore at your own pace')}</p></div><button class="life-icon-button" data-command="navigate" data-value="map" aria-label="Open map">${icon('map')}</button><button class="life-icon-button" data-command="panel" data-value="help" aria-label="Help">?</button></header><div class="life-chat">${privateHome ? '<span class="life-private-home">🔒 Your private home</span>' : view.connected ? '<button class="life-community-chat" data-command="panel" data-value="people"><span>💬 Open community chat</span><span aria-hidden="true">→</span></button>' : `<input aria-label="Chat unavailable in offline preview" placeholder="Offline preview · chat is unavailable" disabled><button disabled aria-label="Send message unavailable">${icon('send')}</button>`}</div><div class="life-spots"><button class="life-expand ${view.expanded ? 'is-expanded' : ''}" data-command="panel" data-value="activities" aria-expanded="${!!view.expanded}" aria-label="${view.expanded ? 'Collapse' : 'Expand'} activities">${icon('chevron')}</button>${spots.map(s => `<button class="${s.id === state.spot ? 'is-selected' : ''}" data-command="spot" data-value="${escape(s.id)}">${escape(s.icon || s.emoji || ({amphitheatre:'🎭',art:'🖼️',trees:'🌳',drinks:'🍹',people:'👥',kitchen:'🥣',bathroom:'🛁',bedroom:'🛏️',work:'💼'}[s.id]) || '')} ${escape(s.name || s.label)}</button>`).join('')}${privateHome || spots.some(s=>s.id==='people') ? '' : '<button data-command="panel" data-value="people">👥 People</button>'}</div>${view.expanded ? `<div class="life-actions">${actions.length ? actions.map(actionCard).join('') : '<p class="life-empty">No activities at this spot yet.</p>'}</div>` : ''}</section>`;
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
    for (const row of root.querySelectorAll('[data-requirement]')) {
      const value = Number(state.needs?.[row.dataset.requirement] ?? 100), minimum = Number(row.dataset.minimum), met = value >= minimum;
      const text = `${met ? '✓' : '✗'} ${cap(row.dataset.requirement)} ${Math.floor(value)} (needs ${minimum})`;
      if (row.textContent !== text) { row.textContent = text; row.className = met ? 'is-met' : 'is-unmet'; }
    }
    // The progress card already names the running action, so only show messages that add something.
    const text = state.message || '', repeated = !!state.activeAction && (text === activeLabel || text.startsWith('Travelling to '));
    const message = root.querySelector('[data-message]'); message.textContent = text; message.hidden = !text || repeated;
    const progress = root.querySelector('[data-progress]');
    if (progress && state.activeAction) { const a=state.activeAction; const ratio=Math.max(0,Math.min(1,1-a.remaining/(a.duration || 1))); progress.value=ratio; root.querySelector('[data-remaining]').textContent=`${Math.ceil(a.remaining)}s remaining`; }
  }
  function render(nextState, nextView) {
    state=nextState; view=nextView;
    if (!state || !view) return;
    if (destinationId !== view.selectedDestination?.id) { destinationId=view.selectedDestination?.id; travel=view.selectedTravel || 'danfo'; }
    const venue=venueFor(view.catalog,state.location);
    const action=state.activeAction;
    const allActions=actionsOf(venue);
    const catalogActions=list(view.catalog).flatMap(actionsOf);
    const activeCatalogAction=action?.kind === 'activity' ? allActions.find(a=>a.id===action.id) || catalogActions.find(a=>a.id===action.id) : null;
    const paid=activeCatalogAction?.reward > 0;
    const jobAction=state.job ? catalogActions.find(a=>a.requiresJob === state.job) : null;
    const tired=Object.entries(jobAction?.minimumNeeds || {}).some(([need,min]) => (state.needs?.[need] ?? 100) < min);
    activeLabel=activeCatalogAction?.label || activeCatalogAction?.name || '';
    const starter=paid ? {icon:'⏳',title:'Shift in progress',hint:`${money(activeCatalogAction.reward)} when it finishes`,busy:true}
      : state.location === 'home' ? {icon:'🥣',title:'Make yourself at home',hint:'Kitchen → Eat Garri'}
      : state.location === 'library' ? {icon:'🗺️',title:'Explore your city',hint:'Open Map'}
      : !state.job ? {icon:'💼',title:'Find your first job',hint:'See the starter job'}
      : tired ? {icon:'🥣',title:'Rest before your shift',hint:'Eat and rest at Home'}
      : state.spot === 'work' ? {icon:'💼',title:'Start your shift',hint:view.expanded ? 'Tap the shift card below' : 'Open the Community desk',active:true}
      : {icon:'💼',title:'Work a shift',hint:'Community desk'};
    const availability=list(venue.spots).flatMap(s=>list(s.actions || s.activities)).concat(list(venue.actions)).map(a => [a.id,!a.requiresJob || state.job === a.requiresJob,...Object.entries(a.minimumNeeds || {}).map(([need,min]) => (state.needs?.[need] ?? 100) >= min)]);
    const affordability=list(view.travelModes).map(m=>state.cash >= (m.cost ?? m.price ?? 0));
    const nextSignature=JSON.stringify([starter,affordability,availability,state.job,!!view.connected,view.mode,view.expanded,state.location,state.spot,view.selectedDestination,travel,view.travelModes,view.name,venue,state.activeAction?.id,state.activeAction?.kind,!!state.activeAction]);
    if (signature !== nextSignature) {
      signature=nextSignature;
      const destination=action?.kind==='travel' ? venueFor(view.catalog,action.id) : null;
      const actionName=activeLabel || (destination ? `Travelling to ${destination.name || destination.label}` : 'Activity in progress');
      const progress=action ? `<section class="life-progress" aria-label="Current activity"><div><strong>${escape(actionName)}</strong><small data-remaining></small></div><button data-command="cancel" aria-label="${paid ? 'Cancel shift. Cancelling earns nothing' : 'Cancel current activity'}">Cancel</button><progress max="1" value="0" data-progress aria-label="Activity progress"></progress>${paid ? `<p class="life-progress-note">Pays ${money(activeCatalogAction.reward)} when finished. Cancelling earns nothing.</p>` : ''}</section>` : '';
      const railLeft=root.querySelector('.life-spots')?.scrollLeft || 0;
      root.innerHTML=`<div class="life-identity"><strong>Join<span>Allworld</span></strong><small>${view.connected ? 'City beta' : 'Local preview'}</small></div><section class="life-status" aria-label="Player status"><span class="life-clock" data-clock></span><span class="life-mood" data-mood></span><button class="life-status-profile" data-command="panel" data-value="sim">👤 ${escape(view.name || 'Your sim')}</button><span class="life-cash" data-cash></span></section><aside class="life-sidebar"><button class="life-job ${starter.active || starter.busy ? 'is-active' : ''}" data-command="panel" data-value="first-activity" ${starter.busy ? 'disabled' : ''}><span>${starter.icon}</span><div><strong>${starter.title}</strong><small>${starter.hint}</small></div></button><div class="life-needs" aria-label="Your needs">${needs.map(([id,emoji,label])=>`<div class="life-need" title="${label}"><span aria-hidden="true">${emoji}</span><div role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" data-need="${id}"><i></i></div></div>`).join('')}</div><button class="life-help" data-command="panel" data-value="help">? How to play</button></aside><div class="life-message" role="status" data-message></div><div class="life-bottom ${action ? 'has-progress' : ''}">${progress}${view.mode==='map' ? mapPanel() : venuePanel(venue)}${navigation()}</div>`;
      // Rebuilding resets the spot rail; keep the player's scroll and reveal a newly selected spot.
      const rail=root.querySelector('.life-spots');
      if (!rail) spotKey='';
      else {
        rail.scrollLeft=railLeft;
        const key=`${state.location}:${state.spot}`, selected=rail.querySelector('.is-selected[data-command="spot"]');
        const bounds=rail.getBoundingClientRect();
        if (key !== spotKey && bounds.width > 0) {
          spotKey=key;
          if (selected) {
            const box=selected.getBoundingClientRect(), lead=48;
            if (box.left < bounds.left + lead) rail.scrollLeft += box.left - bounds.left - lead;
            else if (box.right > bounds.right - 8) rail.scrollLeft += box.right - bounds.right + 8;
          }
        }
      }
    }
    update();
  }
  return {render,destroy(){root.removeEventListener('click',handler);root.replaceChildren();root.classList.remove('life-ui');}};
}
