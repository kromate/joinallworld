import './world-map.css';

const CITIES = [
  { id: 'lagos', label: 'Lagos', country: 'Nigeria', region: 'Lagos State', longitude: 3.3792, latitude: 6.5244 },
  { id: 'ibadan', label: 'Ibadan', country: 'Nigeria', region: 'Oyo State', longitude: 3.9470, latitude: 7.3775 },
];
// Hand-drawn schematic outlines; they only decide which grid dots count as land.
const CONTINENTS = [
  'M72 104 101 83 134 84 154 65 187 76 202 63 228 80 252 77 277 102 280 124 257 132 246 157 225 164 211 180 204 202 187 211 181 231 161 226 149 205 124 189 109 165 87 148Z',
  'M202 222 219 225 231 241 247 245 263 261 255 273 239 263 226 246 212 242Z',
  'M270 268 288 259 313 264 331 280 351 284 363 304 357 330 346 348 342 373 325 394 316 415 303 437 292 430 288 405 276 390 281 366 267 347 257 319 259 291Z',
  'M329 59 360 40 390 44 400 65 388 91 367 107 347 100 335 82Z',
  'M464 149 475 137 489 141 489 127 502 124 507 102 521 87 531 91 525 115 515 130 534 133 545 146 537 160 521 170 506 161 494 170 479 165Z',
  'M471 191 495 181 523 186 540 180 560 190 571 211 581 234 593 246 581 266 565 278 554 304 542 325 524 344 508 336 499 315 495 292 481 277 471 257 456 244 449 220Z',
  'M538 143 551 125 579 124 591 103 622 104 640 86 676 90 704 78 727 87 753 80 783 99 811 93 835 105 861 100 884 121 901 129 881 146 856 148 840 167 818 173 800 191 772 193 756 215 739 219 726 238 712 232 704 211 686 205 671 216 660 241 647 257 634 246 626 220 611 208 597 212 584 191 568 187 557 166Z',
  'M685 244 694 244 703 260 716 269 728 271 736 284 725 288 710 278 701 264Z',
  'M736 294 758 288 778 297 799 295 822 307 817 320 796 314 776 316 758 308Z',
  'M788 340 806 327 827 328 849 316 874 321 889 341 886 369 870 384 849 385 831 375 813 380 794 364Z',
  'M913 383 920 367 927 371 923 389 910 404 903 399Z',
  'M564 306 572 309 574 330 566 342 560 329Z',
  'M844 172 850 162 853 172 849 188 843 196 839 190Z',
];
const WIDTH = 1000;
const HEIGHT = 480;
const CENTER_X = 500;
const CENTER_Y = 240;
const DOT_STEP = 12;
const PIN_GAP = 30;

// Built once: every land dot is a zero-length round-capped segment in a single path.
const LAND_DOTS = (() => {
  const polygons = CONTINENTS.map(d => {
    const values = d.match(/\d+/g).map(Number);
    const points = [];
    for (let i = 0; i < values.length; i += 2) points.push([values[i], values[i + 1]]);
    return points;
  });
  const inside = (x, y, points) => {
    let hit = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[j];
      if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) hit = !hit;
    }
    return hit;
  };
  let path = '';
  for (let y = DOT_STEP; y < HEIGHT; y += DOT_STEP) {
    for (let x = DOT_STEP; x < WIDTH; x += DOT_STEP) {
      if (polygons.some(points => inside(x, y, points))) path += `M${x} ${y}h.01`;
    }
  }
  return path;
})();

export function createWorldMap(container, { onSelectCity } = {}) {
  const element = document.createElement('section');
  element.className = 'awm';
  element.setAttribute('aria-label', 'World map and city travel');
  element.innerHTML = `
    <div class="awm-heading"><h2>A world to belong to.</h2><p>Start in Nigeria. Discover your people.</p></div>
    <div class="awm-viewport">
      <svg class="awm-svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" tabindex="0" role="group" aria-label="Dot map of the world. Drag to move. Arrow keys move, plus and minus zoom, square brackets rotate, Home resets.">
        <g class="awm-geography"><path class="awm-land" d="${LAND_DOTS}"/></g>
        <g class="awm-pins">${CITIES.map(city => `<g class="awm-pin" data-city="${city.id}" tabindex="0" role="button" aria-label="Travel to ${city.label}, ${city.country}" aria-pressed="false"><circle class="awm-pin-hit" r="14"/><circle class="awm-pin-ring" r="9"/><circle class="awm-pin-dot" r="5"/><text class="awm-pin-name" dominant-baseline="central">${city.label}</text></g>`).join('')}</g>
      </svg>
      <div class="awm-controls" role="group" aria-label="Map controls"><button data-action="zoom-in" aria-label="Zoom in" title="Zoom in">+</button><button data-action="zoom-out" aria-label="Zoom out" title="Zoom out">−</button><button data-action="rotate-left" aria-label="Rotate map left by 15 degrees" title="Rotate left">↶</button><button data-action="rotate-right" aria-label="Rotate map right by 15 degrees" title="Rotate right">↷</button><button data-action="reset" aria-label="Reset map view" title="Reset map view">⌖</button></div>
      <div class="awm-zoom" aria-live="polite">100%</div>
    </div>
    <div class="awm-destinations"><div class="awm-destinations-title">Where will you go?</div><div class="awm-city-list">${CITIES.map(city => `<button class="awm-city" data-city="${city.id}" aria-pressed="false"><span class="awm-city-dot" aria-hidden="true"></span><span class="awm-city-copy"><strong>${city.label}</strong><span>${city.region}, ${city.country}</span></span><span class="awm-travel">Travel ↗</span></button>`).join('')}</div></div>`;
  container.appendChild(element);
  const svg = element.querySelector('svg');
  const geography = element.querySelector('.awm-geography');
  const pinElements = [...element.querySelectorAll('.awm-pin')];
  const pinNames = pinElements.map(pin => pin.querySelector('.awm-pin-name'));
  const zoomLabel = element.querySelector('.awm-zoom');
  const zoomIn = element.querySelector('[data-action="zoom-in"]');
  const zoomOut = element.querySelector('[data-action="zoom-out"]');
  const pointers = new Map();
  const listeners = [];
  let zoom = 1;
  let rotation = 0;
  let panX = 0;
  let panY = 0;
  let selectedCity = 'lagos';
  let destroyed = false;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  }
  function unitPerPixel() {
    const rect = svg.getBoundingClientRect();
    return 1 / Math.max(0.001, Math.min(rect.width / WIDTH, rect.height / HEIGHT));
  }
  function draw() {
    if (destroyed) return;
    geography.setAttribute('transform', `translate(${CENTER_X + panX} ${CENTER_Y + panY}) rotate(${rotation}) scale(${zoom}) translate(${-CENTER_X} ${-CENTER_Y})`);
    const radians = rotation * Math.PI / 180;
    const scale = unitPerPixel();
    const spots = CITIES.map(city => {
      const dx = (city.longitude + 180) / 360 * WIDTH - CENTER_X;
      const dy = (90 - city.latitude) / 180 * 500 - CENTER_Y;
      return {
        x: CENTER_X + panX + (dx * Math.cos(radians) - dy * Math.sin(radians)) * zoom,
        y: CENTER_Y + panY + (dx * Math.sin(radians) + dy * Math.cos(radians)) * zoom,
      };
    });
    // The two cities sit almost on top of each other at world scale, so keep their dots a tap apart.
    const [first, second] = spots;
    const gap = PIN_GAP * scale;
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    if (distance < gap) {
      const ux = distance > 0.001 ? (second.x - first.x) / distance : 0.55;
      const uy = distance > 0.001 ? (second.y - first.y) / distance : -0.83;
      const midX = (first.x + second.x) / 2;
      const midY = (first.y + second.y) / 2;
      first.x = midX - ux * gap / 2; first.y = midY - uy * gap / 2;
      second.x = midX + ux * gap / 2; second.y = midY + uy * gap / 2;
    }
    pinElements.forEach((pin, index) => {
      const spot = spots[index];
      const other = spots[1 - index];
      const left = spot.x < other.x || (spot.x === other.x && index === 0);
      pin.setAttribute('transform', `translate(${spot.x} ${spot.y}) scale(${scale})`);
      pinNames[index].setAttribute('x', left ? -14 : 14);
      pinNames[index].setAttribute('text-anchor', left ? 'end' : 'start');
    });
    const percent = `${Math.round(zoom * 100)}%`;
    if (zoomLabel.textContent !== percent) zoomLabel.textContent = percent;
    zoomIn.disabled = zoom >= 12;
    zoomOut.disabled = zoom <= 0.65;
  }
  function setCity(id) {
    if (!CITIES.some(city => city.id === id)) return;
    selectedCity = id;
    element.querySelectorAll('[data-city]').forEach(node => {
      const current = node.dataset.city === selectedCity;
      node.classList.toggle('is-current', current);
      node.setAttribute('aria-pressed', String(current));
      const travel = node.querySelector('.awm-travel');
      if (travel) travel.textContent = current ? 'You’re here ✓' : 'Travel ↗';
    });
  }
  function select(id) {
    const city = CITIES.find(value => value.id === id);
    if (city) onSelectCity?.({ id: city.id, label: city.label, country: city.country, region: city.region });
  }
  function adjustZoom(factor) { zoom = clamp(zoom * factor, 0.65, 12); draw(); }
  function reset() { zoom = 1; rotation = 0; panX = 0; panY = 0; draw(); }
  element.querySelectorAll('[data-city]').forEach(node => {
    listen(node, 'click', () => select(node.dataset.city));
    if (node.tagName.toLowerCase() === 'g') listen(node, 'keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); select(node.dataset.city); }
    });
  });
  element.querySelectorAll('[data-action]').forEach(button => listen(button, 'click', () => {
    switch (button.dataset.action) {
      case 'zoom-in': adjustZoom(1.3); break;
      case 'zoom-out': adjustZoom(1 / 1.3); break;
      case 'rotate-left': rotation -= 15; draw(); break;
      case 'rotate-right': rotation += 15; draw(); break;
      case 'reset': reset(); break;
    }
  }));
  listen(svg, 'wheel', event => { event.preventDefault(); adjustZoom(Math.exp(-clamp(event.deltaY, -120, 120) * 0.003)); }, { passive: false });
  listen(svg, 'pointerdown', event => {
    if (event.target.closest('[data-city]') || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    svg.setPointerCapture(event.pointerId);
    svg.classList.add('is-dragging');
  });
  listen(svg, 'pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    const before = [...pointers.values()];
    const previous = pointers.get(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = [...pointers.values()];
    if (after.length === 1) {
      panX += (event.clientX - previous.x) * unitPerPixel();
      panY += (event.clientY - previous.y) * unitPerPixel();
    } else if (after.length === 2) {
      const distance = points => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (distance(before) > 1) zoom = clamp(zoom * distance(after) / distance(before), 0.65, 12);
      panX += ((after[0].x + after[1].x) - (before[0].x + before[1].x)) * 0.5 * unitPerPixel();
      panY += ((after[0].y + after[1].y) - (before[0].y + before[1].y)) * 0.5 * unitPerPixel();
    }
    panX = clamp(panX, -2500, 2500);
    panY = clamp(panY, -1500, 1500);
    draw();
  });
  const release = event => { pointers.delete(event.pointerId); if (!pointers.size) svg.classList.remove('is-dragging'); };
  listen(svg, 'pointerup', release);
  listen(svg, 'pointercancel', release);
  listen(svg, 'lostpointercapture', release);
  listen(svg, 'keydown', event => {
    if (event.target !== svg) return;
    const shift = event.shiftKey ? 90 : 35;
    switch (event.key) {
      case 'ArrowLeft': panX += shift; break;
      case 'ArrowRight': panX -= shift; break;
      case 'ArrowUp': panY += shift; break;
      case 'ArrowDown': panY -= shift; break;
      case '+': case '=': adjustZoom(1.3); break;
      case '-': adjustZoom(1 / 1.3); break;
      case 'Home': reset(); break;
      case '[': rotation -= 15; break;
      case ']': rotation += 15; break;
      default: return;
    }
    event.preventDefault();
    draw();
  });
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
  observer?.observe(container);
  setCity(selectedCity);
  draw();
  return {
    setCity,
    resize: draw,
    destroy() { destroyed = true; observer?.disconnect(); listeners.forEach(remove => remove()); pointers.clear(); element.remove(); },
  };
}
