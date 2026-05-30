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
    // Globalt scope — deles av alle sider
    lister:              {},
    timer_varighet:      300,
    tema: 'lyst',
    font: 'system',
    skrift_størrelse: 'normal',
    widget_størrelser: {},
    notater:      { 'notat-1': { tekst: '', kursiv: false } },
    bilder:       { 'bilde-1': { data: null } },
    notat_teller: 1,
    bilde_teller: 1,
    aktiv_side: 0,
    sider: [ nySide('Side 1') ],
  };
}

// Et nytt, tomt side-objekt («klasse-arbeidsbord»). Inneholder alt som er
// per-side scope: roster, grupper, trekk + backlogs, dagsplan, klassebamse-navn,
// gruppebegrensninger — pluss kolonne- og widget-oppsett.
function nySide(navn) {
  return {
    navn,
    kolonner: 3,
    kol_bredder: [3, 4, 3],
    elever:              [],
    grupper:             null,
    dagsplan:            [],
    tilfeldig_backlog:   [],
    tilfeldig_valgt:     null,
    ordenselev_backlog:  [],
    ordenselev_valgte:   [],
    ulv_backlog:         [],
    ulv_valgt:           null,
    ulv_navn:            'Klassebamse',
    gruppe_begrensninger: [],
    widget_layout: [
      { id: 'card-elever',     col: 1 },
      { id: 'card-grupper',    col: 1 },
      { id: 'card-tilfeldig',  col: 2 },
      { id: 'card-ordenselev', col: 2 },
      { id: 'card-ulv',        col: 2 },
      { id: 'card-timer',      col: 3 },
      { id: 'card-notat-1',    col: 3 },
      { id: 'card-dagsplan',   col: 3 },
      { id: 'card-bilde-1',    col: 3 },
    ],
    widget_hidden: [],
  };
}

// Standard kolonnebredder (flex-vekter) for n kolonner.
// 3 kolonner beholder den klassiske 30/40/30-fordelingen; ellers like brede.
function standardBredder(n) {
  if (n === 3) return [3, 4, 3];
  return Array.from({ length: n }, () => 1);
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
      // VIKTIG: les migreringsbeslutninger fra det RÅ parsede objektet (_raw), ikke fra
      // det default-flettede `state`. defaultState() fyller alltid sider[0] og notater/bilder
      // med tomme defaults, så guards som "finnes feltet?" må sjekke _raw — ellers ser de
      // alltid defaultene og migrerer aldri (→ datatap for gamle states). Se v2.7.
      const _raw = JSON.parse(raw);
      const state = Object.assign(defaultState(), _raw);
      if (!_raw.sider) {
        // Flatt pre-v1.9-state uten `sider`: bygg side 1 fra gammelt topp-nivå-oppsett
        state.sider = [{
          navn: 'Side 1',
          widget_layout: _raw.widget_layout ?? defaultState().sider[0].widget_layout,
          widget_hidden: _raw.widget_hidden ?? [],
        }];
        state.aktiv_side = 0;
        delete state.widget_layout;
        delete state.widget_hidden;
      }
      // Migrer flat notat/bilde-state til flerinstans-struktur
      if (_raw.notat !== undefined && _raw.notater === undefined) {
        state.notater = { 'notat-1': { tekst: _raw.notat || '', kursiv: _raw.notat_kursiv || false } };
        delete state.notat;
        delete state.notat_kursiv;
      }
      if (_raw.bilde_data !== undefined && _raw.bilder === undefined) {
        state.bilder = { 'bilde-1': { data: _raw.bilde_data || null } };
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
        // Migrer kolonne-innstillinger (lagt til i v2.6)
        if (!side.kolonner) side.kolonner = 3;
        if (!Array.isArray(side.kol_bredder) || side.kol_bredder.length !== side.kolonner) {
          side.kol_bredder = standardBredder(side.kolonner);
        }
      }
      // Migrer current-state til per-side scope (v2.7): flytt gammelt topp-nivå
      // (roster, trekk, backlogs, dagsplan, grupper, klassebamse-navn, begrensninger)
      // inn i den første siden. Ikke-destruktivt.
      const PER_SIDE_FELT = [
        'elever', 'grupper', 'dagsplan', 'tilfeldig_backlog', 'tilfeldig_valgt',
        'ordenselev_backlog', 'ordenselev_valgte', 'ulv_backlog', 'ulv_valgt',
        'ulv_navn', 'gruppe_begrensninger',
      ];
      const flatLegacy = _raw.sider === undefined;
      const førsteSide = state.sider[0];
      for (const felt of PER_SIDE_FELT) {
        // Flytt _raw sitt topp-nivå current-state inn i side 1.
        // Flatt legacy: kopier alltid (default-siden har allerede tomme verdier).
        // v2.6 med ekte sider-array: kopier kun når side 1 ikke selv hadde feltet.
        if (_raw[felt] !== undefined && (flatLegacy || førsteSide[felt] === undefined)) {
          førsteSide[felt] = _raw[felt];
        }
        delete state[felt];
      }
      // Sørg for at alle sider har komplette per-side-felter med fornuftige defaults
      for (const side of state.sider) {
        side.elever              ??= [];
        side.grupper             ??= null;
        side.dagsplan            ??= [];
        side.tilfeldig_backlog   ??= [];
        side.tilfeldig_valgt     ??= null;
        side.ordenselev_backlog  ??= [];
        side.ordenselev_valgte   ??= [];
        side.ulv_backlog         ??= [];
        side.ulv_valgt           ??= null;
        side.ulv_navn            ??= 'Klassebamse';
        side.gruppe_begrensninger ??= [];
        // Migrer dagsplan-strenger til { tekst, ferdig }-objekter
        side.dagsplan = side.dagsplan.map(p =>
          typeof p === 'string' ? { tekst: p, ferdig: false } : p
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
  const s = aktivSide();
  if (s.elever.length >= 35) {
    notify('Klasselisten er full (maks 35 elever)', 'warning');
    return false;
  }
  if (s.elever.some(e => e.toLowerCase() === navn.toLowerCase())) {
    notify(`${navn} er allerede inne`, 'warning');
    return false;
  }
  s.elever = [...s.elever, navn];
  saveState();
  renderElever();
  renderAlleTrekk();
  notify(`✓ ${navn} lagt til`);
  return true;
}

function fjernElev(idx) {
  const s = aktivSide();
  const navn = s.elever[idx];
  if (!navn) return;
  s.elever = s.elever.filter((_, i) => i !== idx);
  saveState();
  renderElever();
  renderAlleTrekk();
}

function fjernEleverBatch(fjernSett) {
  const s = aktivSide();
  s.elever = s.elever.filter(e => !fjernSett.has(e));
  saveState();
  renderElever();
  renderAlleTrekk();
}

function ryddBackloger(fjernSett) {
  const s = aktivSide();
  s.ordenselev_backlog = s.ordenselev_backlog.filter(e => !fjernSett.has(e));
  s.ordenselev_valgte  = s.ordenselev_valgte.filter(e => !fjernSett.has(e));
  s.ulv_backlog        = s.ulv_backlog.filter(e => !fjernSett.has(e));
  if (s.ulv_valgt && fjernSett.has(s.ulv_valgt)) s.ulv_valgt = null;
  s.tilfeldig_backlog  = s.tilfeldig_backlog.filter(e => !fjernSett.has(e));
  if (s.tilfeldig_valgt && fjernSett.has(s.tilfeldig_valgt)) s.tilfeldig_valgt = null;
}

function renderElever() {
  const s = aktivSide();
  const liste   = document.getElementById('elev-liste');
  const antall  = s.elever.length;

  document.getElementById('elev-antall').textContent = antall;
  document.getElementById('elev-tekst').textContent  = antall === 1 ? 'elev inne' : 'elever inne';

  if (!antall) {
    liste.innerHTML = '<p class="tom-tekst">Ingen elever inne ennå.<br>Trykk "+ Legg til elev" for å starte.</p>';
    return;
  }

  // Bygg kart: elevnavn → gruppeindeks
  const gruppeKart = new Map();
  if (s.grupper) {
    s.grupper.forEach((g, gi) => g.forEach(n => gruppeKart.set(n, gi)));
  }

  liste.innerHTML = s.elever.map((navn, i) => {
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
  const s = aktivSide();
  if (!s.elever.length) { notify('Ingen elever inne', 'error'); return; }
  const pool = s.elever.length > 1
    ? s.elever.filter(e => e !== s.tilfeldig_valgt)
    : s.elever;
  s.tilfeldig_valgt = pool[Math.floor(Math.random() * pool.length)];
  saveState();
  renderTilfeldig();
}

function trekkTilfeldigBacklog() {
  const s = aktivSide();
  if (!s.elever.length) { notify('Ingen elever inne', 'error'); return; }
  const pool = s.elever.filter(e => !s.tilfeldig_backlog.includes(e));
  if (!pool.length) {
    notify('Alle elever er trukket — nullstill for å starte på nytt', 'warning');
    return;
  }
  s.tilfeldig_valgt = pool[Math.floor(Math.random() * pool.length)];
  if (!s.tilfeldig_backlog.includes(s.tilfeldig_valgt)) {
    s.tilfeldig_backlog.push(s.tilfeldig_valgt);
  }
  saveState();
  renderTilfeldig();
}

function trekkOrdenselev() {
  const s = aktivSide();
  if (s.elever.length < 2) {
    notify(`Trenger minst 2 elever (${s.elever.length} inne)`, 'error');
    return;
  }
  let pool = s.elever.filter(e => !s.ordenselev_backlog.includes(e));
  if (!pool.length) {
    notify('Alle elever har vært ordenselev — nullstill for å starte på nytt', 'warning');
    return;
  }
  if (pool.length === 1) {
    // Siste i backlog: velg den, nullstill backlog, trekk en til fra resten
    const siste  = pool[0];
    s.ordenselev_backlog = [];
    const andre  = s.elever.filter(e => e !== siste);
    const valgt2 = andre[Math.floor(Math.random() * andre.length)];
    s.ordenselev_valgte = [siste, valgt2];
    s.ordenselev_backlog = [...s.ordenselev_valgte];
  } else {
    const shufflet = shuffle(pool);
    s.ordenselev_valgte = shufflet.slice(0, 2);
    s.ordenselev_valgte.forEach(e => {
      if (!s.ordenselev_backlog.includes(e)) s.ordenselev_backlog.push(e);
    });
  }
  saveState();
  renderOrdenselev();
}

function trekkUlv() {
  const s = aktivSide();
  const pool = s.elever.filter(e => !s.ulv_backlog.includes(e));
  if (!pool.length) {
    if (s.elever.length) notify('Alle elever har hatt bamsen — nullstill for å starte på nytt', 'warning');
    else notify('Ingen elever inne', 'error');
    return;
  }
  s.ulv_valgt = pool[Math.floor(Math.random() * pool.length)];
  if (!s.ulv_backlog.includes(s.ulv_valgt)) s.ulv_backlog.push(s.ulv_valgt);
  saveState();
  renderUlv();
  notify(`${s.ulv_valgt} tar med ${s.ulv_navn.toLowerCase()} hjem!`);
}

function renderTilfeldig() {
  const s = aktivSide();
  const vis = document.getElementById('tilfeldig-vis');
  const bl  = document.getElementById('tilfeldig-backlog-count');
  if (s.tilfeldig_valgt) {
    vis.className   = 'draw-result';
    vis.innerHTML   = `<div class="drawn-name">🙋 ${esc(s.tilfeldig_valgt)}</div>`;
  } else {
    vis.className   = 'draw-placeholder';
    vis.textContent = 'Trykk Trekk for å velge en tilfeldig elev';
  }
  if (s.tilfeldig_backlog.length) {
    bl.className    = 'backlog-count';
    bl.textContent  = `${s.tilfeldig_backlog.length} trukket (backlog)`;
  } else {
    bl.className    = 'backlog-count hidden';
  }
}

function renderOrdenselev() {
  const s = aktivSide();
  const vis = document.getElementById('ordenselev-vis');
  const bl  = document.getElementById('ordenselev-backlog-count');
  if (s.ordenselev_valgte.length) {
    vis.className = 'draw-result';
    vis.innerHTML = `<div class="draw-pair">
      ${s.ordenselev_valgte.map(n => `<div class="draw-pair-item">⭐ ${esc(n)}</div>`).join('')}
    </div>`;
  } else {
    vis.className   = 'draw-placeholder';
    vis.textContent = 'Trykk Trekk for å velge to ordenselever';
  }
  if (s.ordenselev_backlog.length) {
    bl.className   = 'backlog-count';
    bl.textContent = `${s.ordenselev_backlog.length} i backlog`;
  } else {
    bl.className   = 'backlog-count hidden';
  }
}

function renderUlv() {
  const s = aktivSide();
  const vis  = document.getElementById('ulv-vis');
  const bl   = document.getElementById('ulv-backlog-count');
  const navn = s.ulv_navn || 'Klassebamse';
  document.querySelector('#card-ulv h2').textContent = navn;
  document.getElementById('btn-ulv').textContent = `Trekk ${navn.toLowerCase()}`;
  if (s.ulv_valgt) {
    vis.className = 'draw-result ulv-result';
    vis.innerHTML = `<div class="drawn-name">${esc(s.ulv_valgt)}</div>`;
  } else {
    vis.className   = 'draw-placeholder';
    vis.textContent = `Trykk Trekk for å velge hvem som tar med ${navn.toLowerCase()} hjem`;
  }
  if (s.ulv_backlog.length) {
    bl.className   = 'backlog-count';
    bl.textContent = `${s.ulv_backlog.length} i backlog`;
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
    <button class="kl-widget-close" onclick="fjernNotat('${instansId}')" title="Slett dette notatet">✕</button>
    <div class="card-header">
      <span class="drag-handle" title="Dra for å flytte">⠿</span>
      <h2>📝 Notat</h2>
      <div class="card-controls">
        <button class="btn btn-ghost btn-sm btn-icon" id="btn-notat-kursiv-${instansId}" title="Kursiv tekst">𝐼</button>
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
  aktivSide().widget_layout.push({ id: cardId, col: 1 });
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
  aktivSide().dagsplan.push({ tekst, ferdig: false });
  saveState();
  renderDagsplan();
}

function fjernDagsplan(idx) {
  aktivSide().dagsplan.splice(idx, 1);
  saveState();
  renderDagsplan();
}

function toggleDagsplanFerdig(idx) {
  const p = aktivSide().dagsplan[idx];
  if (!p) return;
  p.ferdig = !p.ferdig;
  saveState();
  renderDagsplan();
}

function renderDagsplan() {
  const dagsplan = aktivSide().dagsplan;
  const liste = document.getElementById('dagsplan-liste');
  if (!dagsplan.length) {
    liste.innerHTML = '<p class="tom-tekst" style="padding:4px">Tom — trykk "+ Legg til punkt"</p>';
    return;
  }
  liste.innerHTML = dagsplan.map((p, i) => `
    <div class="dagsplan-item${p.ferdig ? ' ferdig' : ''}" onclick="toggleDagsplanFerdig(${i})">
      <span class="dagsplan-prikk">●</span>
      <span class="dagsplan-tekst">${esc(p.tekst)}</span>
      <button class="dagsplan-slett" onclick="event.stopPropagation();fjernDagsplan(${i})" title="Fjern">✕</button>
    </div>`).join('');
}

// ===================== Grupper =====================
function lagGrupper(antall) {
  const s = aktivSide();
  if (s.elever.length < 2) { notify('Trenger minst 2 elever', 'warning'); return; }
  if (antall > s.elever.length) {
    notify(`For mange grupper — bare ${s.elever.length} elever inne`, 'warning');
    return;
  }
  const begrensninger = s.gruppe_begrensninger ?? [];
  let grupper = null;
  for (let forsøk = 0; forsøk < 200; forsøk++) {
    const shufflet = shuffle(s.elever);
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
  s.grupper = grupper;
  saveState();
  renderGrupper();
  renderElever();
  const størrelser = grupper.map(g => g.length);
  notify(`🎲 ${antall} grupper (${Math.min(...størrelser)}–${Math.max(...størrelser)} elever)`);
}

function fjernGrupper() {
  aktivSide().grupper = null;
  saveState();
  renderGrupper();
  renderElever();
}

function renderGrupper() {
  const vis = document.getElementById('grupper-vis');
  if (!aktivSide().grupper) {
    vis.innerHTML = '<p class="tom-tekst">Ingen grupper aktive — trykk <kbd>🎲 Del inn</kbd></p>';
    return;
  }
  vis.innerHTML = aktivSide().grupper.map((gruppe, gi) => {
    const f = GRUPPE_FARGER[gi % GRUPPE_FARGER.length];
    return `<div class="gruppe-kort" style="background:${f.bg}">
      <div class="gruppe-tittel" style="color:${f.text}">Gruppe ${gi + 1}</div>
      <div class="gruppe-elever" style="color:${f.text}">${gruppe.map(esc).join(', ')}</div>
    </div>`;
  }).join('');
}

// ===================== Lister =====================
function lagreListe(navn) {
  const s = aktivSide();
  if (!s.elever.length) { notify('Ingen elever inne å lagre', 'warning'); return false; }
  const erNy = !state.lister[navn];
  state.lister[navn] = [...s.elever]; // lagrede lister er globale; rosteren er per side
  saveState();
  notify(`📋 '${navn}' ${erNy ? 'lagret' : 'oppdatert'} (${s.elever.length} elever)`);
  return true;
}

function lastListe(navn) {
  const elever = state.lister[navn];
  if (!elever) return;
  const s = aktivSide();
  s.elever  = [...elever]; // last den globale lista inn i denne sidens roster
  s.grupper = null;
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
    ${poster.map(([navn, elever]) => {
      const jn = JSON.stringify(navn).replace(/"/g, '&quot;');
      return `
      <div class="modal-list-item" onclick="lastListe(${jn});lukkModal()">
        <span>📋 ${esc(navn)}</span>
        <div class="flex gap-2" style="align-items:center">
          <span class="item-meta">${elever.length} elever</span>
          <button class="btn btn-sm" style="background:var(--red-l);color:var(--red);padding:3px 8px"
            onclick="event.stopPropagation();slettListe(${jn})">✕</button>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ===================== Layout (drag) =====================
function applyLayout() {
  // Forsikre at de faste (singleton) widgetene finnes (for gamle lagrede states).
  // notat/bilde utelates med vilje — de er flerinstans og eies per side, så de skal
  // IKKE tvinges inn på en side som har sine egne (eller har fjernet dem).
  const defaults = defaultState().sider[0].widget_layout
    .filter(def => !def.id.startsWith('card-notat-') && !def.id.startsWith('card-bilde-'));
  defaults.forEach(def => {
    if (!aktivSide().widget_layout.find(w => w.id === def.id)) {
      aktivSide().widget_layout.push({ ...def });
    }
  });

  const antallKol = aktivSide().kolonner ?? 3;
  const skjult = aktivSide().widget_hidden ?? [];
  aktivSide().widget_layout.forEach(({ id, col }) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (skjult.includes(id)) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.gridColumn = '';
    // Klamp til antall kolonner på denne siden (kort i fjernede kolonner havner i siste)
    const målKol = Math.min(col, antallKol);
    const wrapper = document.querySelector(`.col-wrapper[data-col="${målKol}"]`);
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

  // Single-instance widgets: av/på-checkbox (per side, som før)
  const statiske = Object.entries(WIDGET_NAVN).map(([id, navn]) => `
    <label class="widget-meny-rad">
      <input type="checkbox" ${skjult.includes(id) ? '' : 'checked'}
             onchange="toggleWidgetSynlighet('${id}', this.checked)">
      ${navn}
    </label>`).join('');

  // Fler-instans widgets: ingen checkbox, bare "+". Tell hvor mange siden har.
  const aktivIds = aktivSide().widget_layout.map(w => w.id);
  const antNotat = aktivIds.filter(id => id.startsWith('card-notat-')).length;
  const antBilde = aktivIds.filter(id => id.startsWith('card-bilde-')).length;
  const leggTil = `
    <div class="widget-meny-sep"></div>
    <div class="widget-meny-tittel">Legg til flere</div>
    <div class="widget-meny-rad" style="gap:6px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" onclick="leggTilNotat()">+ 📝 Notat${antNotat ? ` (${antNotat})` : ''}</button>
      <button class="btn btn-ghost btn-sm" onclick="leggTilBilde()">+ 🖼 Bilde${antBilde ? ` (${antBilde})` : ''}</button>
    </div>`;

  dropdown.innerHTML = statiske + leggTil;
}

function toggleWidgetSynlighet(id, synlig) {
  const skjult = aktivSide().widget_hidden ?? [];
  aktivSide().widget_hidden = synlig
    ? skjult.filter(h => h !== id)
    : [...skjult, id];
  saveState();
  applyLayout();
  renderWidgetMeny();
}

// ===================== Kolonner (antall + bredde, per side) =====================
const MIN_KOL = 1;
const MAKS_KOL = 4;
const MIN_KOL_PX = 100; // minste bredde en kolonne kan dras ned til

// Bygger riktig antall .col-wrapper for aktiv side, setter breddene (flex-vekter)
// og legger dra-håndtak (.kl-col-resizer) mellom kolonnene. Beholder kort-elementer.
function byggKolonner() {
  const main = document.querySelector('main');
  const side = aktivSide();
  const n = side.kolonner ?? 3;
  const bredder = side.kol_bredder ?? standardBredder(n);

  // Fjern gamle resizers (settes inn på nytt under)
  main.querySelectorAll('.kl-col-resizer').forEach(r => r.remove());

  let wrappers = [...main.querySelectorAll('.col-wrapper')];

  // For mange kolonner: flytt kortene til siste gjenværende, fjern wrapperen
  while (wrappers.length > n) {
    const w = wrappers.pop();
    const siste = wrappers[wrappers.length - 1];
    [...w.children].forEach(c => { if (c.classList.contains('card')) siste.appendChild(c); });
    w.remove();
  }
  // For få kolonner: legg til tomme wrappers
  while (wrappers.length < n) {
    const w = document.createElement('div');
    w.className = 'col-wrapper';
    main.appendChild(w);
    wrappers.push(w);
  }

  // Sett kolonnenummer + bredde, og sett inn resizer etter hver kolonne unntatt siste
  wrappers.forEach((w, i) => {
    w.dataset.col = i + 1;
    w.style.flex = `${bredder[i] ?? 1} 1 0`;
    if (i < wrappers.length - 1) {
      const r = document.createElement('div');
      r.className = 'kl-col-resizer';
      r.dataset.venstre = i + 1; // resizer mellom kolonne (i+1) og (i+2)
      r.title = 'Dra for å justere kolonnebredde';
      w.after(r);
    }
  });

  settOppResizers();
}

function settOppResizers() {
  document.querySelectorAll('.kl-col-resizer').forEach(r => {
    r.onmousedown = e => startResize(e, r);
  });
}

function startResize(e, resizer) {
  e.preventDefault();
  const venstreCol = Number(resizer.dataset.venstre);
  const wVenstre = document.querySelector(`.col-wrapper[data-col="${venstreCol}"]`);
  const wHøyre   = document.querySelector(`.col-wrapper[data-col="${venstreCol + 1}"]`);
  if (!wVenstre || !wHøyre) return;

  const bredder = aktivSide().kol_bredder;
  const startX  = e.clientX;
  const pxV0    = wVenstre.getBoundingClientRect().width;
  const pxH0    = wHøyre.getBoundingClientRect().width;
  const pxSum   = pxV0 + pxH0;
  const vektSum = bredder[venstreCol - 1] + bredder[venstreCol];
  document.body.classList.add('kl-resizing');

  function onMove(ev) {
    let nyPxV = pxV0 + (ev.clientX - startX);
    nyPxV = Math.max(MIN_KOL_PX, Math.min(pxSum - MIN_KOL_PX, nyPxV));
    const andel = nyPxV / pxSum;
    const nyVektV = vektSum * andel;
    const nyVektH = vektSum - nyVektV;
    bredder[venstreCol - 1] = nyVektV;
    bredder[venstreCol]     = nyVektH;
    wVenstre.style.flex = `${nyVektV} 1 0`;
    wHøyre.style.flex   = `${nyVektH} 1 0`;
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.classList.remove('kl-resizing');
    saveState();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function endreKolonneAntall(delta) {
  const side = aktivSide();
  const n  = side.kolonner ?? 3;
  const ny = Math.max(MIN_KOL, Math.min(MAKS_KOL, n + delta));
  if (ny === n) return;

  if (ny > n) {
    // Legg til kolonne(r) med standard enkeltbredde (3 ≈ samme vekt som sidekolonnene)
    for (let i = n; i < ny; i++) side.kol_bredder.push(3);
  } else {
    // Fjern kolonne(r): klamp kort som lå i fjernet kolonne til den siste
    side.kol_bredder = side.kol_bredder.slice(0, ny);
    side.widget_layout.forEach(w => { if (w.col > ny) w.col = ny; });
  }
  side.kolonner = ny;
  saveState();
  byggKolonner();
  applyLayout();
  oppdaterKolonneStepper();
}

function oppdaterKolonneStepper() {
  const n = aktivSide().kolonner ?? 3;
  const tall = document.getElementById('kol-antall');
  if (tall) tall.textContent = n;
  const minus = document.getElementById('btn-kol-minus');
  const pluss = document.getElementById('btn-kol-pluss');
  if (minus) minus.disabled = n <= MIN_KOL;
  if (pluss) pluss.disabled = n >= MAKS_KOL;
}

function kolonneFraMus(clientX) {
  const wrappers = document.querySelectorAll('.col-wrapper');
  for (const w of wrappers) {
    const rect = w.getBoundingClientRect();
    if (clientX <= rect.right) return Number(w.dataset.col);
  }
  return aktivSide().kolonner ?? 3;
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
  byggKolonner();
  applyLayout();
  // Re-rendre all per-side data for den nye siden (timeren er global og røres ikke)
  renderElever();
  renderAlleTrekk();
  renderGrupper();
  renderDagsplan();
  oppdaterBegrensningSelecter();
  renderWidgetMeny();
  renderSiderNav();
  oppdaterKolonneStepper();
}

function leggTilSide() {
  const nr = state.sider.length + 1;
  const side = nySide(`Side ${nr}`);
  // Gi den nye siden EGNE notat- og bilde-instanser, ellers ville den delt
  // card-notat-1/card-bilde-1 (og dermed innholdet) med side 1.
  const notatId = `notat-${++state.notat_teller}`;
  state.notater[notatId] = { tekst: '', kursiv: false };
  const bildeId = `bilde-${++state.bilde_teller}`;
  state.bilder[bildeId] = { data: null };
  side.widget_layout = side.widget_layout.map(w =>
    w.id === 'card-notat-1' ? { ...w, id: `card-${notatId}` } :
    w.id === 'card-bilde-1' ? { ...w, id: `card-${bildeId}` } : w
  );
  state.sider.push(side);
  // Opprett DOM-elementene for de nye instansene (applyLayout plasserer/skjuler dem ved byttSide)
  const notatEl = lagNotatElement(notatId);
  document.querySelector('.col-wrapper[data-col="1"]').appendChild(notatEl);
  setupNotat(notatId);
  const bildeEl = lagBildeElement(bildeId);
  document.querySelector('.col-wrapper[data-col="1"]').appendChild(bildeEl);
  setupBilde(bildeId);
  settOppDragOgDrop();
  byttSide(state.sider.length - 1);
}

function fjernSide(idx) {
  if (state.sider.length <= 1) return;
  state.sider.splice(idx, 1);
  // byttSide lagrer og re-rendrer alt (kolonner + per-side data) for den nye aktive siden
  byttSide(Math.min(state.aktiv_side, state.sider.length - 1));
}

// ===================== Reset =====================
function nullstillTilfeldig()   { const s = aktivSide(); s.tilfeldig_valgt = null; s.tilfeldig_backlog = []; saveState(); renderTilfeldig(); notify('🎲 Tilfeldig-trekk nullstilt'); }
function nullstillOrdenselev()  { const s = aktivSide(); s.ordenselev_valgte = []; s.ordenselev_backlog = []; saveState(); renderOrdenselev(); notify('⭐ Ordenselever-trekk nullstilt'); }
function nullstillUlv()         { const s = aktivSide(); s.ulv_valgt = null; s.ulv_backlog = []; saveState(); renderUlv(); notify('🐺 Ulv-trekk nullstilt'); }
function nullstillNotat() {
  for (const instansId of Object.keys(state.notater)) {
    state.notater[instansId].tekst = '';
    const ta = document.getElementById(`notat-textarea-${instansId}`);
    if (ta) { ta.value = ''; autoResizeNotat(ta); }
  }
  saveState();
  notify('📝 Notat nullstilt');
}
function nullstillDagsplan()    { aktivSide().dagsplan = []; saveState(); renderDagsplan(); notify('📋 Dagsplan nullstilt'); }

// ===================== Info modal =====================
const OPPDATERINGSLOGG_HTML = `
  <div class="logg-entry">
    <div class="logg-versjon">v2.8</div>
    <div class="logg-dato">30. mai 2026</div>
    <ul>
      <li>Fikset: notatfeltet følger nå valgt font (og fikk tilbake riktig ramme og bakgrunn) — det hadde blitt stående på nettleserens standardfont</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v2.7</div>
    <div class="logg-dato">30. mai 2026</div>
    <ul>
      <li>Hver side er nå et eget klasse-arbeidsbord: elevliste, grupper, trekk (med backlogs), dagsplan, gruppebegrensninger og klassebamse-navn er <strong>per side</strong>. Lag én side per klasse — 1A på side 1, 1B på side 2 — og bytt fritt mellom dem uten å miste noe</li>
      <li>Globalt på tvers av alle sider: lagrede klasselister, tema, font, skriftstørrelse og timeren</li>
      <li>Timeren fortsetter å telle ned selv om du bytter side — lag gjerne en egen side for å vise bilder mens nedtellingen går videre</li>
      <li>Hver side får egne notat- og bildekort — innholdet deles ikke lenger mellom sider</li>
      <li>Fjern et kort direkte med <strong>✕</strong> i kortets øverste høyre hjørne (dukker opp når du holder musen over). Faste widgets skjules (hent dem tilbake i ⊞ Widgets), notat/bilde-kort slettes</li>
      <li>⊞ Widgets-menyen: faste widgets har av/på-avkryssing, mens notat og bilde har «+» for å legge til så mange du vil</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v2.6</div>
    <div class="logg-dato">29. mai 2026</div>
    <ul>
      <li>Juster kolonnebredden fritt: dra i de tynne skillelinjene mellom kolonnene. Bredden lagres per side</li>
      <li>Endre antall kolonner (1–4) med <strong>⊞ Kolonner − / +</strong> nederst i verktøylinja. Når du fjerner en kolonne flyttes kortene til den siste. Lagres per side</li>
      <li>Fjernet den gamle <strong>●○○</strong>-breddeknappen på hvert kort — den hadde ingen effekt lenger, og kolonnebredden styres nå med dra-linjene mellom kolonnene</li>
      <li>Fikset: skriftstørrelse-valgene gjorde ingenting før. Nå skalerer <strong>Alle widgets</strong> hele grensesnittet, og <strong>Enkelt widget</strong>-knappene forstørrer faktisk kortet</li>
      <li>💬 Tilbakemelding henviser nå til e-post og GitHub i stedet for et innebygd skjema</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v2.5</div>
    <div class="logg-dato">20. mai 2026</div>
    <ul>
      <li>Klikk på et dagsplan-punkt for å markere det som ferdig — prikken blir grønn og teksten får gjennomstreking. Klikk igjen for å angre</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v2.4</div>
    <div class="logg-dato">14. mai 2026</div>
    <ul>
      <li>Temaene «På fjellet», «I eventyrland» og «Equestria» har fått mer karakter — saturert bakgrunn, tonet kort og egen header-gradient så de skiller seg tydelig fra lys modus</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v2.3</div>
    <div class="logg-dato">13. mai 2026</div>
    <ul>
      <li>Fikset: lagrede lister kunne ikke hentes opp ved klikk — skyldes en feil i HTML-attributt-formatering av listenavn</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v2.2</div>
    <div class="logg-dato">12. mai 2026</div>
    <ul>
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
  <h4>Sider — ett arbeidsbord per klasse</h4>
  <p>Klikk <strong>+</strong> i midten av headeren for å legge til en ny side, klikk på et sidenavn for å bytte, og <strong>✕</strong> på en fane for å slette. Tanken er at <strong>hver side er sin egen klasse</strong>: lag side 1 for 1A og side 2 for 1B, og bytt fritt mellom dem gjennom dagen uten at noe blandes.</p>
  <p><strong>Per side</strong> (egen for hver klasse): elevlisten, grupper, alle trekk og backlogs (tilfeldig/ordenselev/klassebamse), dagsplanen, gruppebegrensninger, klassebamsens navn — pluss kolonneoppsett, notater og bilder.</p>
  <p><strong>Delt mellom alle sider:</strong> lagrede klasselister (📋 Lister — et felles bibliotek du kan laste inn i hvilken som helst side), tema, font, skriftstørrelse og timeren.</p>
  <p>Timeren er felles og fortsetter å gå selv om du bytter side. Vil du f.eks. vise et bilde på en egen side mens nedtellingen ruller, går det helt fint — timeren teller videre i bakgrunnen.</p>

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
  <p>Du kan ha <strong>flere notatkort</strong>: åpne <strong>⊞ Widgets</strong>-menyen og klikk <strong>+ Notat</strong>. Hvert notat kan flyttes uavhengig av de andre. Slett et notat med <strong>✕</strong> i kortets øverste høyre hjørne. Notater er per side — side 1 og side 2 har helt forskjellige notatkort.</p>

  <h4>Dagsplan</h4>
  <p>Legg til punkter med <strong>+ Legg til punkt</strong> (eller <kbd>d</kbd>). Fjern enkeltpunkter med <strong>✕</strong> ved siden av hvert punkt.</p>
  <p><strong>Klikk på et punkt</strong> for å markere det som ferdig — prikken blir grønn og teksten får en strek over. Klikk på punktet igjen for å angre.</p>

  <h4>🖼 Bilde-widget</h4>
  <p>Klikk på bilde-kortet for å velge en bildefil fra datamaskinen (maks 2 MB). Du kan også lime inn et bilde direkte med <kbd>Ctrl+V</kbd> (f.eks. et skjermbilde) — klikk først på kortet du vil lime inn i. Bildet lagres i nettleseren og vises igjen ved neste besøk. Trykk <strong>Fjern bilde</strong> for å slette bildeinnholdet.</p>
  <p>Du kan ha <strong>flere bildekort</strong>: åpne <strong>⊞ Widgets</strong>-menyen og klikk <strong>+ Bilde</strong>. Slett et bildekort med <strong>✕</strong> i kortets øverste høyre hjørne. Bildekort er per side — forskjellige sider har forskjellige bilder.</p>

  <h4>Tilpasse layouten</h4>
  <p>Dra et kort til en annen kolonne ved å holde inne dra-håndtaket <strong>⠿</strong> (dukker opp når du holder musen over kortet). Layouten huskes automatisk.</p>
  <p><strong>Fjerne et kort:</strong> hold musen over kortet og klikk <strong>✕</strong> øverst i høyre hjørne. Faste widgets (elever, grupper, trekk, timer, dagsplan) blir bare skjult — du henter dem tilbake i <strong>⊞ Widgets</strong>-menyen. Notat- og bildekort slettes helt.</p>
  <p><strong>⊞ Widgets-menyen</strong> (øverst til høyre) viser de faste widgetene med av/på-avkryssing per side. Notat og bilde har i stedet en <strong>«+»</strong> — trykk for å legge til så mange du vil. Hvert nytt kort er eget for den siden du står på.</p>

  <h4>Kolonnebredde og antall kolonner</h4>
  <p><strong>Juster bredden:</strong> hold musen mellom to kolonner — det dukker opp en tynn skillelinje. Dra i den for å gjøre den ene kolonnen bredere og den andre smalere. Breddene huskes per side.</p>
  <p><strong>Endre antall:</strong> bruk <strong>⊞ Kolonner</strong> med <strong>−</strong> og <strong>+</strong> nederst til venstre for å gå mellom 1 og 4 kolonner. Når du fjerner en kolonne, flyttes kortene som lå der over til den siste kolonnen — ingenting forsvinner. Antall kolonner lagres per side, så side 1 kan ha tre kolonner mens side 2 har én.</p>

  <h4>Tema</h4>
  <p>Åpne <strong>Klasserom-menyen</strong> (tannhjulet øverst til venstre) og hold musen over <strong>🎨 Tema</strong>. Velg blant tre standardtemaer (Lyst, Mørkt, Høy kontrast) eller åtte kreative temaer: Under vann, På fjellet, I skogen, I en vulkan, I eventyrland, Matrix, Cyberspace og Equestria. Temaet lagres automatisk.</p>

  <h4>Font</h4>
  <p>Hold musen over <strong>🔤 Font</strong> i Klasserom-menyen. Velg blant systemstandard og seks Google Fonts — inkludert <em>Victor Mono</em> (monospace), <em>Caveat</em> (håndskrevet) og <em>Playfair Display</em> (serif). Fonten lastes dynamisk og lagres til neste gang.</p>

  <h4>Skriftstørrelse</h4>
  <p>Hold musen over <strong>📏 Skriftstørrelse</strong> i Klasserom-menyen. Under <strong>Alle widgets</strong> skalerer du hele grensesnittet (Liten → Ekstra stor), der Normal er standardstørrelsen. Under <strong>Enkelt widget</strong> kan du forstørre eller forminske ett kort om gangen med S/M/L/XL-knapper uten å lukke menyen — størrelsen legger seg oppå den globale.</p>

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

  <h4>💬 Tilbakemelding & kontakt</h4>
  <p>Klikk <strong>💬 Tilbakemelding</strong> i Klasserom-menyen (tannhjulet øverst til venstre). Der finner du to måter å nå utvikleren på: send en e-post til <strong>knitresletta@pm.me</strong>, eller opprett en sak (issue) på GitHub for å melde en feil eller foreslå en ny funksjon.</p>

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
    ${aktivSide().elever.map((navn, i) => `
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

// Rot-skriftstørrelser (px). «normal» = 16px = nettleserens standardrot, så
// grensesnittet ser likt ut som før ved normal og skalerer proporsjonalt ellers.
const STØRRELSER = {
  'liten':  '14px',
  'normal': '16px',
  'stor':   '18px',
  'xl':     '20px',
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
  // Bruker zoom (ikke font-size), ellers ignorerer kortets rem-baserte tekst endringen.
  // Faktor er relativ til normal (16px), så per-widget legger seg oppå den globale størrelsen.
  const faktor = STØRRELSER[key] ? parseInt(STØRRELSER[key], 10) / 16 : 1;
  card.style.zoom = (key && key !== 'normal') ? faktor : '';
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
    if (!aktivSide().elever.length) { notify('Ingen elever inne å lagre', 'warning'); return; }
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
      fjernes = [...aktivSide().elever];
    } else {
      fjernes = Array.from(
        document.querySelectorAll('#fjern-elever-liste input[data-idx]:checked')
      ).map(cb => aktivSide().elever[parseInt(cb.dataset.idx)]).filter(Boolean);
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

  // Kolonne-stepper (antall kolonner på denne siden)
  document.getElementById('btn-kol-minus').onclick = () => endreKolonneAntall(-1);
  document.getElementById('btn-kol-pluss').onclick = () => endreKolonneAntall(1);

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
    document.getElementById('rename-input').value = aktivSide().ulv_navn || 'Klassebamse';
    åpneModal('modal-ulv-rename');
  };
  document.getElementById('btn-rename-avbryt').onclick = lukkModal;
  document.getElementById('btn-rename-lagre').onclick = () => {
    const nyttNavn = document.getElementById('rename-input').value.trim();
    if (nyttNavn) {
      aktivSide().ulv_navn = nyttNavn;
      saveState();
      renderUlv();
    }
    lukkModal();
  };
  inputEnter('rename-input', () => document.getElementById('btn-rename-lagre').click());
}

// ===================== Backlog-editor =====================
function åpneRedigerBacklog(type) {
  const s = aktivSide();
  const erOrden   = type === 'ordenselev';
  const backlogKey = erOrden ? 'ordenselev_backlog' : 'ulv_backlog';
  const tittel     = erOrden ? 'Rediger ordenselev-backlog' : `Rediger ${s.ulv_navn || 'Klassebamse'}-backlog`;

  document.getElementById('rediger-backlog-tittel').textContent = tittel;

  const chips = document.getElementById('rediger-backlog-chips');
  chips.innerHTML = '';
  (s.elever || []).forEach(navn => {
    const erBrukt = s[backlogKey].includes(navn);
    const chip = document.createElement('div');
    chip.className = 'chip' + (erBrukt ? ' brukt' : '');
    chip.textContent = navn;
    chip.onclick = () => {
      if (s[backlogKey].includes(navn)) {
        s[backlogKey] = s[backlogKey].filter(n => n !== navn);
        chip.classList.remove('brukt');
      } else {
        s[backlogKey].push(navn);
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
    <button class="kl-widget-close" onclick="fjernBildeWidget('${instansId}')" title="Slett dette bildekortet">✕</button>
    <div class="card-header">
      <span class="drag-handle" title="Dra for å flytte">⠿</span>
      <h2>🖼 Bilde</h2>
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
  const col = Math.min(3, aktivSide().kolonner ?? 3);
  aktivSide().widget_layout.push({ id: cardId, col });
  const el = lagBildeElement(id);
  document.querySelector(`.col-wrapper[data-col="${col}"]`).appendChild(el);
  setupBilde(id);
  settOppDragOgDrop();
  applyLayout();
  renderWidgetMeny();
  saveState();
}

// ===================== Gruppebegrensning =====================
function leggTilBegrensning(navn1, navn2) {
  if (!navn1 || !navn2 || navn1 === navn2) return;
  const s = aktivSide();
  const allerede = (s.gruppe_begrensninger ?? []).some(
    ([a, b]) => (a === navn1 && b === navn2) || (a === navn2 && b === navn1)
  );
  if (allerede) { notify('Dette paret er allerede lagt til', 'warning'); return; }
  s.gruppe_begrensninger = [...(s.gruppe_begrensninger ?? []), [navn1, navn2]];
  saveState();
  renderBegrensninger();
}

function fjernBegrensning(idx) {
  aktivSide().gruppe_begrensninger.splice(idx, 1);
  saveState();
  renderBegrensninger();
}

function renderBegrensninger() {
  const liste = document.getElementById('begrensning-liste');
  if (!liste) return;
  liste.innerHTML = '';
  (aktivSide().gruppe_begrensninger ?? []).forEach(([a, b], i) => {
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
    const elever = aktivSide().elever;
    sel.innerHTML = elever.map(e => `<option value="${e}">${e}</option>`).join('');
    if (elever.includes(val)) sel.value = val;
  });
}

// ===================== Tilbakemelding & kontakt =====================
// Modalen viser kontaktvalg (e-post + GitHub issues) — ingen innebygd
// skjemainnsending. Lenkene ligger direkte i index.html.
function åpneTilbakemeldingModal() {
  document.getElementById('feedback-modal').style.display = 'flex';
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

  byggKolonner();
  applyLayout();
  settTema(state.tema ?? 'lyst');
  settFont(state.font ?? 'system');
  settSkriftstørrelse(state.skrift_størrelse ?? 'normal');
  applyWidgetStørrelser();
  settOppHendelser();
  settOppRename();
  settOppDragOgDrop();
  renderSiderNav();
  oppdaterKolonneStepper();
}

document.addEventListener('DOMContentLoaded', init);
