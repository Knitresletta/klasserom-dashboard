'use strict';

// ===================== Constants =====================
const STORAGE_KEY = 'klasserom_state_v1';

const GRUPPE_FARGER = [
  { bg: '#fce7f3', text: '#9d174d' },
  { bg: '#ede9fe', text: '#5b21b6' },
  { bg: '#d1fae5', text: '#065f46' },
  { bg: '#fef3c7', text: '#92400e' },
  { bg: '#dbeafe', text: '#1e40af' },
  { bg: '#f3e8ff', text: '#6b21a8' },
  { bg: '#ffe4e6', text: '#9f1239' },
  { bg: '#ccfbf1', text: '#134e4a' },
  { bg: '#fef9c3', text: '#713f12' },
  { bg: '#e0f2fe', text: '#075985' },
];

const WIDGET_NAVN = {
  'card-elever':     'Elever',
  'card-grupper':    'Grupper',
  'card-tilfeldig':  '🎲 Tilfeldig elev',
  'card-ordenselev': '⭐ Ordenselever',
  'card-ulv':        '🐺 Ulv',
  'card-timer':      '⏱ Timer',
  'card-notat':      '📝 Notat',
  'card-dagsplan':   '📋 Dagsplan',
};

const VÆR_KODER = {
  113: '☀️', 116: '⛅', 119: '☁️', 122: '☁️',
  143: '🌫️', 176: '🌦️', 263: '🌦️', 266: '🌦️',
  293: '🌧️', 302: '🌧️', 323: '❄️', 332: '❄️',
  386: '⛈️', 389: '⛈️',
};
const UKEDAGER = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const MÅNEDER  = ['januar', 'februar', 'mars', 'april', 'mai', 'juni',
                  'juli', 'august', 'september', 'oktober', 'november', 'desember'];

// ===================== State =====================
function defaultState() {
  return {
    elever:              [],
    notat:               '',
    dagsplan:            [],
    ordenselev_backlog:  [],
    ordenselev_valgte:   [],
    ulv_backlog:         [],
    ulv_valgt:           null,
    tilfeldig_backlog:   [],
    tilfeldig_valgt:     null,
    grupper:             null,
    lister:              {},
    timer_varighet:      300,
    widget_hidden:       [],
    widget_layout: [
      { id: 'card-elever',     col: 1, span: 1 },
      { id: 'card-grupper',    col: 1, span: 1 },
      { id: 'card-tilfeldig',  col: 2, span: 1 },
      { id: 'card-ordenselev', col: 2, span: 1 },
      { id: 'card-ulv',        col: 2, span: 1 },
      { id: 'card-timer',      col: 3, span: 1 },
      { id: 'card-notat',      col: 3, span: 1 },
      { id: 'card-dagsplan',   col: 3, span: 1 },
    ],
  };
}

let state = loadState();

// Timer runtime state (not persisted)
let timerRemaining = state.timer_varighet;
let timerRunning   = false;
let timerInterval  = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) {
    console.warn('loadState:', e);
  }
  return defaultState();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('saveState:', e);
  }
}

// ===================== Date / Weather =====================
function norskDato() {
  const d = new Date();
  return `${UKEDAGER[d.getDay()]} ${d.getDate()}. ${MÅNEDER[d.getMonth()]} ${d.getFullYear()}`;
}

function oppdaterDato() {
  document.getElementById('header-dato').textContent = norskDato();
}

async function hentVær() {
  try {
    const res = await fetch('https://wttr.in/Eidsvoll?format=j1', {
      headers: { 'User-Agent': 'klasserom-web/1.0' },
    });
    const data = await res.json();
    const c     = data.current_condition[0];
    const emoji = VÆR_KODER[parseInt(c.weatherCode)] || '🌡️';
    document.getElementById('header-ver').textContent = `${emoji} ${c.temp_C}°C  Eidsvoll`;
  } catch (_) {
    // Stille feil — ingen vær-data er OK
  }
}

// ===================== Students =====================
function leggTilElev(navn) {
  navn = navn.trim().replace(/\b\p{L}/gu, l => l.toUpperCase());
  if (!navn) return;
  if (state.elever.length >= 35) {
    notify('Klasselisten er full (maks 35 elever)', 'warning');
    return false;
  }
  if (state.elever.some(e => e.toLowerCase() === navn.toLowerCase())) {
    notify(`${navn} er allerede inne`, 'warning');
    return false;
  }
  state.elever = [...state.elever, navn];
  saveState();
  renderElever();
  renderAlleTrekk();
  notify(`✓ ${navn} lagt til`);
  return true;
}

function fjernElev(idx) {
  const navn = state.elever[idx];
  if (!navn) return;
  state.elever = state.elever.filter((_, i) => i !== idx);
  ryddBackloger(new Set([navn]));
  saveState();
  renderElever();
  renderAlleTrekk();
}

function fjernEleverBatch(fjernSett) {
  state.elever = state.elever.filter(e => !fjernSett.has(e));
  ryddBackloger(fjernSett);
  saveState();
  renderElever();
  renderAlleTrekk();
}

function ryddBackloger(fjernSett) {
  state.ordenselev_backlog = state.ordenselev_backlog.filter(e => !fjernSett.has(e));
  state.ordenselev_valgte  = state.ordenselev_valgte.filter(e => !fjernSett.has(e));
  state.ulv_backlog        = state.ulv_backlog.filter(e => !fjernSett.has(e));
  if (state.ulv_valgt && fjernSett.has(state.ulv_valgt)) state.ulv_valgt = null;
  state.tilfeldig_backlog  = state.tilfeldig_backlog.filter(e => !fjernSett.has(e));
  if (state.tilfeldig_valgt && fjernSett.has(state.tilfeldig_valgt)) state.tilfeldig_valgt = null;
}

function renderElever() {
  const liste   = document.getElementById('elev-liste');
  const antall  = state.elever.length;

  document.getElementById('elev-antall').textContent = antall;
  document.getElementById('elev-tekst').textContent  = antall === 1 ? 'elev inne' : 'elever inne';

  if (!antall) {
    liste.innerHTML = '<p class="tom-tekst">Ingen elever inne ennå.<br>Trykk "+ Legg til elev" for å starte.</p>';
    return;
  }

  // Bygg kart: elevnavn → gruppeindeks
  const gruppeKart = new Map();
  if (state.grupper) {
    state.grupper.forEach((g, gi) => g.forEach(n => gruppeKart.set(n, gi)));
  }

  liste.innerHTML = state.elever.map((navn, i) => {
    const gi        = gruppeKart.get(navn);
    const harGruppe = gi !== undefined;
    const farge     = harGruppe ? GRUPPE_FARGER[gi % GRUPPE_FARGER.length] : null;
    return `
      <div class="elev-item">
        <span class="elev-nr">${i + 1}.</span>
        ${harGruppe ? `<span class="elev-dot" style="background:${farge.text}"></span>` : ''}
        <span class="elev-navn"${harGruppe ? ` style="color:${farge.text}"` : ''}>${esc(navn)}</span>
        <button class="elev-slett" onclick="fjernElev(${i})" title="Fjern ${esc(navn)}">✕</button>
      </div>`;
  }).join('');
}

// ===================== Draws =====================
function trekkTilfeldig() {
  if (!state.elever.length) { notify('Ingen elever inne', 'error'); return; }
  const pool = state.elever.length > 1
    ? state.elever.filter(e => e !== state.tilfeldig_valgt)
    : state.elever;
  state.tilfeldig_valgt = pool[Math.floor(Math.random() * pool.length)];
  saveState();
  renderTilfeldig();
}

function trekkTilfeldigBacklog() {
  if (!state.elever.length) { notify('Ingen elever inne', 'error'); return; }
  const pool = state.elever.filter(e => !state.tilfeldig_backlog.includes(e));
  if (!pool.length) {
    notify('Alle elever er trukket — nullstill for å starte på nytt', 'warning');
    return;
  }
  state.tilfeldig_valgt = pool[Math.floor(Math.random() * pool.length)];
  if (!state.tilfeldig_backlog.includes(state.tilfeldig_valgt)) {
    state.tilfeldig_backlog.push(state.tilfeldig_valgt);
  }
  saveState();
  renderTilfeldig();
}

function trekkOrdenselev() {
  if (state.elever.length < 2) {
    notify(`Trenger minst 2 elever (${state.elever.length} inne)`, 'error');
    return;
  }
  let pool = state.elever.filter(e => !state.ordenselev_backlog.includes(e));
  if (!pool.length) {
    notify('Alle elever har vært ordenselev — nullstill for å starte på nytt', 'warning');
    return;
  }
  if (pool.length === 1) {
    // Siste i backlog: velg den, nullstill backlog, trekk en til fra resten
    const siste  = pool[0];
    state.ordenselev_backlog = [];
    const andre  = state.elever.filter(e => e !== siste);
    const valgt2 = andre[Math.floor(Math.random() * andre.length)];
    state.ordenselev_valgte = [siste, valgt2];
    state.ordenselev_backlog = [...state.ordenselev_valgte];
  } else {
    const shufflet = [...pool].sort(() => Math.random() - .5);
    state.ordenselev_valgte = shufflet.slice(0, 2);
    state.ordenselev_valgte.forEach(e => {
      if (!state.ordenselev_backlog.includes(e)) state.ordenselev_backlog.push(e);
    });
  }
  saveState();
  renderOrdenselev();
}

function trekkUlv() {
  const pool = state.elever.filter(e => !state.ulv_backlog.includes(e));
  if (!pool.length) {
    if (state.elever.length) notify('Alle elever har hatt bamsen — nullstill for å starte på nytt', 'warning');
    else notify('Ingen elever inne', 'error');
    return;
  }
  state.ulv_valgt = pool[Math.floor(Math.random() * pool.length)];
  if (!state.ulv_backlog.includes(state.ulv_valgt)) state.ulv_backlog.push(state.ulv_valgt);
  saveState();
  renderUlv();
  notify(`🐺 ${state.ulv_valgt} får bamsen hjem!`);
}

function renderTilfeldig() {
  const vis = document.getElementById('tilfeldig-vis');
  const bl  = document.getElementById('tilfeldig-backlog-count');
  if (state.tilfeldig_valgt) {
    vis.className   = 'draw-result';
    vis.innerHTML   = `<div class="drawn-name">🙋 ${esc(state.tilfeldig_valgt)}</div>`;
  } else {
    vis.className   = 'draw-placeholder';
    vis.textContent = 'Trykk Trekk for å velge en tilfeldig elev';
  }
  if (state.tilfeldig_backlog.length) {
    bl.className    = 'backlog-count';
    bl.textContent  = `${state.tilfeldig_backlog.length} trukket (backlog)`;
  } else {
    bl.className    = 'backlog-count hidden';
  }
}

function renderOrdenselev() {
  const vis = document.getElementById('ordenselev-vis');
  const bl  = document.getElementById('ordenselev-backlog-count');
  if (state.ordenselev_valgte.length) {
    vis.className = 'draw-result';
    vis.innerHTML = `<div class="draw-pair">
      ${state.ordenselev_valgte.map(n => `<div class="draw-pair-item">⭐ ${esc(n)}</div>`).join('')}
    </div>`;
  } else {
    vis.className   = 'draw-placeholder';
    vis.textContent = 'Trykk Trekk for å velge to ordenselever';
  }
  if (state.ordenselev_backlog.length) {
    bl.className   = 'backlog-count';
    bl.textContent = `${state.ordenselev_backlog.length} i backlog`;
  } else {
    bl.className   = 'backlog-count hidden';
  }
}

function renderUlv() {
  const vis = document.getElementById('ulv-vis');
  const bl  = document.getElementById('ulv-backlog-count');
  if (state.ulv_valgt) {
    vis.className = 'draw-result ulv-result';
    vis.innerHTML = `<div class="drawn-name">🐺 ${esc(state.ulv_valgt)}</div>`;
  } else {
    vis.className   = 'draw-placeholder';
    vis.textContent = 'Trykk Trekk for å velge hvem som får bamsen hjem';
  }
  if (state.ulv_backlog.length) {
    bl.className   = 'backlog-count';
    bl.textContent = `${state.ulv_backlog.length} i backlog`;
  } else {
    bl.className   = 'backlog-count hidden';
  }
}

function renderAlleTrekk() {
  renderTilfeldig();
  renderOrdenselev();
  renderUlv();
}

// ===================== Timer =====================
function timerToggle() {
  if (timerRemaining <= 0) {
    timerRemaining = state.timer_varighet;
    timerRunning   = false;
    clearInterval(timerInterval);
    timerInterval = null;
    renderTimer();
    return;
  }
  if (timerRunning) {
    timerRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;
  } else {
    timerRunning  = true;
    timerInterval = setInterval(timerTick, 1000);
  }
  renderTimer();
}

function timerTick() {
  if (timerRemaining <= 0) {
    timerRunning = false;
    clearInterval(timerInterval);
    timerInterval  = null;
    timerRemaining = 0;
    renderTimer();
    notify('⏰ Tiden er ute!', 'warning');
    spillPip();
    return;
  }
  timerRemaining--;
  renderTimer();
}

function timerReset() {
  timerRunning   = false;
  clearInterval(timerInterval);
  timerInterval  = null;
  timerRemaining = state.timer_varighet;
  renderTimer();
}

function timerSett(minutter) {
  state.timer_varighet = minutter * 60;
  timerRunning         = false;
  clearInterval(timerInterval);
  timerInterval  = null;
  timerRemaining = state.timer_varighet;
  saveState();
  renderTimer();
  notify(`⏱️ Timer satt til ${minutter} min`);
}

function renderTimer() {
  const min = Math.floor(timerRemaining / 60);
  const sek = timerRemaining % 60;
  const tidStr = `${String(min).padStart(2, '0')}:${String(sek).padStart(2, '0')}`;

  const display = document.getElementById('timer-display');
  const bar     = document.getElementById('timer-bar');
  const status  = document.getElementById('timer-status');
  const btnToggle = document.getElementById('btn-timer-toggle');

  display.textContent = tidStr;
  display.className   = timerRunning ? 'running' : (timerRemaining === 0 ? 'ferdig' : '');

  const prosent = state.timer_varighet > 0 ? (timerRemaining / state.timer_varighet) * 100 : 100;
  bar.style.width      = `${prosent}%`;
  bar.style.background = timerRunning ? 'var(--green)' : (timerRemaining === 0 ? 'var(--red)' : 'var(--primary)');

  if (timerRunning) {
    status.textContent = '▶ Kjører';
    status.style.color = 'var(--green)';
    btnToggle.textContent = '⏸ Stopp';
    btnToggle.style.background = 'var(--amber)';
  } else if (timerRemaining === 0) {
    status.textContent = '⏹ Ferdig!';
    status.style.color = 'var(--red)';
    btnToggle.textContent = '↺ Start på nytt';
    btnToggle.style.background = '';
  } else {
    status.textContent = '⏸ Pauset';
    status.style.color = 'var(--muted)';
    btnToggle.textContent = '▶ Start';
    btnToggle.style.background = '';
  }
}

function spillPip() {
  try {
    const ctx  = new AudioContext();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.28, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 1.4);
  } catch (_) {}
}

// ===================== Notat =====================
function autoResizeNotat(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function setupNotat() {
  const ta = document.getElementById('notat-textarea');
  ta.value = state.notat;
  autoResizeNotat(ta);
  let debounce;
  ta.addEventListener('input', () => {
    autoResizeNotat(ta);
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.notat = ta.value;
      saveState();
    }, 500);
  });
}

// ===================== Dagsplan =====================
function leggTilDagsplan(tekst) {
  state.dagsplan.push(tekst);
  saveState();
  renderDagsplan();
}

function fjernDagsplan(idx) {
  state.dagsplan.splice(idx, 1);
  saveState();
  renderDagsplan();
}

function renderDagsplan() {
  const liste = document.getElementById('dagsplan-liste');
  if (!state.dagsplan.length) {
    liste.innerHTML = '<p class="tom-tekst" style="padding:4px">Tom — trykk "+ Legg til punkt"</p>';
    return;
  }
  liste.innerHTML = state.dagsplan.map((p, i) => `
    <div class="dagsplan-item">
      <span>● ${esc(p)}</span>
      <button class="dagsplan-slett" onclick="fjernDagsplan(${i})" title="Fjern">✕</button>
    </div>`).join('');
}

// ===================== Grupper =====================
function lagGrupper(antall) {
  if (state.elever.length < 2) { notify('Trenger minst 2 elever', 'warning'); return; }
  if (antall > state.elever.length) {
    notify(`For mange grupper — bare ${state.elever.length} elever inne`, 'warning');
    return;
  }
  const shufflet = [...state.elever].sort(() => Math.random() - .5);
  const grupper  = Array.from({ length: antall }, () => []);
  shufflet.forEach((e, i) => grupper[i % antall].push(e));
  state.grupper = grupper;
  saveState();
  renderGrupper();
  renderElever();
  const størrelser = grupper.map(g => g.length);
  notify(`🎲 ${antall} grupper (${Math.min(...størrelser)}–${Math.max(...størrelser)} elever)`);
}

function fjernGrupper() {
  state.grupper = null;
  saveState();
  renderGrupper();
  renderElever();
}

function renderGrupper() {
  const vis = document.getElementById('grupper-vis');
  if (!state.grupper) {
    vis.innerHTML = '<p class="tom-tekst">Ingen grupper aktive — trykk <kbd>🎲 Del inn</kbd></p>';
    return;
  }
  vis.innerHTML = state.grupper.map((gruppe, gi) => {
    const f = GRUPPE_FARGER[gi % GRUPPE_FARGER.length];
    return `<div class="gruppe-kort" style="background:${f.bg}">
      <div class="gruppe-tittel" style="color:${f.text}">Gruppe ${gi + 1}</div>
      <div class="gruppe-elever" style="color:${f.text}">${gruppe.map(esc).join(', ')}</div>
    </div>`;
  }).join('');
}

// ===================== Lister =====================
function lagreListe(navn) {
  if (!state.elever.length) { notify('Ingen elever inne å lagre', 'warning'); return false; }
  const erNy = !state.lister[navn];
  state.lister[navn] = [...state.elever];
  saveState();
  notify(`📋 '${navn}' ${erNy ? 'lagret' : 'oppdatert'} (${state.elever.length} elever)`);
  return true;
}

function lastListe(navn) {
  const elever = state.lister[navn];
  if (!elever) return;
  state.elever  = [...elever];
  state.grupper = null;
  saveState();
  renderElever();
  renderAlleTrekk();
  renderGrupper();
  notify(`📋 '${navn}' lastet (${elever.length} elever)`);
}

function slettListe(navn) {
  delete state.lister[navn];
  saveState();
  notify(`🗑️ '${navn}' slettet`);
  renderListerModal();
}

function renderListerModal() {
  const innhold = document.getElementById('lister-innhold');
  const poster  = Object.entries(state.lister);
  if (!poster.length) {
    innhold.innerHTML = '<p class="tom-tekst" style="padding:12px">Ingen lagrede lister ennå.</p>';
    return;
  }
  innhold.innerHTML = `<div class="modal-list">
    ${poster.map(([navn, elever]) => `
      <div class="modal-list-item" onclick="lastListe(${JSON.stringify(navn)});lukkModal()">
        <span>📋 ${esc(navn)}</span>
        <div class="flex gap-2" style="align-items:center">
          <span class="item-meta">${elever.length} elever</span>
          <button class="btn btn-sm" style="background:var(--red-l);color:var(--red);padding:3px 8px"
            onclick="event.stopPropagation();slettListe(${JSON.stringify(navn)})">✕</button>
        </div>
      </div>`).join('')}
  </div>`;
}

// ===================== Layout (drag + span) =====================
function applyLayout() {
  // Forsikre at widget_layout er komplett (for gamle lagrede states)
  const defaults = defaultState().widget_layout;
  defaults.forEach(def => {
    if (!state.widget_layout.find(w => w.id === def.id)) {
      state.widget_layout.push({ ...def });
    }
  });

  const skjult = state.widget_hidden ?? [];
  state.widget_layout.forEach(({ id, col, span }) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (skjult.includes(id)) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    el.style.gridColumn = span > 1 ? `${col} / span ${span}` : String(col);
    // Oppdater span-dots
    const dots = document.getElementById(`span-${id}`);
    if (dots) dots.textContent = ['●○○', '●●○', '●●●'][span - 1] ?? '●○○';
  });
}

function renderWidgetMeny() {
  const dropdown = document.getElementById('widget-dropdown');
  const skjult = state.widget_hidden ?? [];
  dropdown.innerHTML = Object.entries(WIDGET_NAVN).map(([id, navn]) => `
    <label class="widget-meny-rad">
      <input type="checkbox" ${skjult.includes(id) ? '' : 'checked'}
             onchange="toggleWidgetSynlighet('${id}', this.checked)">
      ${navn}
    </label>`).join('');
}

function toggleWidgetSynlighet(id, synlig) {
  const skjult = state.widget_hidden ?? [];
  state.widget_hidden = synlig
    ? skjult.filter(h => h !== id)
    : [...skjult, id];
  saveState();
  applyLayout();
}

function toggleSpan(cardId) {
  const entry = state.widget_layout.find(w => w.id === cardId);
  if (!entry) return;
  entry.span = (entry.span % 3) + 1;
  // Klamp kolonne så vi ikke går utenfor 3-kolonne-grid
  entry.col = Math.min(entry.col, 4 - entry.span);
  saveState();
  applyLayout();
}

function kolonneFraMus(clientX) {
  // Finn faktiske kolonneposisjoner fra kort som er i grid
  const colRanges = {};
  state.widget_layout.forEach(({ id, col, span }) => {
    const el = document.getElementById(id);
    if (!el || el.classList.contains('dragging')) return;
    const rect = el.getBoundingClientRect();
    // Registrer alle kolonner dette kortet okkuperer
    for (let c = col; c < col + span; c++) {
      if (!colRanges[c]) colRanges[c] = { left: Infinity, right: -Infinity };
      colRanges[c].left  = Math.min(colRanges[c].left,  rect.left);
      colRanges[c].right = Math.max(colRanges[c].right, rect.right);
    }
  });

  for (const col of [1, 2, 3]) {
    const r = colRanges[col];
    if (r && clientX >= r.left - 20 && clientX <= r.right + 20) return col;
  }

  // Fallback: del main-bredden i tredjeler
  const mainRect = document.querySelector('main').getBoundingClientRect();
  const relX = clientX - mainRect.left;
  if (relX < mainRect.width * 0.33) return 1;
  if (relX < mainRect.width * 0.67) return 2;
  return 3;
}

function settOppDragOgDrop() {
  const main = document.querySelector('main');
  let dragId = null;

  document.querySelectorAll('.drag-handle').forEach(handle => {
    const card = handle.closest('.card');
    handle.addEventListener('mousedown', () => { card.draggable = true; });
  });

  document.addEventListener('mouseup', () => {
    document.querySelectorAll('main > .card').forEach(c => { c.draggable = false; });
  });

  main.addEventListener('dragstart', e => {
    const card = e.target.closest('.card');
    if (!card || !card.draggable) { e.preventDefault(); return; }
    dragId = card.id;
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', card.id);
    e.dataTransfer.effectAllowed = 'move';
    // Bruk kortet selv som drag-ghost
    e.dataTransfer.setDragImage(card, 20, 20);
    main.classList.add('drag-active');
  });

  main.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  main.addEventListener('drop', e => {
    e.preventDefault();
    if (!dragId) return;
    const nyKolonne = kolonneFraMus(e.clientX);
    const entry = state.widget_layout.find(w => w.id === dragId);
    if (entry && entry.col !== nyKolonne) {
      entry.col = nyKolonne;
      // Klamp span ved behov
      entry.col = Math.min(entry.col, 4 - entry.span);
      saveState();
      applyLayout();
    }
    avsluttDrag();
  });

  main.addEventListener('dragend', () => avsluttDrag());

  function avsluttDrag() {
    if (dragId) {
      const el = document.getElementById(dragId);
      if (el) { el.classList.remove('dragging'); el.draggable = false; }
      dragId = null;
    }
    main.classList.remove('drag-active');
  }
}

// ===================== Reset =====================
function nullstillTilfeldig()   { state.tilfeldig_valgt = null; state.tilfeldig_backlog = []; saveState(); renderTilfeldig(); notify('🎲 Tilfeldig-trekk nullstilt'); }
function nullstillOrdenselev()  { state.ordenselev_valgte = []; state.ordenselev_backlog = []; saveState(); renderOrdenselev(); notify('⭐ Ordenselever-trekk nullstilt'); }
function nullstillUlv()         { state.ulv_valgt = null; state.ulv_backlog = []; saveState(); renderUlv(); notify('🐺 Ulv-trekk nullstilt'); }
function nullstillNotat()       { state.notat = ''; saveState(); document.getElementById('notat-textarea').value = ''; notify('📝 Notat nullstilt'); }
function nullstillDagsplan()    { state.dagsplan = []; saveState(); renderDagsplan(); notify('📋 Dagsplan nullstilt'); }

// ===================== Modals =====================
let aktivModal = null;

function åpneModal(id) {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  aktivModal = id;
  const input = document.querySelector(`#${id} input`);
  if (input) setTimeout(() => input.focus(), 60);
}

function lukkModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  aktivModal = null;
}

function åpneFjernElevModal() {
  const liste = document.getElementById('fjern-elever-liste');
  liste.innerHTML = `
    <div class="checkbox-item checkbox-divider">
      <input type="checkbox" id="cb-toem-alle">
      <label for="cb-toem-alle" style="font-weight:700">Tøm alle</label>
    </div>
    ${state.elever.map((navn, i) => `
      <div class="checkbox-item">
        <input type="checkbox" id="cb-e${i}" data-idx="${i}">
        <label for="cb-e${i}">${esc(navn)}</label>
      </div>`).join('')}`;
  åpneModal('modal-fjern-elever');
}

// ===================== Notifications =====================
function notify(melding, type = 'success') {
  const container = document.getElementById('notif-container');
  const el = document.createElement('div');
  el.className   = `notif ${type}`;
  el.textContent = melding;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ===================== Utils =====================
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inputEnter(inputId, bekreftFn) {
  document.getElementById(inputId).addEventListener('keydown', e => {
    if (e.key === 'Enter')  bekreftFn();
    if (e.key === 'Escape') lukkModal();
  });
}

// ===================== Event setup =====================
function settOppHendelser() {
  // Legg til elev
  document.getElementById('btn-legg-til').onclick = () => {
    document.getElementById('input-elev-navn').value = '';
    åpneModal('modal-legg-til');
  };
  const bekreftLeggTil = () => {
    const navn = document.getElementById('input-elev-navn').value;
    if (leggTilElev(navn)) lukkModal();
  };
  document.getElementById('btn-legg-til-bekreft').onclick = bekreftLeggTil;
  document.getElementById('btn-legg-til-avbryt').onclick  = lukkModal;
  inputEnter('input-elev-navn', bekreftLeggTil);

  // Timer
  document.getElementById('btn-timer-toggle').onclick = timerToggle;
  document.getElementById('btn-timer-reset').onclick  = timerReset;
  document.getElementById('btn-timer-sett').onclick   = () => {
    document.getElementById('input-timer-minutter').value = '';
    åpneModal('modal-timer-sett');
  };
  const bekreftTimerSett = () => {
    const m = parseInt(document.getElementById('input-timer-minutter').value);
    if (m >= 1 && m <= 60) { timerSett(m); lukkModal(); }
    else notify('Skriv inn 1–60 minutter', 'warning');
  };
  document.getElementById('btn-timer-sett-bekreft').onclick = bekreftTimerSett;
  document.getElementById('btn-timer-sett-avbryt').onclick  = lukkModal;
  inputEnter('input-timer-minutter', bekreftTimerSett);

  // Draws
  document.getElementById('btn-tilfeldig').onclick        = trekkTilfeldig;
  document.getElementById('btn-tilfeldig-backlog').onclick = trekkTilfeldigBacklog;
  document.getElementById('btn-ordenselev').onclick       = trekkOrdenselev;
  document.getElementById('btn-ulv').onclick              = trekkUlv;

  // Dagsplan
  document.getElementById('btn-dagsplan-legg-til').onclick = () => {
    document.getElementById('input-dagsplan-punkt').value = '';
    åpneModal('modal-dagsplan');
  };
  const bekreftDagsplan = () => {
    const tekst = document.getElementById('input-dagsplan-punkt').value.trim();
    if (tekst) { leggTilDagsplan(tekst); lukkModal(); }
  };
  document.getElementById('btn-dagsplan-bekreft').onclick = bekreftDagsplan;
  document.getElementById('btn-dagsplan-avbryt').onclick  = lukkModal;
  inputEnter('input-dagsplan-punkt', bekreftDagsplan);

  // Grupper
  document.getElementById('btn-grupper-ny').onclick  = () => {
    document.getElementById('input-grupper-antall').value = '';
    åpneModal('modal-grupper');
  };
  document.getElementById('btn-grupper-fjern').onclick = fjernGrupper;
  const bekreftGrupper = () => {
    const n = parseInt(document.getElementById('input-grupper-antall').value);
    if (n >= 2) { lagGrupper(n); lukkModal(); }
    else notify('Skriv inn minst 2', 'warning');
  };
  document.getElementById('btn-grupper-bekreft').onclick = bekreftGrupper;
  document.getElementById('btn-grupper-avbryt').onclick  = lukkModal;
  inputEnter('input-grupper-antall', bekreftGrupper);

  // Lister
  document.getElementById('btn-lister').onclick = () => {
    renderListerModal();
    åpneModal('modal-lister');
  };
  document.getElementById('btn-lister-lukk').onclick = lukkModal;
  document.getElementById('btn-lister-lagre').onclick = () => {
    if (!state.elever.length) { notify('Ingen elever inne å lagre', 'warning'); return; }
    lukkModal();
    document.getElementById('input-liste-navn').value = '';
    åpneModal('modal-lagre-liste');
  };
  const bekreftLagreListe = () => {
    const navn = document.getElementById('input-liste-navn').value.trim();
    if (navn) { lagreListe(navn); lukkModal(); }
    else notify('Skriv inn et navn', 'warning');
  };
  document.getElementById('btn-lagre-liste-bekreft').onclick = bekreftLagreListe;
  document.getElementById('btn-lagre-liste-avbryt').onclick  = lukkModal;
  inputEnter('input-liste-navn', bekreftLagreListe);

  // Nullstill
  document.getElementById('btn-nullstill').onclick      = () => åpneModal('modal-nullstill');
  document.getElementById('btn-nullstill-lukk').onclick = lukkModal;
  document.getElementById('nullstill-liste').addEventListener('click', e => {
    const item = e.target.closest('[data-action]');
    if (!item) return;
    switch (item.dataset.action) {
      case 'tilfeldig':    nullstillTilfeldig();                          lukkModal(); break;
      case 'ordenselev':   nullstillOrdenselev();                         lukkModal(); break;
      case 'ulv':          nullstillUlv();                                lukkModal(); break;
      case 'grupper':      fjernGrupper(); notify('Grupper nullstilt');   lukkModal(); break;
      case 'timer':        timerReset(); notify('⏱️ Timer nullstilt');    lukkModal(); break;
      case 'notat':        nullstillNotat();                              lukkModal(); break;
      case 'dagsplan':     nullstillDagsplan();                           lukkModal(); break;
      case 'fjern_elever': lukkModal(); åpneFjernElevModal();                         break;
    }
  });

  // Fjern elever
  document.getElementById('btn-fjern-bekreft').onclick = () => {
    const toemAlle = document.getElementById('cb-toem-alle');
    let fjernes;
    if (toemAlle && toemAlle.checked) {
      fjernes = [...state.elever];
    } else {
      fjernes = Array.from(
        document.querySelectorAll('#fjern-elever-liste input[data-idx]:checked')
      ).map(cb => state.elever[parseInt(cb.dataset.idx)]).filter(Boolean);
    }
    if (fjernes.length) {
      fjernEleverBatch(new Set(fjernes));
      notify(`${fjernes.length} elev${fjernes.length > 1 ? 'er' : ''} fjernet`, 'warning');
    }
    lukkModal();
  };
  document.getElementById('btn-fjern-avbryt').onclick = lukkModal;

  // Blackboard
  document.getElementById('btn-blackboard').onclick = () =>
    document.getElementById('blackboard-overlay').classList.remove('hidden');
  document.getElementById('blackboard-overlay').onclick = () =>
    document.getElementById('blackboard-overlay').classList.add('hidden');

  // Widget-synlighetsmeny
  const btnWidgetMeny   = document.getElementById('btn-widget-meny');
  const widgetDropdown  = document.getElementById('widget-dropdown');
  btnWidgetMeny.onclick = e => {
    e.stopPropagation();
    renderWidgetMeny();
    widgetDropdown.classList.toggle('hidden');
  };
  widgetDropdown.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => widgetDropdown.classList.add('hidden'));

  // Lukk modal ved klikk på overlay
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) lukkModal();
  });

  // Globale hurtigtaster
  document.addEventListener('keydown', e => {
    const blackboard = document.getElementById('blackboard-overlay');
    if (!blackboard.classList.contains('hidden')) {
      if (e.key === 'Escape') blackboard.classList.add('hidden');
      return;
    }
    if (aktivModal) {
      if (e.key === 'Escape') lukkModal();
      return;
    }
    const tag = document.activeElement?.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;

    switch (e.key) {
      case 'a': document.getElementById('btn-legg-til').click();        break;
      case 'r': trekkTilfeldig();                                        break;
      case 'R': trekkTilfeldigBacklog();                                 break;
      case 'o': trekkOrdenselev();                                       break;
      case 'u': trekkUlv();                                              break;
      case 't': timerToggle();                                           break;
      case 's': document.getElementById('btn-timer-sett').click();      break;
      case 'd': document.getElementById('btn-dagsplan-legg-til').click();break;
      case 'g': document.getElementById('btn-grupper-ny').click();      break;
      case 'l': document.getElementById('btn-lister').click();          break;
      case 'b': document.getElementById('btn-blackboard').click();      break;
      case 'n': document.getElementById('btn-nullstill').click();       break;
    }
  });
}

// ===================== Init =====================
function init() {
  oppdaterDato();
  hentVær();
  setInterval(oppdaterDato, 60_000);
  setInterval(hentVær,      600_000);

  renderElever();
  renderAlleTrekk();
  renderGrupper();
  renderDagsplan();
  setupNotat();
  renderTimer();
  applyLayout();
  settOppHendelser();
  settOppDragOgDrop();
}

document.addEventListener('DOMContentLoaded', init);
