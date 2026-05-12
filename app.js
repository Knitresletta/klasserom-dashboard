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
  'card-ulv':        'Klassebamse',
  'card-timer':      '⏱ Timer',
  'card-dagsplan':   '📋 Dagsplan',
};

const CONFIG = {
  github_feedback_token: 'ghp_XXXXXXXXXXXXXXXXXXXXXX',
  github_feedback_repo:  'knitresletta/klasserom-web',
};

const VÆR_LAT = 60.33;
const VÆR_LON = 11.22;

function yrEmoji(kode) {
  if (kode.includes('clearsky'))                         return '☀️';
  if (kode.includes('fair'))                             return '🌤️';
  if (kode.includes('partlycloudy'))                     return '⛅';
  if (kode.includes('fog'))                              return '🌫️';
  if (kode.includes('thunder'))                          return '⛈️';
  if (kode.includes('snow'))                             return '❄️';
  if (kode.includes('sleet'))                            return '🌨️';
  if (kode.includes('rain') || kode.includes('drizzle')) return '🌧️';
  return '☁️';
}

const UKEDAGER = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const MÅNEDER  = ['januar', 'februar', 'mars', 'april', 'mai', 'juni',
                  'juli', 'august', 'september', 'oktober', 'november', 'desember'];

// ===================== State =====================
function defaultState() {
  return {
    elever:              [],
    dagsplan:            [],
    ordenselev_backlog:  [],
    ordenselev_valgte:   [],
    ulv_backlog:         [],
    ulv_valgt:           null,
    ulv_navn:            'Klassebamse',
    tilfeldig_backlog:   [],
    tilfeldig_valgt:     null,
    grupper:             null,
    lister:              {},
    timer_varighet:      300,
    tema: 'lyst',
    font: 'system',
    skrift_størrelse: 'normal',
    widget_størrelser: {},
    gruppe_begrensninger: [],
    notater:      { 'notat-1': { tekst: '', kursiv: false } },
    bilder:       { 'bilde-1': { data: null } },
    notat_teller: 1,
    bilde_teller: 1,
    aktiv_side: 0,
    sider: [
      {
        navn: 'Side 1',
        widget_layout: [
          { id: 'card-elever',     col: 1, span: 1 },
          { id: 'card-grupper',    col: 1, span: 1 },
          { id: 'card-tilfeldig',  col: 2, span: 1 },
          { id: 'card-ordenselev', col: 2, span: 1 },
          { id: 'card-ulv',        col: 2, span: 1 },
          { id: 'card-timer',      col: 3, span: 1 },
          { id: 'card-notat-1',    col: 3, span: 1 },
          { id: 'card-dagsplan',   col: 3, span: 1 },
          { id: 'card-bilde-1',    col: 3, span: 1 },
        ],
        widget_hidden: [],
      }
    ],
  };
}

let state = loadState();
let værData = null;

// Timer runtime state (not persisted)
let timerRemaining = state.timer_varighet;
let timerRunning   = false;
let timerInterval  = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const state = Object.assign(defaultState(), JSON.parse(raw));
      if (!state.sider) {
        state.sider = [{
          navn: 'Side 1',
          widget_layout: state.widget_layout ?? defaultState().sider[0].widget_layout,
          widget_hidden: state.widget_hidden ?? [],
        }];
        state.aktiv_side = 0;
        delete state.widget_layout;
        delete state.widget_hidden;
      }
      // Migrer flat notat/bilde-state til flerinstans-struktur
      if (state.notat !== undefined && !state.notater) {
        state.notater = { 'notat-1': { tekst: state.notat || '', kursiv: state.notat_kursiv || false } };
        delete state.notat;
        delete state.notat_kursiv;
      }
      if (state.bilde_data !== undefined && !state.bilder) {
        state.bilder = { 'bilde-1': { data: state.bilde_data || null } };
        delete state.bilde_data;
      }
      if (!state.notat_teller) state.notat_teller = Math.max(...Object.keys(state.notater || {}).map(k => parseInt(k.split('-')[1]) || 0), 0);
      if (!state.bilde_teller) state.bilde_teller = Math.max(...Object.keys(state.bilder  || {}).map(k => parseInt(k.split('-')[1]) || 0), 0);
      // Migrer widget_layout-IDer på alle sider (card-notat → card-notat-1 osv.)
      for (const side of state.sider) {
        side.widget_layout = side.widget_layout.map(w =>
          w.id === 'card-notat' ? { ...w, id: 'card-notat-1' } :
          w.id === 'card-bilde' ? { ...w, id: 'card-bilde-1' } : w
        );
        side.widget_hidden = (side.widget_hidden || []).map(id =>
          id === 'card-notat' ? 'card-notat-1' :
          id === 'card-bilde' ? 'card-bilde-1' : id
        );
      }
      return state;
    }
  } catch (e) {
    console.warn('loadState:', e);
  }
  return defaultState();
}

function aktivSide() {
  return state.sider[state.aktiv_side ?? 0];
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
    const res = await fetch(
      `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${VÆR_LAT}&lon=${VÆR_LON}`,
      { headers: { 'User-Agent': 'klasserom-dashboard/1.0 github.com/Knitresletta/klasserom-dashboard kanadurr@gmail.com' } }
    );
    værData = await res.json();
    const nå    = værData.properties.timeseries[0];
    const temp  = Math.round(nå.data.instant.details.air_temperature);
    const emoji = yrEmoji(nå.data.next_1_hours?.summary.symbol_code ?? 'cloudy');
    document.getElementById('header-ver').textContent = `${emoji} ${temp}°C  Eidsvoll`;
  } catch (_) {}
}

function visVærPopup() {
  if (!værData) return;
  const ts  = værData.properties.timeseries;
  const nå  = ts[0].data.instant.details;

  const timer = ts.slice(0, 8).map(t => ({
    tid:    new Date(t.time).toLocaleTimeString('no', { hour: '2-digit', minute: '2-digit' }),
    temp:   Math.round(t.data.instant.details.air_temperature),
    emoji:  yrEmoji(t.data.next_1_hours?.summary.symbol_code ?? 'cloudy'),
    nedbør: t.data.next_1_hours?.details.precipitation_amount ?? 0,
  }));

  document.getElementById('vær-popup').innerHTML = `
    <div class="vær-nå">
      <div class="vær-rad"><span>Temperatur</span><strong>${Math.round(nå.air_temperature)}°C</strong></div>
      <div class="vær-rad"><span>Vind</span><strong>${Math.round(nå.wind_speed)} m/s</strong></div>
      <div class="vær-rad"><span>Luftfuktighet</span><strong>${Math.round(nå.relative_humidity)}%</strong></div>
      <div class="vær-rad"><span>Lufttrykk</span><strong>${Math.round(nå.air_pressure_at_sea_level)} hPa</strong></div>
    </div>
    <div class="vær-timer">
      ${timer.map(t => `
        <div class="vær-time-kort">
          <span class="vær-time-tid">${t.tid}</span>
          <span class="vær-time-emoji">${t.emoji}</span>
          <span class="vær-time-temp">${t.temp}°</span>
          ${t.nedbør > 0 ? `<span class="vær-time-nedbør">${t.nedbør}mm</span>` : '<span></span>'}
        </div>`).join('')}
    </div>`;
  document.getElementById('vær-popup').classList.toggle('hidden');
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
  oppdaterBegrensningSelecter();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
    const shufflet = shuffle(pool);
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
  notify(`${state.ulv_valgt} tar med ${state.ulv_navn.toLowerCase()} hjem!`);
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
  const vis  = document.getElementById('ulv-vis');
  const bl   = document.getElementById('ulv-backlog-count');
  const navn = state.ulv_navn || 'Klassebamse';
  document.querySelector('#card-ulv h2').textContent = navn;
  document.getElementById('btn-ulv').textContent = `Trekk ${navn.toLowerCase()}`;
  if (state.ulv_valgt) {
    vis.className = 'draw-result ulv-result';
    vis.innerHTML = `<div class="drawn-name">${esc(state.ulv_valgt)}</div>`;
  } else {
    vis.className   = 'draw-placeholder';
    vis.textContent = `Trykk Trekk for å velge hvem som tar med ${navn.toLowerCase()} hjem`;
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

function lagNotatElement(instansId) {
  const div = document.createElement('div');
  div.className = 'card';
  div.id = `card-${instansId}`;
  div.innerHTML = `
    <div class="card-header">
      <span class="drag-handle" title="Dra for å flytte">⠿</span>
      <h2>📝 Notat</h2>
      <div class="card-controls">
        <button class="btn btn-ghost btn-sm btn-icon" id="btn-notat-kursiv-${instansId}" title="Kursiv tekst">𝐼</button>
        <button class="btn-span" onclick="toggleSpan('card-${instansId}')" title="Endre bredde"><span class="span-dots" id="span-card-${instansId}">●○○</span></button>
        <button class="btn btn-ghost btn-sm btn-icon btn-slett" onclick="fjernNotat('${instansId}')" title="Slett notat">✕</button>
      </div>
    </div>
    <textarea id="notat-textarea-${instansId}" placeholder="Skriv notat her…"></textarea>
  `;
  return div;
}

function setupNotat(instansId) {
  const ta = document.getElementById(`notat-textarea-${instansId}`);
  const btnKursiv = document.getElementById(`btn-notat-kursiv-${instansId}`);
  const data = state.notater[instansId];
  ta.value = data.tekst;
  autoResizeNotat(ta);
  ta.classList.toggle('kursiv', !!data.kursiv);
  btnKursiv.classList.toggle('aktiv', !!data.kursiv);
  btnKursiv.onclick = () => {
    state.notater[instansId].kursiv = !state.notater[instansId].kursiv;
    ta.classList.toggle('kursiv', state.notater[instansId].kursiv);
    btnKursiv.classList.toggle('aktiv', state.notater[instansId].kursiv);
    saveState();
  };
  let debounce;
  ta.addEventListener('input', () => {
    autoResizeNotat(ta);
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.notater[instansId].tekst = ta.value;
      saveState();
    }, 500);
  });
}

function leggTilNotat() {
  state.notat_teller++;
  const id = `notat-${state.notat_teller}`;
  state.notater[id] = { tekst: '', kursiv: false };
  const cardId = `card-${id}`;
  aktivSide().widget_layout.push({ id: cardId, col: 1, span: 1 });
  const el = lagNotatElement(id);
  document.querySelector('.col-wrapper[data-col="1"]').appendChild(el);
  setupNotat(id);
  settOppDragOgDrop();
  applyLayout();
  renderWidgetMeny();
  saveState();
}

function fjernNotat(instansId) {
  const cardId = `card-${instansId}`;
  const side = aktivSide();
  side.widget_layout = side.widget_layout.filter(w => w.id !== cardId);
  side.widget_hidden  = (side.widget_hidden ?? []).filter(id => id !== cardId);
  const ingenSiderBrukerDen = state.sider.every(s => !s.widget_layout.some(w => w.id === cardId));
  if (ingenSiderBrukerDen) {
    delete state.notater[instansId];
    document.getElementById(cardId)?.remove();
  }
  renderWidgetMeny();
  saveState();
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
  const begrensninger = state.gruppe_begrensninger ?? [];
  let grupper = null;
  for (let forsøk = 0; forsøk < 200; forsøk++) {
    const shufflet = shuffle(state.elever);
    const kandidat = Array.from({ length: antall }, () => []);
    shufflet.forEach((e, i) => kandidat[i % antall].push(e));
    const ok = begrensninger.every(([a, b]) =>
      !kandidat.some(g => g.includes(a) && g.includes(b))
    );
    if (ok) { grupper = kandidat; break; }
  }
  if (!grupper) {
    notify('Klarte ikke lage grupper uten å bryte begrensningene — prøv færre par eller flere grupper', 'warning');
    return;
  }
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
  const defaults = defaultState().sider[0].widget_layout;
  defaults.forEach(def => {
    if (!aktivSide().widget_layout.find(w => w.id === def.id)) {
      aktivSide().widget_layout.push({ ...def });
    }
  });

  const skjult = aktivSide().widget_hidden ?? [];
  aktivSide().widget_layout.forEach(({ id, col, span }) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (skjult.includes(id)) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.gridColumn = '';
    const dots = document.getElementById(`span-${id}`);
    if (dots) dots.textContent = ['●○○', '●●○', '●●●'][span - 1] ?? '●○○';
    const wrapper = document.querySelector(`.col-wrapper[data-col="${col}"]`);
    if (wrapper) wrapper.appendChild(el);
  });

  const aktivIds = new Set(aktivSide().widget_layout.map(w => w.id));
  document.querySelectorAll('[id^="card-notat-"], [id^="card-bilde-"]').forEach(el => {
    if (!aktivIds.has(el.id)) el.style.display = 'none';
  });
}

function renderWidgetMeny() {
  const dropdown = document.getElementById('widget-dropdown');
  const skjult = aktivSide().widget_hidden ?? [];

  const statiske = Object.entries(WIDGET_NAVN).map(([id, navn]) => `
    <label class="widget-meny-rad">
      <input type="checkbox" ${skjult.includes(id) ? '' : 'checked'}
             onchange="toggleWidgetSynlighet('${id}', this.checked)">
      ${navn}
    </label>`).join('');

  const aktivIds = aktivSide().widget_layout.map(w => w.id);
  const notatRader = Object.keys(state.notater)
    .filter(id => aktivIds.includes(`card-${id}`))
    .map(instansId => {
      const cardId = `card-${instansId}`;
      return `<label class="widget-meny-rad">
      <input type="checkbox" ${skjult.includes(cardId) ? '' : 'checked'}
             onchange="toggleWidgetSynlighet('${cardId}', this.checked)">
      📝 Notat
    </label>`;
    }).join('');

  const bildeRader = Object.keys(state.bilder)
    .filter(id => aktivIds.includes(`card-${id}`))
    .map(instansId => {
      const cardId = `card-${instansId}`;
      return `<label class="widget-meny-rad">
      <input type="checkbox" ${skjult.includes(cardId) ? '' : 'checked'}
             onchange="toggleWidgetSynlighet('${cardId}', this.checked)">
      🖼 Bilde
    </label>`;
    }).join('');

  const leggTilKnapper = `
    <div class="widget-meny-rad" style="gap:4px;flex-wrap:wrap;margin-top:4px">
      <button class="btn btn-ghost btn-sm" onclick="leggTilNotat()">+ Notat</button>
      <button class="btn btn-ghost btn-sm" onclick="leggTilBilde()">+ Bilde</button>
    </div>`;

  dropdown.innerHTML = statiske + notatRader + bildeRader + leggTilKnapper;
}

function toggleWidgetSynlighet(id, synlig) {
  const skjult = aktivSide().widget_hidden ?? [];
  aktivSide().widget_hidden = synlig
    ? skjult.filter(h => h !== id)
    : [...skjult, id];
  saveState();
  applyLayout();
}

function toggleSpan(cardId) {
  const entry = aktivSide().widget_layout.find(w => w.id === cardId);
  if (!entry) return;
  entry.span = (entry.span % 3) + 1;
  // Klamp kolonne så vi ikke går utenfor 3-kolonne-grid
  entry.col = Math.min(entry.col, 4 - entry.span);
  saveState();
  applyLayout();
}

function kolonneFraMus(clientX) {
  const wrappers = document.querySelectorAll('.col-wrapper');
  for (const w of wrappers) {
    const rect = w.getBoundingClientRect();
    if (clientX <= rect.right) return Number(w.dataset.col);
  }
  return 3;
}

function posisjonFraMus(clientY, dragId, nyKolonne) {
  let insertAt = aktivSide().widget_layout.length;
  for (let i = 0; i < aktivSide().widget_layout.length; i++) {
    const { id, col } = aktivSide().widget_layout[i];
    if (col !== nyKolonne || id === dragId) continue;
    const el = document.getElementById(id);
    if (!el || el.style.display === 'none') continue;
    const rect = el.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) { insertAt = i; break; }
  }
  return insertAt;
}

function settOppDragOgDrop() {
  const main = document.querySelector('main');
  let dragId = null;
  let indikatorEl = null;

  document.querySelectorAll('.drag-handle').forEach(handle => {
    const card = handle.closest('.card');
    handle.addEventListener('mousedown', () => { card.draggable = true; });
  });

  document.addEventListener('mouseup', () => {
    document.querySelectorAll('.col-wrapper > .card').forEach(c => { c.draggable = false; });
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
    if (!dragId) return;

    const nyKolonne = kolonneFraMus(e.clientX);

    if (!indikatorEl) {
      indikatorEl = document.createElement('div');
      indikatorEl.className = 'drop-indikator';
    }

    const wrapper = document.querySelector(`.col-wrapper[data-col="${nyKolonne}"]`);
    const kortsIKol = aktivSide().widget_layout
      .filter(w => w.col === nyKolonne && w.id !== dragId)
      .map(w => document.getElementById(w.id))
      .filter(Boolean);

    const referanse = kortsIKol.find(el => {
      const rect = el.getBoundingClientRect();
      return e.clientY < rect.top + rect.height / 2;
    }) ?? null;

    if (referanse) wrapper.insertBefore(indikatorEl, referanse);
    else wrapper.appendChild(indikatorEl);
  });

  main.addEventListener('drop', e => {
    e.preventDefault();
    if (!dragId) return;

    const nyKolonne = kolonneFraMus(e.clientX);
    let nyIndeks    = posisjonFraMus(e.clientY, dragId, nyKolonne);

    const gammelIndeks = aktivSide().widget_layout.findIndex(w => w.id === dragId);
    const entry = { ...aktivSide().widget_layout[gammelIndeks] };
    entry.col = nyKolonne;

    aktivSide().widget_layout.splice(gammelIndeks, 1);
    if (nyIndeks > gammelIndeks) nyIndeks--;
    aktivSide().widget_layout.splice(nyIndeks, 0, entry);

    saveState();
    applyLayout();
    avsluttDrag();
  });

  main.addEventListener('dragend', () => avsluttDrag());

  function avsluttDrag() {
    if (dragId) {
      const el = document.getElementById(dragId);
      if (el) { el.classList.remove('dragging'); el.draggable = false; }
      dragId = null;
    }
    if (indikatorEl) { indikatorEl.remove(); indikatorEl = null; }
    main.classList.remove('drag-active');
  }
}

// ===================== Sider =====================
function renderSiderNav() {
  const nav = document.getElementById('sider-nav');
  if (!nav) return;
  nav.innerHTML = '';
  state.sider.forEach((side, idx) => {
    const btn = document.createElement('button');
    btn.className = 'side-tab' + (idx === state.aktiv_side ? ' aktiv' : '');
    btn.textContent = side.navn;
    btn.onclick = () => byttSide(idx);
    if (state.sider.length > 1) {
      const x = document.createElement('span');
      x.className = 'side-slett';
      x.textContent = '✕';
      x.onclick = e => { e.stopPropagation(); fjernSide(idx); };
      btn.appendChild(x);
    }
    nav.appendChild(btn);
  });
  const leggTil = document.createElement('button');
  leggTil.className = 'side-legg-til';
  leggTil.textContent = '+';
  leggTil.title = 'Legg til side';
  leggTil.onclick = leggTilSide;
  nav.appendChild(leggTil);
}

function byttSide(idx) {
  state.aktiv_side = idx;
  saveState();
  applyLayout();
  renderWidgetMeny();
  renderSiderNav();
}

function leggTilSide() {
  const nr = state.sider.length + 1;
  state.sider.push({
    navn: `Side ${nr}`,
    widget_layout: defaultState().sider[0].widget_layout.map(w => ({ ...w })),
    widget_hidden: [],
  });
  byttSide(state.sider.length - 1);
}

function fjernSide(idx) {
  if (state.sider.length <= 1) return;
  state.sider.splice(idx, 1);
  state.aktiv_side = Math.min(state.aktiv_side, state.sider.length - 1);
  saveState();
  applyLayout();
  renderWidgetMeny();
  renderSiderNav();
}

// ===================== Reset =====================
function nullstillTilfeldig()   { state.tilfeldig_valgt = null; state.tilfeldig_backlog = []; saveState(); renderTilfeldig(); notify('🎲 Tilfeldig-trekk nullstilt'); }
function nullstillOrdenselev()  { state.ordenselev_valgte = []; state.ordenselev_backlog = []; saveState(); renderOrdenselev(); notify('⭐ Ordenselever-trekk nullstilt'); }
function nullstillUlv()         { state.ulv_valgt = null; state.ulv_backlog = []; saveState(); renderUlv(); notify('🐺 Ulv-trekk nullstilt'); }
function nullstillNotat() {
  for (const instansId of Object.keys(state.notater)) {
    state.notater[instansId].tekst = '';
    const ta = document.getElementById(`notat-textarea-${instansId}`);
    if (ta) { ta.value = ''; autoResizeNotat(ta); }
  }
  saveState();
  notify('📝 Notat nullstilt');
}
function nullstillDagsplan()    { state.dagsplan = []; saveState(); renderDagsplan(); notify('📋 Dagsplan nullstilt'); }

// ===================== Info modal =====================
const OPPDATERINGSLOGG_HTML = `
  <div class="logg-entry">
    <div class="logg-versjon">v2.2</div>
    <div class="logg-dato">12. mai 2026</div>
    <ul>
      <li>Fikset: elever som fjernes fra listen forsvinner nå korrekt fra alle backlogs (ordenselev, klassebamse, tilfeldig)</li>
      <li>Fikset: grupper-trekk bruker nå riktig tilfeldig fordeling — tidligere var fordelingen statistisk skjevt mot visse kombinasjoner</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v2.1</div>
    <div class="logg-dato">12. mai 2026</div>
    <ul>
      <li>Notat- og bilde-widgets er nå per side — legg til et notat på side 1 uten at det dukker opp på side 2</li>
      <li>Fjerner du et notat/bilde-kort på én side, forsvinner det bare der — de andre sidene er upåvirket</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v2.0</div>
    <div class="logg-dato">10. mai 2026</div>
    <ul>
      <li>Flerinstans-notat: legg til så mange notatkort du vil via widget-menyen (+ Notat)</li>
      <li>Flerinstans-bilde: legg til så mange bildekort du vil via widget-menyen (+ Bilde)</li>
      <li>Hvert notat og bilde kan slettes individuelt med ✕-knappen i kortets header</li>
      <li>Alle instanser huskes etter reload og vises på alle sider</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v1.9</div>
    <div class="logg-dato">8. mai 2026</div>
    <ul>
      <li>Ny funksjon: Sider — lag flere dashboard-sider med ulike widget-oppsett (midten av headeren)</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v1.8</div>
    <div class="logg-dato">8. mai 2026</div>
    <ul>
      <li>Fikset: widgets forsvant etter drag-and-drop</li>
      <li>Fikset: backlogs ble slettet når elever ble fjernet — backlogs lever nå uavhengig av elevlisten</li>
      <li>Ny funksjon: Gruppebegrensning — legg inn navnepar som aldri skal havne i samme gruppe (⛔ Par)</li>
      <li>Ny widget: Bilde — last opp bilde fra disk eller lim inn fra utklippstavle</li>
      <li>Ny funksjon: Send tilbakemelding direkte til utvikler fra menyen</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v1.7</div>
    <div class="logg-dato">8. mai 2026</div>
    <ul>
      <li>Kolonnene stables nå helt uavhengig av hverandre — et høyt kort i kol 2 blokkerer ikke lenger kol 1 og 3</li>
      <li>Ny breddefordeling: 30% / 40% / 30%</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v1.6</div>
    <div class="logg-dato">8. mai 2026</div>
    <ul>
      <li>Full DnD-frihet: alle widgets kan nå plasseres i hvilken som helst rekkefølge og kolonne</li>
      <li>Visuell drop-indikator viser nøyaktig hvor widgeten plasseres</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v1.5</div>
    <div class="logg-dato">7. mai 2026</div>
    <ul>
      <li>Backlog-editor for ordenselev og klassebamse: klikk 📝 for å markere hvem som allerede er brukt</li>
      <li>Widgeten "Ulv" heter nå "Klassebamse" som standard</li>
      <li>Tilpassbart bamse-navn: klikk ✏️ i Klassebamse-kortet for å gi bamsen et eget navn</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v1.4</div>
    <div class="logg-dato">7. mai 2026</div>
    <ul>
      <li>Tema-velger med hover-sub-meny: 3 standard + 8 eventyr/digital-temaer</li>
      <li>Fontvelger med 6 Google Fonts (Victor Mono, Inter, Nunito, m.fl.)</li>
      <li>Kursiv-toggle i Notat-kortet</li>
      <li>Global skriftstørrelse (Liten / Normal / Stor / Ekstra stor)</li>
      <li>Per-widget skriftstørrelse med S/M/L/XL-knapper</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v1.3</div>
    <div class="logg-dato">7. mai 2026</div>
    <ul>
      <li>Vær-popup med detaljer og timesforecast fra Yr.no</li>
      <li>Klasserom-meny med oppdateringslogg og brukerveiledning</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v1.2</div>
    <div class="logg-dato">7. mai 2026</div>
    <ul>
      <li>Widget-synlighetsmeny — skjul/vis kort fra headeren</li>
      <li>Elevliste ekspanderer automatisk uten scrollbar</li>
      <li>Notat-felt vokser med innholdet</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v1.1</div>
    <div class="logg-dato">7. mai 2026</div>
    <ul>
      <li>Dra-og-slipp for å flytte widgets til valgfri kolonne</li>
      <li>Span-knapp for å strekke et kort over 2–3 kolonner</li>
      <li>Layout lagres og gjenopprettes automatisk</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v1.0</div>
    <div class="logg-dato">7. mai 2026</div>
    <ul>
      <li>Elevliste med legg til/fjern og lagrede lister</li>
      <li>Tilfeldig-trekk, ordenselever og ulv — alle med backlog</li>
      <li>Nedtellingstimer med lyd</li>
      <li>Notat og dagsplan</li>
      <li>Tilfeldig gruppeinndeling</li>
      <li>Tavlemodus (svart skjerm)</li>
    </ul>
  </div>`;

const BRUKERVEILEDNING_HTML = `
  <h4>Sider</h4>
  <p>Klikk <strong>+</strong> i midten av headeren for å legge til en ny side. Klikk på et sidenavn for å bytte side. Klikk <strong>✕</strong> på en fane for å slette siden. Elever og andre data er delt mellom alle sider — widget-oppsettet, notater og bilder er per side.</p>

  <h4>Kom i gang</h4>
  <p>Trykk <strong>+ Legg til elev</strong> (eller tasten <kbd>a</kbd>) for å legge inn elevene i klassen din. Du kan ha opptil 35 elever inne samtidig.</p>
  <p>Vil du spare tid neste gang? Lagre elevlisten din under <strong>📋 Lister</strong>, og last den inn igjen med ett klikk.</p>

  <h4>Trekke elever</h4>
  <p><strong>🎲 Tilfeldig elev</strong> — trykk <strong>Trekk</strong> for å velge en tilfeldig elev fra listen. Vanlig trekk unngår å velge samme elev to ganger på rad.</p>
  <p><strong>Trekk (bl)</strong> — trekker uten repetisjon (backlog). Hver elev trekkes én gang før noen trekkes på nytt. Antall trukket vises under knappen.</p>
  <p><strong>⭐ Ordenselever</strong> — velger to elever som har ordenselev-ansvar. Bruker også backlog, slik at alle rekker å ha vært ordenselev før noen gjentas.</p>
  <p><strong>Klassebamse</strong> — velger hvem som får bamsen (eller en annen gjenstand) med hjem. Også med backlog.</p>
  <p>Vil du nullstille en backlog? Trykk <strong>⚙️ Nullstill…</strong> nederst til venstre.</p>

  <h4>📝 Redigere backlog for ordenselev / klassebamse</h4>
  <p>Trykk på blyant-ikonet (📝) i kortets hjørne. Du ser alle elevene som chips — grå chips er allerede «brukt». Trykk på en elev for å sette eller fjerne «brukt»-markeringen. Nyttig hvis du har mistet lokal data og trenger å rekonstruere hvem som har vært ordenselev eller hatt med bamsen.</p>

  <h4>✏️ Gi klassebamsen et eget navn</h4>
  <p>Trykk på blyant-ikonet (✏️) i Klassebamse-kortets hjørne, skriv inn det nye navnet og trykk Lagre. Navnet huskes selv etter at du lukker nettleseren.</p>

  <h4>Grupper</h4>
  <p>Trykk <strong>🎲 Del inn</strong> i Grupper-kortet (eller tasten <kbd>g</kbd>). Skriv inn antall grupper, og elevene fordeles tilfeldig. Gruppefarger vises også i elevlisten. Trykk <strong>✕</strong> for å fjerne gruppeinndelingen.</p>

  <h4>⛔ Gruppebegrensning</h4>
  <p>Klikk <strong>⛔ Par</strong> i Grupper-kortets hjørne for å åpne begrensningslisten. Velg to elever fra nedtrekksmenyene og klikk <strong>Legg til</strong>. Paret vil aldri havne i samme gruppe. Du kan legge til så mange par du vil. Fjern et par ved å klikke <strong>✕</strong> ved siden av det.</p>

  <h4>Timer</h4>
  <p>Standard er 5 minutter. Trykk <strong>Sett tid</strong> (eller <kbd>s</kbd>) for å velge en annen varighet (1–60 min). Start og stopp med <strong>▶ Start</strong> (eller <kbd>t</kbd>). En lyd spilles av når tiden er ute.</p>

  <h4>Notat</h4>
  <p>Et fritekst-felt som vokser automatisk med innholdet. Lagres automatisk i nettleseren — du mister ikke notatet ved omlasting.</p>
  <p>Du kan ha <strong>flere notatkort</strong>: åpne <strong>⊞ Widgets</strong>-menyen og klikk <strong>+ Notat</strong>. Hvert notat kan flyttes og strekkes uavhengig av de andre. Slett et notat med <strong>✕</strong>-knappen i kortets overskrift. Notater er per side — side 1 og side 2 kan ha helt forskjellige notatkort.</p>

  <h4>Dagsplan</h4>
  <p>Legg til punkter med <strong>+ Legg til punkt</strong> (eller <kbd>d</kbd>). Fjern enkeltpunkter med <strong>✕</strong> ved siden av hvert punkt.</p>

  <h4>🖼 Bilde-widget</h4>
  <p>Klikk på bilde-kortet for å velge en bildefil fra datamaskinen (maks 2 MB). Du kan også lime inn et bilde direkte med <kbd>Ctrl+V</kbd> (f.eks. et skjermbilde) — klikk først på kortet du vil lime inn i. Bildet lagres i nettleseren og vises igjen ved neste besøk. Trykk <strong>Fjern bilde</strong> for å slette bildeinnholdet.</p>
  <p>Du kan ha <strong>flere bildekort</strong>: åpne <strong>⊞ Widgets</strong>-menyen og klikk <strong>+ Bilde</strong>. Slett et bildekort med <strong>✕</strong>-knappen i kortets overskrift. Bildekort er per side — forskjellige sider kan ha forskjellige bilder.</p>

  <h4>Tilpasse layouten</h4>
  <p>Dra et kort til en annen kolonne ved å holde inne dra-håndtaket <strong>⠿</strong> (dukker opp når du holder musen over kortet). Trykk på <strong>●○○</strong>-knappen for å strekke et kort over 2 eller 3 kolonner. Layouten huskes automatisk.</p>
  <p>Vil du skjule et kort du ikke bruker? Trykk <strong>⊞ Widgets</strong> øverst til høyre og fjern avhukingen.</p>

  <h4>Tema</h4>
  <p>Åpne <strong>Klasserom-menyen</strong> (tannhjulet øverst til venstre) og hold musen over <strong>🎨 Tema</strong>. Velg blant tre standardtemaer (Lyst, Mørkt, Høy kontrast) eller åtte kreative temaer: Under vann, På fjellet, I skogen, I en vulkan, I eventyrland, Matrix, Cyberspace og Equestria. Temaet lagres automatisk.</p>

  <h4>Font</h4>
  <p>Hold musen over <strong>🔤 Font</strong> i Klasserom-menyen. Velg blant systemstandard og seks Google Fonts — inkludert <em>Victor Mono</em> (monospace), <em>Caveat</em> (håndskrevet) og <em>Playfair Display</em> (serif). Fonten lastes dynamisk og lagres til neste gang.</p>

  <h4>Skriftstørrelse</h4>
  <p>Hold musen over <strong>📏 Skriftstørrelse</strong> i Klasserom-menyen. Under <strong>Alle widgets</strong> setter du global størrelse (Liten 12px → Ekstra stor 19px). Under <strong>Enkelt widget</strong> kan du justere hvert kort individuelt med S/M/L/XL-knapper uten å lukke menyen.</p>

  <h4>Kursiv tekst i Notat</h4>
  <p>Trykk <strong><em>𝐼</em></strong>-knappen øverst i Notat-kortet for å slå kursiv tekst av og på. Innstillingen lagres automatisk.</p>

  <h4>Tavlemodus</h4>
  <p>Trykk <strong>🖥 Tavle</strong> (eller <kbd>b</kbd>) for en helt svart skjerm — nyttig når du vil fokusere elevoppmerksomheten. Klikk hvor som helst eller trykk <kbd>Esc</kbd> for å avslutte.</p>

  <h4>Tastatursnarveger</h4>
  <ul>
    <li><kbd>a</kbd> — Legg til elev</li>
    <li><kbd>r</kbd> — Trekk tilfeldig elev</li>
    <li><kbd>R</kbd> — Trekk tilfeldig (backlog)</li>
    <li><kbd>o</kbd> — Trekk ordenselever</li>
    <li><kbd>u</kbd> — Trekk ulv</li>
    <li><kbd>t</kbd> — Start/stopp timer</li>
    <li><kbd>s</kbd> — Sett timer-tid</li>
    <li><kbd>g</kbd> — Del inn i grupper</li>
    <li><kbd>d</kbd> — Legg til dagsplan-punkt</li>
    <li><kbd>l</kbd> — Vis klasselister</li>
    <li><kbd>b</kbd> — Tavlemodus</li>
    <li><kbd>n</kbd> — Nullstill…</li>
    <li><kbd>Esc</kbd> — Lukk åpne vinduer</li>
  </ul>

  <h4>💬 Send tilbakemelding</h4>
  <p>Klikk <strong>💬 Tilbakemelding</strong> i Klasserom-menyen (tannhjulet øverst til venstre). Velg type (feil, ønsket funksjon eller annet), skriv en kort beskrivelse og klikk <strong>Send</strong>. Tilbakemeldingen sendes direkte til utvikleren.</p>

  <h4>Lagring</h4>
  <p>Alt lagres automatisk i nettleseren din (localStorage). Ingenting sendes til internett — data er kun på din maskin. Ulike nettlesere eller private vinduer har separate lagre.</p>`;

function åpneInfoModal(tittel, innholdHtml) {
  document.getElementById('info-modal-tittel').textContent = tittel;
  document.getElementById('info-modal-innhold').innerHTML = innholdHtml;
  document.getElementById('info-overlay').classList.remove('hidden');
}

function lukkInfoModal() {
  document.getElementById('info-overlay').classList.add('hidden');
}

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

// ===================== Tema =====================
function settTema(tema) {
  state.tema = tema;
  document.documentElement.setAttribute('data-theme', tema);
  saveState();
  document.querySelectorAll('.tema-valg').forEach(el => {
    el.classList.toggle('aktiv', el.dataset.tema === tema);
  });
}

// ===================== Font =====================
const FONTER = {
  'system':      { css: 'system-ui,-apple-system,"Segoe UI",sans-serif', url: null },
  'victor-mono': { css: '"Victor Mono",monospace', url: 'https://fonts.googleapis.com/css2?family=Victor+Mono:ital,wght@0,400;0,700;1,400&display=swap' },
  'inter':       { css: '"Inter",sans-serif', url: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap' },
  'nunito':      { css: '"Nunito",sans-serif', url: 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;700&display=swap' },
  'roboto-slab': { css: '"Roboto Slab",serif', url: 'https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@400;700&display=swap' },
  'playfair':    { css: '"Playfair Display",serif', url: 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap' },
  'caveat':      { css: '"Caveat",cursive', url: 'https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&display=swap' },
};

function settFont(fontKey) {
  const f = FONTER[fontKey] ?? FONTER['system'];
  if (f.url && !document.querySelector(`link[data-font="${fontKey}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = f.url; link.dataset.font = fontKey;
    document.head.appendChild(link);
  }
  document.documentElement.style.setProperty('--font', f.css);
  state.font = fontKey;
  saveState();
  document.querySelectorAll('.font-valg').forEach(el => {
    el.classList.toggle('aktiv', el.dataset.font === fontKey);
  });
}

const STØRRELSER = {
  'liten':  '12px',
  'normal': '14px',
  'stor':   '16px',
  'xl':     '19px',
};

function settSkriftstørrelse(key) {
  const px = STØRRELSER[key] ?? STØRRELSER['normal'];
  document.documentElement.style.setProperty('--font-size', px);
  state.skrift_størrelse = key;
  saveState();
  document.querySelectorAll('.størrelse-valg').forEach(el => {
    el.classList.toggle('aktiv', el.dataset.størrelse === key);
  });
}

function settWidgetSkriftstørrelse(widgetId, key) {
  const card = document.getElementById(widgetId);
  if (!card) return;
  const px = STØRRELSER[key] ?? null;
  card.style.fontSize = px ?? '';
  if (!state.widget_størrelser) state.widget_størrelser = {};
  if (key === 'normal') {
    delete state.widget_størrelser[widgetId];
  } else {
    state.widget_størrelser[widgetId] = key;
  }
  saveState();
  document.querySelectorAll(`.widget-str-valg[data-widget="${widgetId}"]`).forEach(btn => {
    btn.classList.toggle('aktiv', btn.dataset.størrelse === key);
  });
}

function applyWidgetStørrelser() {
  const map = state.widget_størrelser ?? {};
  Object.entries(map).forEach(([id, key]) => settWidgetSkriftstørrelse(id, key));
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

  // Backlog-editor
  document.getElementById('btn-rediger-ordenselev').onclick = () => åpneRedigerBacklog('ordenselev');
  document.getElementById('btn-rediger-ulv').onclick        = () => åpneRedigerBacklog('ulv');
  document.getElementById('btn-rediger-backlog-lukk').onclick = lukkModal;

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

  // Klasserom-meny
  const btnKlasserom  = document.getElementById('btn-klasserom-meny');
  const klasseromDrop = document.getElementById('klasserom-dropdown');
  btnKlasserom.onclick = e => {
    e.stopPropagation();
    klasseromDrop.classList.toggle('hidden');
  };
  klasseromDrop.addEventListener('click', e => e.stopPropagation());
  document.getElementById('btn-åpne-logg').onclick  = () => {
    klasseromDrop.classList.add('hidden');
    åpneInfoModal('📋 Oppdateringslogg', OPPDATERINGSLOGG_HTML);
  };
  document.getElementById('btn-åpne-guide').onclick = () => {
    klasseromDrop.classList.add('hidden');
    åpneInfoModal('❓ Brukerveiledning', BRUKERVEILEDNING_HTML);
  };
  document.querySelectorAll('.tema-valg').forEach(el => {
    el.onclick = () => {
      settTema(el.dataset.tema);
      klasseromDrop.classList.add('hidden');
    };
  });
  document.querySelectorAll('.font-valg').forEach(el => {
    el.onclick = () => {
      settFont(el.dataset.font);
      klasseromDrop.classList.add('hidden');
    };
  });
  document.querySelectorAll('.størrelse-valg').forEach(el => {
    el.onclick = () => {
      settSkriftstørrelse(el.dataset.størrelse);
      klasseromDrop.classList.add('hidden');
    };
  });
  document.querySelectorAll('.widget-str-valg').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      settWidgetSkriftstørrelse(btn.dataset.widget, btn.dataset.størrelse);
    };
  });

  // Info-modal lukk
  document.getElementById('btn-info-lukk').onclick = lukkInfoModal;
  document.getElementById('info-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('info-overlay')) lukkInfoModal();
  });

  // Vær-popup
  document.getElementById('header-ver').onclick = e => {
    e.stopPropagation();
    visVærPopup();
  };
  document.getElementById('vær-popup').addEventListener('click', e => e.stopPropagation());

  // Lukk alle dropdowns ved klikk utenfor
  document.addEventListener('click', () => {
    widgetDropdown.classList.add('hidden');
    klasseromDrop.classList.add('hidden');
    document.getElementById('vær-popup').classList.add('hidden');
  });

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
    if (!document.getElementById('info-overlay').classList.contains('hidden')) {
      if (e.key === 'Escape') lukkInfoModal();
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
// ===================== Rename Klassebamse =====================
function settOppRename() {
  document.getElementById('btn-ulv-rename').onclick = () => {
    document.getElementById('rename-input').value = state.ulv_navn || 'Klassebamse';
    åpneModal('modal-ulv-rename');
  };
  document.getElementById('btn-rename-avbryt').onclick = lukkModal;
  document.getElementById('btn-rename-lagre').onclick = () => {
    const nyttNavn = document.getElementById('rename-input').value.trim();
    if (nyttNavn) {
      state.ulv_navn = nyttNavn;
      saveState();
      renderUlv();
    }
    lukkModal();
  };
  inputEnter('rename-input', () => document.getElementById('btn-rename-lagre').click());
}

// ===================== Backlog-editor =====================
function åpneRedigerBacklog(type) {
  const erOrden   = type === 'ordenselev';
  const backlogKey = erOrden ? 'ordenselev_backlog' : 'ulv_backlog';
  const tittel     = erOrden ? 'Rediger ordenselev-backlog' : `Rediger ${state.ulv_navn || 'Klassebamse'}-backlog`;

  document.getElementById('rediger-backlog-tittel').textContent = tittel;

  const chips = document.getElementById('rediger-backlog-chips');
  chips.innerHTML = '';
  (state.elever || []).forEach(navn => {
    const erBrukt = state[backlogKey].includes(navn);
    const chip = document.createElement('div');
    chip.className = 'chip' + (erBrukt ? ' brukt' : '');
    chip.textContent = navn;
    chip.onclick = () => {
      if (state[backlogKey].includes(navn)) {
        state[backlogKey] = state[backlogKey].filter(n => n !== navn);
        chip.classList.remove('brukt');
      } else {
        state[backlogKey].push(navn);
        chip.classList.add('brukt');
      }
      saveState();
      if (erOrden) renderOrdenselev(); else renderUlv();
    };
    chips.appendChild(chip);
  });

  åpneModal('modal-rediger-backlog');
}

// ===================== Bilde-widget =====================
let fokusertBildeId = null;

function lagBildeElement(instansId) {
  const div = document.createElement('div');
  div.className = 'card';
  div.id = `card-${instansId}`;
  div.innerHTML = `
    <div class="card-header">
      <span class="drag-handle" title="Dra for å flytte">⠿</span>
      <h2>🖼 Bilde</h2>
      <div class="card-controls">
        <button class="btn-span" onclick="toggleSpan('card-${instansId}')" title="Endre bredde"><span class="span-dots" id="span-card-${instansId}">●○○</span></button>
        <button class="btn btn-ghost btn-sm btn-icon btn-slett" onclick="fjernBildeWidget('${instansId}')" title="Slett bilde-widget">✕</button>
      </div>
    </div>
    <div class="card-body">
      <div id="bilde-vis-${instansId}" class="bilde-vis">
        <label id="bilde-label-${instansId}" class="bilde-slipp">
          <span>Klikk for å laste opp, eller lim inn (Ctrl+V)</span>
          <input type="file" id="bilde-fil-${instansId}" accept="image/*" style="display:none" onchange="lastOppBilde(this, '${instansId}')">
        </label>
        <img id="bilde-img-${instansId}" style="display:none; max-width:100%; border-radius:6px" alt="">
        <button id="bilde-fjern-${instansId}" style="display:none" onclick="fjernBildeData('${instansId}')">Fjern bilde</button>
      </div>
    </div>
  `;
  return div;
}

function setupBilde(instansId) {
  document.getElementById(`card-${instansId}`)?.addEventListener('click', () => {
    fokusertBildeId = instansId;
  });
  renderBilde(instansId);
}

function renderBilde(instansId) {
  const img    = document.getElementById(`bilde-img-${instansId}`);
  const label  = document.getElementById(`bilde-label-${instansId}`);
  const fjernK = document.getElementById(`bilde-fjern-${instansId}`);
  if (!img) return;
  const data = state.bilder[instansId]?.data;
  if (data) {
    img.src = data;
    img.style.display = '';
    label.style.display = 'none';
    fjernK.style.display = '';
  } else {
    img.style.display = 'none';
    label.style.display = '';
    fjernK.style.display = 'none';
  }
}

function lastOppBilde(input, instansId) {
  const fil = input.files?.[0];
  if (fil) lesBildefil(fil, instansId);
}

function lesBildefil(fil, instansId) {
  if (fil.size > 2 * 1024 * 1024) {
    notify('Bildet er for stort — maks 2 MB', 'warning');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    state.bilder[instansId].data = e.target.result;
    saveState();
    renderBilde(instansId);
  };
  reader.readAsDataURL(fil);
}

function fjernBildeData(instansId) {
  state.bilder[instansId].data = null;
  saveState();
  renderBilde(instansId);
}

function fjernBildeWidget(instansId) {
  const cardId = `card-${instansId}`;
  const side = aktivSide();
  side.widget_layout = side.widget_layout.filter(w => w.id !== cardId);
  side.widget_hidden  = (side.widget_hidden ?? []).filter(id => id !== cardId);
  const ingenSiderBrukerDen = state.sider.every(s => !s.widget_layout.some(w => w.id === cardId));
  if (ingenSiderBrukerDen) {
    delete state.bilder[instansId];
    document.getElementById(cardId)?.remove();
  }
  renderWidgetMeny();
  saveState();
}

function leggTilBilde() {
  state.bilde_teller++;
  const id = `bilde-${state.bilde_teller}`;
  state.bilder[id] = { data: null };
  const cardId = `card-${id}`;
  aktivSide().widget_layout.push({ id: cardId, col: 3, span: 1 });
  const el = lagBildeElement(id);
  document.querySelector('.col-wrapper[data-col="3"]').appendChild(el);
  setupBilde(id);
  settOppDragOgDrop();
  applyLayout();
  renderWidgetMeny();
  saveState();
}

// ===================== Gruppebegrensning =====================
function leggTilBegrensning(navn1, navn2) {
  if (!navn1 || !navn2 || navn1 === navn2) return;
  const allerede = (state.gruppe_begrensninger ?? []).some(
    ([a, b]) => (a === navn1 && b === navn2) || (a === navn2 && b === navn1)
  );
  if (allerede) { notify('Dette paret er allerede lagt til', 'warning'); return; }
  state.gruppe_begrensninger = [...(state.gruppe_begrensninger ?? []), [navn1, navn2]];
  saveState();
  renderBegrensninger();
}

function fjernBegrensning(idx) {
  state.gruppe_begrensninger.splice(idx, 1);
  saveState();
  renderBegrensninger();
}

function renderBegrensninger() {
  const liste = document.getElementById('begrensning-liste');
  if (!liste) return;
  liste.innerHTML = '';
  (state.gruppe_begrensninger ?? []).forEach(([a, b], i) => {
    const li = document.createElement('li');
    li.textContent = `${a} + ${b}`;
    const slett = document.createElement('button');
    slett.textContent = '✕';
    slett.onclick = () => fjernBegrensning(i);
    li.appendChild(slett);
    liste.appendChild(li);
  });
}

function åpneBegrensningModal() {
  document.getElementById('begrensning-modal').style.display = 'flex';
  renderBegrensninger();
}

function oppdaterBegrensningSelecter() {
  ['begr-navn1', 'begr-navn2'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const val = sel.value;
    sel.innerHTML = state.elever.map(e => `<option value="${e}">${e}</option>`).join('');
    if (state.elever.includes(val)) sel.value = val;
  });
}

// ===================== Tilbakemeldingsverktøy =====================
function åpneTilbakemeldingModal() {
  document.getElementById('feedback-modal').style.display = 'flex';
}

async function sendTilbakemelding() {
  const type  = document.getElementById('feedback-type').value;
  const tekst = document.getElementById('feedback-tekst').value.trim();
  if (!tekst) { notify('Skriv inn en beskrivelse først', 'warning'); return; }

  const titler  = { bug: '🐛 Feil', ønske: '✨ Ønske', annet: '💬 Annet' };
  const etiketter = { bug: ['bug'], ønske: ['enhancement'], annet: [] };

  try {
    const svar = await fetch(`https://api.github.com/repos/${CONFIG.github_feedback_repo}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.github_feedback_token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title:  `${titler[type]}: ${tekst.slice(0, 60)}`,
        body:   `**Type:** ${titler[type]}\n\n${tekst}\n\n---\n*Sendt fra klasserom-web*`,
        labels: etiketter[type],
      }),
    });
    if (!svar.ok) throw new Error(svar.status);
    notify('Tilbakemelding sendt! Takk 🙏');
    document.getElementById('feedback-tekst').value = '';
    document.getElementById('feedback-modal').style.display = 'none';
  } catch (err) {
    notify('Kunne ikke sende — sjekk nettforbindelsen', 'error');
  }
}

function init() {
  oppdaterDato();
  hentVær();
  setInterval(oppdaterDato, 60_000);
  setInterval(hentVær,      600_000);

  renderElever();
  renderAlleTrekk();
  renderGrupper();
  renderDagsplan();

  for (const instansId of Object.keys(state.notater)) {
    const el = lagNotatElement(instansId);
    document.querySelector('.col-wrapper[data-col="1"]').appendChild(el);
    setupNotat(instansId);
  }

  renderTimer();

  for (const instansId of Object.keys(state.bilder)) {
    const el = lagBildeElement(instansId);
    document.querySelector('.col-wrapper[data-col="3"]').appendChild(el);
    setupBilde(instansId);
  }

  document.addEventListener('paste', e => {
    if (!fokusertBildeId) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        lesBildefil(item.getAsFile(), fokusertBildeId);
        break;
      }
    }
  });

  applyLayout();
  settTema(state.tema ?? 'lyst');
  settFont(state.font ?? 'system');
  settSkriftstørrelse(state.skrift_størrelse ?? 'normal');
  applyWidgetStørrelser();
  settOppHendelser();
  settOppRename();
  settOppDragOgDrop();
  renderSiderNav();
}

document.addEventListener('DOMContentLoaded', init);
