'use strict';

// ===================== Constants =====================
// Nøkkelen all tilstand lagres under i localStorage. Endres den, «mister» appen
// gammel lagret data (den finner den ikke igjen) — så la den stå.
const STORAGE_KEY = 'klasserom_state_v1';

// Fargepaletten gruppene tildeles (bakgrunn + tekst), brukt både på gruppe-kort og
// som prikk/farge i elevlista. Det er flere grupper enn farger? Da gjentas paletten.
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

// Visningsnavn for enkeltinstans-widgetene (de som har av/på-avkrysning i ⊞ Widgets).
// Flerinstans-widgetene (notat/bilde) står IKKE her — de håndteres for seg.
const WIDGET_NAVN = {
  'card-elever':     'Elever',
  'card-grupper':    'Grupper',
  'card-tilfeldig':  '🎲 Tilfeldig elev',
  'card-ordenselev': '⭐ Ordenselever',
  'card-ulv':        'Klassebamse',
  'card-timer':      '⏱ Timer',
  'card-dagsplan':   '📋 Dagsplan',
};

// Koordinater for værvarselet (Eidsvoll). Brukes i kallet til met.no.
const VÆR_LAT = 60.33;
const VÆR_LON = 11.22;

// Oversetter en yr.no-symbolkode (f.eks. "clearsky_day") til en passende emoji.
// Sjekkene går fra mest til minst spesifikk; ukjente koder faller tilbake til ☁️.
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

// Norske navn for datoformatering. Rekkefølgen matcher Date: getDay() 0=søndag,
// getMonth() 0=januar.
const UKEDAGER = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const MÅNEDER  = ['januar', 'februar', 'mars', 'april', 'mai', 'juni',
                  'juli', 'august', 'september', 'oktober', 'november', 'desember'];

// ===================== State =====================
// Bygger en helt fersk tilstand for en førstegangsbruker (ingen lagret data).
// Globale felt (deles av alle sider) ligger her; per-side-felt ligger i nySide().
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
    bilder:       { 'bilde-1': {} }, // register over bildekort; selve bildene bor i IndexedDB
    youtube:      {},                // ingen YouTube-kort som standard; legges til via «+»
    notat_teller: 1,
    bilde_teller: 1,
    youtube_teller: 0,
    eksport_signatur: null, // signatur av data ved siste eksport (for endrings-varsel)
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

// Den ene, sentrale tilstanden hele appen leser og skriver. Lastes fra localStorage
// (eller defaults) ved oppstart, og persisteres med saveState() etter hver endring.
let state = loadState();
let værData = null; // siste værsvar fra met.no, delt mellom topptekst og popup

// Timer runtime state (not persisted)
let timerRemaining = state.timer_varighet;
let timerRunning   = false;
let timerInterval  = null;

// Leser lagret tilstand fra localStorage og migrerer eldre dataformater opp til
// dagens struktur (flat state → sider, enkelt-notat → flerinstans osv.). Returnerer
// defaultState() hvis ingenting er lagret eller parsing feiler — appen starter da blank.
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

// Henter side-objektet brukeren ser på nå. Alt «per-side»-innhold (elever, trekk,
// grupper, dagsplan osv.) leses og skrives gjennom denne hjelperen.
function aktivSide() {
  return state.sider[state.aktiv_side ?? 0];
}

// Skriver hele tilstanden til localStorage. Kalles etter HVER mutasjon av `state`,
// ellers går endringen tapt ved neste sideoppfriskning. Oppdaterer også eksport-
// varselet, siden lagret data nå kan avvike fra forrige eksporterte backup.
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('saveState:', e);
  }
  oppdaterEksportVarsel();
}

// ===================== Date / Weather =====================
// Formaterer dagens dato på norsk, f.eks. «mandag 12. mai 2025».
function norskDato() {
  const d = new Date();
  return `${UKEDAGER[d.getDay()]} ${d.getDate()}. ${MÅNEDER[d.getMonth()]} ${d.getFullYear()}`;
}

// Skriver dagens dato inn i toppteksten. Kalles ved oppstart og hvert minutt.
function oppdaterDato() {
  document.getElementById('header-dato').textContent = norskDato();
}

// Henter værvarsel for Eidsvoll fra met.no sitt åpne API og viser temperatur +
// emoji i toppteksten. Svaret lagres i `værData` så vær-popupen kan gjenbruke det.
// met.no krever en identifiserende User-Agent. Feil svelges stille (vær er pynt).
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

// Bygger og åpner/lukker vær-popupen: nåværende forhold pluss de neste 8 timene.
// Bruker det allerede hentede `værData` — gjør ikke nytt nettverkskall.
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
// Legger en elev til den aktive sidens roster. Returnerer true ved suksess, false
// hvis lista er full eller navnet allerede finnes (kaller-koden bruker det til å
// avgjøre om modalen skal lukkes). Re-rendrer elevliste og trekk etterpå.
function leggTilElev(navn) {
  // Trim + gjør første bokstav i hvert ord stor (\b\p{L} = bokstav etter ordgrense,
  // unicode-flagget u trengs for å treffe æ/ø/å). «kari nordmann» → «Kari Nordmann».
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

// Fjerner én elev ved listeindeks fra aktiv side og oppdaterer visningen.
function fjernElev(idx) {
  const s = aktivSide();
  const navn = s.elever[idx];
  if (!navn) return;
  s.elever = s.elever.filter((_, i) => i !== idx);
  saveState();
  renderElever();
  renderAlleTrekk();
}

// Fjerner flere elever på én gang (brukes av «Fjern elever»-modalen).
// fjernSett er et Set av navn som skal ut — gir rask oppslag i filteret.
function fjernEleverBatch(fjernSett) {
  const s = aktivSide();
  s.elever = s.elever.filter(e => !fjernSett.has(e));
  saveState();
  renderElever();
  renderAlleTrekk();
}

// Renser et sett med fjernede elever ut av alle backlogs/valgte-felt på aktiv side,
// så et trekk ikke peker på en elev som ikke lenger er inne.
// MERK: per i dag kalles denne ikke fra noe sted (fjernEleverBatch rydder ikke
// backlogs). Beholdt som hjelper — kan kobles på fjerning hvis det blir aktuelt.
function ryddBackloger(fjernSett) {
  const s = aktivSide();
  s.ordenselev_backlog = s.ordenselev_backlog.filter(e => !fjernSett.has(e));
  s.ordenselev_valgte  = s.ordenselev_valgte.filter(e => !fjernSett.has(e));
  s.ulv_backlog        = s.ulv_backlog.filter(e => !fjernSett.has(e));
  if (s.ulv_valgt && fjernSett.has(s.ulv_valgt)) s.ulv_valgt = null;
  s.tilfeldig_backlog  = s.tilfeldig_backlog.filter(e => !fjernSett.has(e));
  if (s.tilfeldig_valgt && fjernSett.has(s.tilfeldig_valgt)) s.tilfeldig_valgt = null;
}

// Tegner elevlista på nytt: teller, tom-tilstand, og én rad per elev. Elever som
// er fordelt i en gruppe får gruppens farge + en prikk, så listen og gruppe-kortene
// matcher visuelt. Kalles etter enhver endring i roster eller grupper.
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

  // Bygg oppslag: elevnavn → gruppeindeks, så vi raskt kan finne fargen per elev under.
  const gruppeKart = new Map();
  if (s.grupper) {
    s.grupper.forEach((g, gi) => g.forEach(n => gruppeKart.set(n, gi)));
  }

  liste.innerHTML = s.elever.map((navn, i) => {
    const gi        = gruppeKart.get(navn);
    const harGruppe = gi !== undefined;
    const farge     = harGruppe ? GRUPPE_FARGER[gi % GRUPPE_FARGER.length] : null;
    // Eleven som redigeres viser et skrivefelt i stedet for navnet. Enter og «mistet
    // fokus» lagrer, Esc avbryter. Ellers: et klikkbart navn som åpner redigeringen.
    const navnHtml = i === redigerElevIdx
      ? `<input class="elev-rediger-input" type="text" maxlength="60" value="${esc(navn)}"
            onkeydown="if(event.key==='Enter')lagreRedigerElev(${i},this.value);else if(event.key==='Escape')avbrytRedigerElev()"
            onblur="lagreRedigerElev(${i},this.value)">`
      : `<span class="elev-navn"${harGruppe ? ` style="color:${farge.text}"` : ''} onclick="startRedigerElev(${i})" title="Klikk for å redigere">${esc(navn)}</span>`;
    return `
      <div class="elev-item">
        <span class="elev-nr">${i + 1}.</span>
        ${harGruppe ? `<span class="elev-dot" style="background:${farge.text}"></span>` : ''}
        ${navnHtml}
        <button class="elev-slett" onclick="fjernElev(${i})" title="Fjern ${esc(navn)}">✕</button>
      </div>`;
  }).join('');
  // Etter at lista er tegnet: fokuser redigeringsfeltet og marker teksten, så læreren
  // kan skrive rett over eller rette en typo uten å klikke i feltet først.
  if (redigerElevIdx !== null) {
    const inp = liste.querySelector('.elev-rediger-input');
    if (inp) { inp.focus(); inp.select(); }
  }
  oppdaterBegrensningSelecter();
}

// Indeksen til eleven som redigeres inline akkurat nå (null = ingen redigering pågår).
// renderElever leser denne for å bytte navnet ut med et skrivefelt.
let redigerElevIdx = null;

// Starter inline-redigering av elev nr. idx og tegner lista på nytt (renderElever
// fokuserer feltet). Ingen guard her: klikker du rett fra én elev til en annen, har
// blur allerede lagret den forrige.
function startRedigerElev(idx) {
  redigerElevIdx = idx;
  renderElever();
}

// Lagrer et redigert elevnavn. Guarden mot null gjør det andre kallet til en no-op —
// både blur som fyrer rett etter Enter, og blur som fyrer etter at vi alt har avbrutt.
function lagreRedigerElev(idx, verdi) {
  if (redigerElevIdx === null) return;
  redigerElevIdx = null;
  endreElevNavn(idx, verdi);
}

// Avbryter redigeringen uten å lagre og tegner lista tilbake til normal visning.
function avbrytRedigerElev() {
  if (redigerElevIdx === null) return;
  redigerElevIdx = null;
  renderElever();
}

// Endrer navnet på eleven ved idx. Samme normalisering (trim + stor forbokstav) og
// duplikat-sjekk som ved ny elev. Tomt eller uendret navn avbryter stille. Når navnet
// faktisk endres, lar vi det FØLGE MED til grupper, trekk-backlogs og begrensninger
// via byttNavnOveralt — ellers ville de pekt på et navn som ikke lenger finnes i lista.
function endreElevNavn(idx, nyttNavn) {
  const s = aktivSide();
  const gammelt = s.elever[idx];
  if (gammelt === undefined) { renderElever(); return; }
  nyttNavn = nyttNavn.trim().replace(/\b\p{L}/gu, l => l.toUpperCase());
  if (!nyttNavn || nyttNavn === gammelt) { renderElever(); return; }
  if (s.elever.some((e, i) => i !== idx && e.toLowerCase() === nyttNavn.toLowerCase())) {
    notify(`${nyttNavn} er allerede inne`, 'warning');
    renderElever();
    return;
  }
  s.elever = s.elever.map((e, i) => i === idx ? nyttNavn : e);
  byttNavnOveralt(s, gammelt, nyttNavn);
  saveState();
  renderElever();
  renderAlleTrekk();
  renderGrupper();
  renderBegrensninger();
  notify(`✓ Endret til ${nyttNavn}`);
}

// Bytter alle forekomster av et elevnavn på siden: grupper, hver trekk-backlog og
// «valgt»-felt, og hold-fra-hverandre-parene. Kalles når en elev får nytt navn, så
// ingen referanse blir hengende på det gamle navnet.
function byttNavnOveralt(s, gammelt, nytt) {
  const bytt = n => (n === gammelt ? nytt : n);
  if (s.grupper) s.grupper = s.grupper.map(g => g.map(bytt));
  s.tilfeldig_backlog    = (s.tilfeldig_backlog    ?? []).map(bytt);
  if (s.tilfeldig_valgt === gammelt) s.tilfeldig_valgt = nytt;
  s.ordenselev_backlog   = (s.ordenselev_backlog   ?? []).map(bytt);
  s.ordenselev_valgte    = (s.ordenselev_valgte    ?? []).map(bytt);
  s.ulv_backlog          = (s.ulv_backlog          ?? []).map(bytt);
  if (s.ulv_valgt === gammelt) s.ulv_valgt = nytt;
  s.gruppe_begrensninger = (s.gruppe_begrensninger ?? []).map(par => par.map(bytt));
}

// Returnerer en stokket KOPI av arrayet (originalen røres ikke) med Fisher–Yates:
// gå bakfra og bytt hvert element med et tilfeldig element til venstre for det.
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ===================== Draws =====================
// Enkelt tilfeldig trekk: velg én elev. Eneste regel er at man ikke trekker
// samme elev to ganger på rad (med mindre det bare er én elev inne).
function trekkTilfeldig() {
  const s = aktivSide();
  if (!s.elever.length) { notify('Ingen elever inne', 'error'); return; }
  // Utelat forrige trukne fra utvalget, så vi ikke får samme navn igjen umiddelbart.
  const pool = s.elever.length > 1
    ? s.elever.filter(e => e !== s.tilfeldig_valgt)
    : s.elever;
  s.tilfeldig_valgt = pool[Math.floor(Math.random() * pool.length)];
  saveState();
  renderTilfeldig();
}

// «Rettferdig» tilfeldig trekk: hver elev trekkes nøyaktig én gang før noen
// gjentas. Backlogen husker hvem som alt er trukket; når alle er brukt opp må
// læreren nullstille. Forskjellen fra trekkTilfeldig er nettopp denne sporingen.
function trekkTilfeldigBacklog() {
  const s = aktivSide();
  if (!s.elever.length) { notify('Ingen elever inne', 'error'); return; }
  // Trekk kun blant elever som ikke alt står i backlogen.
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

// Trekker TO ordenselever, og sørger for at alle har vært ordenselev før noen
// gjentas (samme backlog-prinsipp som tilfeldig-backlog, men i par).
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

// Trekker hvem som får ta med klassebamsen («ulv») hjem. Backlog sikrer at alle
// får tur før noen gjentas. Navnet på bamsen kan endres per side (s.ulv_navn).
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

// Viser resultatet av tilfeldig-trekket (eller en oppfordring hvis ingen er trukket),
// og en liten teller over hvor mange som ligger i backlogen.
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

// Viser de to trukne ordenselevene (eller en oppfordring), pluss backlog-teller.
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

// Viser hvem som har bamsen, og oppdaterer samtidig kort-tittel og knappetekst til
// sidens valgte bamsenavn (s.ulv_navn) — så «Klassebamse» kan hete hva som helst.
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

// Snarvei: tegn alle tre trekk-widgetene på nytt samtidig (etter f.eks. elevendring).
function renderAlleTrekk() {
  renderTilfeldig();
  renderOrdenselev();
  renderUlv();
}

// ===================== Timer =====================
// Hovedknappen for timeren med tre tilstander avhengig av hvor vi er:
//  - tiden er ute  → nullstill til full varighet (knappen blir «start på nytt»)
//  - kjører        → pause (stopp intervallet)
//  - pauset/klar   → start (tikk hvert sekund via setInterval)
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

// Kjøres én gang i sekundet mens timeren går. Teller ned, og når den treffer 0:
// stopp intervallet, varsle og spill en pip. Ellers bare dekrementer og re-render.
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

// Stopper timeren og setter gjenstående tid tilbake til valgt varighet.
function timerReset() {
  timerRunning   = false;
  clearInterval(timerInterval);
  timerInterval  = null;
  timerRemaining = state.timer_varighet;
  renderTimer();
}

// Setter ny timer-varighet (i minutter → sekunder), stopper og nullstiller.
// timer_varighet er global (lagres), så valget huskes på tvers av sider og økter.
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

// Oppdaterer hele timer-visningen: tallene (MM:SS), framdriftsbjelken, statustekst
// og toggle-knappens utseende — alt avledet av timerRemaining og timerRunning.
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

// Spiller en kort pipetone via Web Audio når timeren er ute — uten lydfil. Lager en
// 880 Hz sinus som toner ut over 1,4 sek (exponentialRamp gir et naturlig «fade»).
// Pakket i try/catch fordi AudioContext kan være blokkert i enkelte nettlesere.
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
// Lar notat-feltet vokse med innholdet: nullstill høyden, les så scrollHeight
// (full innholdshøyde) og sett den som fast høyde. Unngår indre scrollbar.
function autoResizeNotat(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

// Bygger DOM-en for ett notat-kort (uten å sette den inn i siden). Notat er en
// flerinstans-widget, så all id-bruk bakes med instansId (f.eks. «notat-2»).
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

// Kobler et nylig innsatt notat-kort til tilstanden: fyll inn lagret tekst, koble
// kursiv-knappen, og lagre tekstendringer. Lagringen er debouncet (500 ms etter
// siste tastetrykk) så vi ikke skriver til localStorage på hvert eneste tegn.
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

// Oppretter et nytt, tomt notat-kort på aktiv side: bump telleren for en unik id,
// registrer i state, bygg og sett inn DOM-en, og koble opp drag + layout på nytt.
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

// Fjerner et notat-kort fra DENNE siden. Selve notat-dataene slettes kun hvis ingen
// andre sider også bruker kortet — ellers ville vi slette innhold som er synlig et
// annet sted. (Samme mønster som fjernBildeWidget.)
function fjernNotat(instansId) {
  const cardId = `card-${instansId}`;
  const side = aktivSide();
  side.widget_layout = side.widget_layout.filter(w => w.id !== cardId);
  side.widget_hidden  = (side.widget_hidden ?? []).filter(id => id !== cardId);
  // Sjekk om noen side fortsatt har dette kortet i sin layout før vi sletter dataene.
  const ingenSiderBrukerDen = state.sider.every(s => !s.widget_layout.some(w => w.id === cardId));
  if (ingenSiderBrukerDen) {
    delete state.notater[instansId];
    document.getElementById(cardId)?.remove();
  }
  renderWidgetMeny();
  saveState();
}

// ===================== Dagsplan =====================
// Legger til ett punkt i dagsplanen. Hvert punkt er { tekst, ferdig } — ferdig
// styrer overstrekingen i visningen.
function leggTilDagsplan(tekst) {
  aktivSide().dagsplan.push({ tekst, ferdig: false });
  saveState();
  renderDagsplan();
}

// Fjerner ett dagsplan-punkt ved indeks.
function fjernDagsplan(idx) {
  aktivSide().dagsplan.splice(idx, 1);
  saveState();
  renderDagsplan();
}

// Krysser av / fjerner avkryssing på et dagsplan-punkt (klikk på raden).
function toggleDagsplanFerdig(idx) {
  const p = aktivSide().dagsplan[idx];
  if (!p) return;
  p.ferdig = !p.ferdig;
  saveState();
  renderDagsplan();
}

// Indeksen til dagsplan-punktet som redigeres inline (null = ingen redigering pågår).
let redigerDagsplanIdx = null;

// Starter inline-redigering av dagsplan-punkt nr. idx.
function startRedigerDagsplan(idx) {
  redigerDagsplanIdx = idx;
  renderDagsplan();
}

// Lagrer redigert dagsplan-tekst. Tom eller uendret tekst lar punktet stå urørt.
// Guarden mot null gjør det andre kallet (blur rett etter Enter) til en no-op.
function lagreRedigerDagsplan(idx, verdi) {
  if (redigerDagsplanIdx === null) return;
  redigerDagsplanIdx = null;
  const tekst = verdi.trim();
  const p = aktivSide().dagsplan[idx];
  if (p && tekst && tekst !== p.tekst) { p.tekst = tekst; saveState(); }
  renderDagsplan();
}

// Avbryter redigeringen uten å lagre.
function avbrytRedigerDagsplan() {
  if (redigerDagsplanIdx === null) return;
  redigerDagsplanIdx = null;
  renderDagsplan();
}

// Tegner dagsplanen på nytt. Prikken (●) toggler ferdig, teksten åpner inline-
// redigering, og ✕ fjerner punktet — tre adskilte klikkmål på samme rad. Punktet som
// redigeres viser et skrivefelt i stedet for teksten.
function renderDagsplan() {
  const dagsplan = aktivSide().dagsplan;
  const liste = document.getElementById('dagsplan-liste');
  if (!dagsplan.length) {
    liste.innerHTML = '<p class="tom-tekst" style="padding:4px">Tom — trykk "+ Legg til punkt"</p>';
    return;
  }
  liste.innerHTML = dagsplan.map((p, i) => {
    const innhold = i === redigerDagsplanIdx
      ? `<input class="dagsplan-rediger-input" type="text" maxlength="80" value="${esc(p.tekst)}"
            onkeydown="if(event.key==='Enter')lagreRedigerDagsplan(${i},this.value);else if(event.key==='Escape')avbrytRedigerDagsplan()"
            onblur="lagreRedigerDagsplan(${i},this.value)">`
      : `<span class="dagsplan-tekst" onclick="startRedigerDagsplan(${i})" title="Klikk for å redigere">${esc(p.tekst)}</span>`;
    return `
    <div class="dagsplan-item${p.ferdig ? ' ferdig' : ''}" data-idx="${i}">
      <span class="dagsplan-prikk" onclick="toggleDagsplanFerdig(${i})" title="Marker ferdig">●</span>
      ${innhold}
      <button class="dagsplan-slett" onclick="fjernDagsplan(${i})" title="Fjern">✕</button>
      <span class="dagsplan-handle" title="Dra for å endre rekkefølge">⠿</span>
    </div>`;
  }).join('');
  // Fokuser og marker skrivefeltet når et punkt redigeres.
  if (redigerDagsplanIdx !== null) {
    const inp = liste.querySelector('.dagsplan-rediger-input');
    if (inp) { inp.focus(); inp.select(); }
  }
}

// Flytter et dagsplan-punkt fra indeks `fra` til indeks `til` (innsettings-punktet
// regnet ut fra musa). Samme indeks-justering som widget-DnD-en: når vi flytter et
// punkt framover, forskyver fjerningen alle senere indekser ett hakk ned.
function flyttDagsplan(fra, til) {
  const dagsplan = aktivSide().dagsplan;
  if (fra === til || fra == null) { renderDagsplan(); return; }
  const [punkt] = dagsplan.splice(fra, 1);
  if (til > fra) til--;
  dagsplan.splice(til, 0, punkt);
  saveState();
  renderDagsplan();
}

// Kobler dra-og-slipp for å endre rekkefølgen på dagsplan-punkter. Vi bruker IKKE
// native HTML5-drag (drag-spøkelset rendres av nettleseren/OS og var upålitelig — det
// fulgte ikke musa). I stedet styrer vi alt selv med Pointer Events: når man tar tak i
// ⠿-håndtaket lager vi en flytende KOPI av raden som følger pekeren, dimmer originalen
// på plass, og viser en blå strek der punktet havner. Lytterne kobles opp én gang fra
// init — pointerdown er delegert på den faste containeren, move/up ligger på document
// (med peker-fangst) så draget følges selv om pekeren forlater raden.
function setupDagsplanDrag() {
  const liste = document.getElementById('dagsplan-liste');
  if (!liste) return;

  let dragIdx = null;       // indeks for punktet som dras (null = ingen drag)
  let draget = null;        // den ekte rad-noden (dimmes på plass mens kopien flyr)
  let klone = null;         // flytende kopi som følger pekeren
  let indikator = null;     // blå slipp-strek
  let pekerId = null;
  let grepX = 0, grepY = 0; // pekerens offset inni raden da man tok tak
  let startX = 0, startY = 0;
  let aktiv = false;        // har pekeren flyttet seg nok til at draget «teller»?

  // Ta tak: bare på håndtaket, så klikk (prikk/tekst/✕) og inline-redigering er fri.
  liste.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const handle = e.target.closest('.dagsplan-handle');
    if (!handle) return;
    const item = handle.closest('.dagsplan-item');
    if (!item) return;
    e.preventDefault();
    const rect = item.getBoundingClientRect();
    dragIdx = Number(item.dataset.idx);
    draget  = item;
    grepX = e.clientX - rect.left;
    grepY = e.clientY - rect.top;
    startX = e.clientX; startY = e.clientY;
    aktiv = false;
    pekerId = e.pointerId;
    // Peker-fangst holder draget i gang om pekeren forlater vinduet. En bonus, ikke et
    // krav (document-lytterne fanger resten), så vi lar det ikke velte noe om det feiler.
    try { handle.setPointerCapture(pekerId); } catch {}
  });

  document.addEventListener('pointermove', e => {
    if (dragIdx === null || e.pointerId !== pekerId) return;
    // Liten terskel før draget starter — så et lite skjelv ikke flytter noe.
    if (!aktiv) {
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < 4) return;
      startDrag();
    }
    klone.style.left = (e.clientX - grepX) + 'px';
    klone.style.top  = (e.clientY - grepY) + 'px';
    plasserIndikator(e.clientY);
  });

  document.addEventListener('pointerup', e => {
    if (dragIdx === null || e.pointerId !== pekerId) return;
    const fra = dragIdx;
    const til = aktiv ? dropPosisjon(e.clientY, fra) : null;
    avslutt();
    if (til !== null) flyttDagsplan(fra, til);
  });

  document.addEventListener('pointercancel', e => {
    if (dragIdx === null || e.pointerId !== pekerId) return;
    avslutt();
  });

  // Bygg den flytende kopien og dim originalen. Kjøres når terskelen er krysset.
  // VIKTIG: klon FØR vi dimmer originalen — ellers arver kopien dimme-klassen
  // (.dagsplan-dragging, opacity 0.45) og blir nesten usynlig.
  function startDrag() {
    aktiv = true;
    const rect = draget.getBoundingClientRect();
    klone = draget.cloneNode(true);
    klone.classList.add('dagsplan-klone');
    klone.classList.remove('dagsplan-dragging'); // sikring om originalen alt var dimmet
    klone.style.width = rect.width + 'px';
    klone.style.left  = rect.left + 'px';
    klone.style.top   = rect.top + 'px';
    document.body.appendChild(klone);
    draget.classList.add('dagsplan-dragging');   // dim originalen ETTER kloning
    document.body.style.userSelect = 'none';
    indikator = document.createElement('div');
    indikator.className = 'dagsplan-drop-indikator';
  }

  // Sett slipp-streken foran det første punktet pekeren er over øvre halvdel av (hopp
  // over punktet som dras). Ingen treff → legg den nederst.
  function plasserIndikator(clientY) {
    const ref = [...liste.querySelectorAll('.dagsplan-item')]
      .filter(it => Number(it.dataset.idx) !== dragIdx)
      .find(it => { const r = it.getBoundingClientRect(); return clientY < r.top + r.height / 2; }) ?? null;
    if (ref) liste.insertBefore(indikator, ref);
    else liste.appendChild(indikator);
  }

  // Innsettings-indeksen ut fra pekerens y. Punktet som dras (hopp) telles ikke med.
  function dropPosisjon(clientY, hopp) {
    let insertAt = aktivSide().dagsplan.length;
    for (const it of liste.querySelectorAll('.dagsplan-item')) {
      const idx = Number(it.dataset.idx);
      if (idx === hopp) continue;
      const r = it.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) { insertAt = idx; break; }
    }
    return insertAt;
  }

  function avslutt() {
    if (klone) { klone.remove(); klone = null; }
    if (indikator) { indikator.remove(); indikator = null; }
    if (draget) { draget.classList.remove('dagsplan-dragging'); draget = null; }
    document.body.style.userSelect = '';
    dragIdx = null; pekerId = null; aktiv = false;
  }
}

// ===================== Grupper =====================
// Deler elevene inn i `antall` tilfeldige grupper, og respekterer «hold fra hverandre»-
// begrensninger (par som ikke skal havne sammen). Vi har ingen smart løser: vi stokker
// og fordeler reihum, og prøver inntil 200 ganger til vi treffer et oppsett som ikke
// bryter noen begrensning. Klarer vi ikke det, sier vi fra i stedet for å bryte reglene.
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
    // Del ut elevene reihum (i % antall) — gir jevnest mulig gruppestørrelse.
    shufflet.forEach((e, i) => kandidat[i % antall].push(e));
    // Godkjenn kun hvis ingen gruppe inneholder begge i et forbudt par.
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

// Sletter den aktive gruppeinndelingen og oppdaterer både gruppe- og elevvisning
// (elevlista mister da fargemarkeringen sin).
function fjernGrupper() {
  aktivSide().grupper = null;
  saveState();
  renderGrupper();
  renderElever();
}

// Tegner gruppe-kortene, ett per gruppe, med en fast farge fra GRUPPE_FARGER
// (modulo, så det går rundt hvis det er flere grupper enn farger).
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
// Lagrer aktiv sides roster som en navngitt liste. Listene er GLOBALE (deles av alle
// sider), mens selve rosteren er per side — derfor kopierer vi navnene ut hit.
function lagreListe(navn) {
  const s = aktivSide();
  if (!s.elever.length) { notify('Ingen elever inne å lagre', 'warning'); return false; }
  const erNy = !state.lister[navn];
  state.lister[navn] = [...s.elever]; // lagrede lister er globale; rosteren er per side
  saveState();
  notify(`📋 '${navn}' ${erNy ? 'lagret' : 'oppdatert'} (${s.elever.length} elever)`);
  return true;
}

// Laster en lagret liste inn i aktiv sides roster. Overskriver dagens roster og
// nullstiller grupper (de hører til den gamle elevsammensetningen).
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

// Sletter en lagret liste (påvirker ikke rosteren som allerede er lastet inn).
function slettListe(navn) {
  delete state.lister[navn];
  saveState();
  notify(`🗑️ '${navn}' slettet`);
  renderListerModal();
}

// Tegner innholdet i «Lagrede lister»-modalen: én rad per liste med antall elever
// og en slett-knapp. Klikk på raden laster lista; slett-knappen stopper propagering.
function renderListerModal() {
  const innhold = document.getElementById('lister-innhold');
  const poster  = Object.entries(state.lister);
  if (!poster.length) {
    innhold.innerHTML = '<p class="tom-tekst" style="padding:12px">Ingen lagrede lister ennå.</p>';
    return;
  }
  innhold.innerHTML = `<div class="modal-list">
    ${poster.map(([navn, elever]) => {
      // Listenavnet havner inne i en inline onclick="lastListe(…)". JSON.stringify gir
      // korrekt JS-streng (escaper anførselstegn/spesialtegn), og vi bytter " → &quot;
      // så den trygt kan stå inni HTML-attributtet uten å bryte det.
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
// Plasserer hvert widget-kort i riktig kolonne for aktiv side, og skjuler dem som
// står i widget_hidden. Kjøres ved sidebytte, drag-slipp og widget-endringer.
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

// Bygger innholdet i ⊞ Widgets-nedtrekket: av/på-avkrysning for enkeltinstans-
// widgets, og «+»-knapper for å legge til flere notat-/bilde-kort (med antall vist).
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
  const antNotat   = aktivIds.filter(id => id.startsWith('card-notat-')).length;
  const antBilde   = aktivIds.filter(id => id.startsWith('card-bilde-')).length;
  const antYoutube = aktivIds.filter(id => id.startsWith('card-youtube-')).length;
  const leggTil = `
    <div class="widget-meny-sep"></div>
    <div class="widget-meny-tittel">Legg til flere</div>
    <div class="widget-meny-rad" style="gap:6px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" onclick="leggTilNotat()">+ 📝 Notat${antNotat ? ` (${antNotat})` : ''}</button>
      <button class="btn btn-ghost btn-sm" onclick="leggTilBilde()">+ 🖼 Bilde${antBilde ? ` (${antBilde})` : ''}</button>
      <button class="btn btn-ghost btn-sm" onclick="leggTilYoutube()">+ ▶️ YouTube${antYoutube ? ` (${antYoutube})` : ''}</button>
    </div>`;

  dropdown.innerHTML = statiske + leggTil;
}

// Skrur en widget av/på for aktiv side ved å legge id-en til eller fjerne den fra
// widget_hidden. Posisjonen i widget_layout beholdes, så kortet kommer tilbake der
// det var når det slås på igjen.
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

// Kobler mousedown på hvert kolonne-håndtak til startResize (kjøres etter byggKolonner).
function settOppResizers() {
  document.querySelectorAll('.kl-col-resizer').forEach(r => {
    r.onmousedown = e => startResize(e, r);
  });
}

// Drar grensen mellom to nabokolonner. Vi jobber i flex-vekter (ikke piksler): de
// to kolonnene deler en fast sum av vekt, og vi flytter vekt mellom dem etter hvor
// langt musa dras — med en minstebredde (MIN_KOL_PX) så ingen kolonne kollapser.
// onMove kjører mens musa holdes nede; onUp rydder opp og lagrer de nye breddene.
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

// Øker eller minker antall kolonner på aktiv side med `delta` (±1), klampet til
// [MIN_KOL, MAKS_KOL]. Ved færre kolonner flyttes kort fra fjernede kolonner inn
// i den siste gjenværende, så ingen widget blir hjemløs.
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

// Oppdaterer kolonne-tellerens visning og deaktiverer +/− når man er på grensen.
function oppdaterKolonneStepper() {
  const n = aktivSide().kolonner ?? 3;
  const tall = document.getElementById('kol-antall');
  if (tall) tall.textContent = n;
  const minus = document.getElementById('btn-kol-minus');
  const pluss = document.getElementById('btn-kol-pluss');
  if (minus) minus.disabled = n <= MIN_KOL;
  if (pluss) pluss.disabled = n >= MAKS_KOL;
}

// Finner hvilket kolonnenummer musas x-posisjon er over (brukes under drag-slipp).
// Returnerer første kolonne der musa er til venstre for kolonnens høyre kant.
function kolonneFraMus(clientX) {
  const wrappers = document.querySelectorAll('.col-wrapper');
  for (const w of wrappers) {
    const rect = w.getBoundingClientRect();
    if (clientX <= rect.right) return Number(w.dataset.col);
  }
  return aktivSide().kolonner ?? 3;
}

// Regner ut hvilken indeks i widget_layout et kort som slippes skal settes inn på,
// ut fra musas y-posisjon i målkolonnen: vi setter inn foran det første kortet som
// musa er over øvre halvdel av. Kortet som dras (dragId) hoppes over.
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

// Setter opp dra-og-slipp for å flytte widget-kort mellom kolonner. Kort er bare
// draggable mens man holder i drag-håndtaket (⠿) — ellers ville tekstmarkering og
// klikk inni kortene starte en dragging. Under dragover vises en innsettings-
// indikator; ved drop oppdateres widget_layout og layouten tegnes på nytt.
// Kalles på nytt hver gang nye kort opprettes, så de også blir dragbare.
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

    // Fjern kortet fra sin gamle plass, sett det inn på den nye. Når vi flytter
    // framover i lista forskyver fjerningen alle senere indekser ett hakk ned,
    // så vi justerer målindeksen tilsvarende.
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
// Manuell dobbeltklikk-deteksjon: fanene bygges på nytt ved hvert klikk
// (byttSide → renderSiderNav), så de to klikkene i et dobbeltklikk lander på
// ulike DOM-noder og nettleserens dblclick-event fyrer ikke pålitelig. Vi måler
// derfor selv tiden mellom to klikk på samme fane — andre klikk åpner omdøping.
let sisteSideKlikk = { idx: -1, tid: 0 };
function håndterSideKlikk(idx) {
  const nå = Date.now();
  if (sisteSideKlikk.idx === idx && nå - sisteSideKlikk.tid < 400) {
    sisteSideKlikk = { idx: -1, tid: 0 };
    startSideRename(idx);
  } else {
    sisteSideKlikk = { idx, tid: nå };
    byttSide(idx);
  }
}

// Tegner fane-raden for sidene: én knapp per side (aktiv side markert), en ✕ for å
// slette (vises kun når det finnes mer enn én side), og en «+» for å legge til side.
function renderSiderNav() {
  const nav = document.getElementById('sider-nav');
  if (!nav) return;
  nav.innerHTML = '';
  state.sider.forEach((side, idx) => {
    const btn = document.createElement('button');
    btn.className = 'side-tab' + (idx === state.aktiv_side ? ' aktiv' : '');
    btn.textContent = side.navn;
    btn.onclick = () => håndterSideKlikk(idx);
    btn.title = 'Dobbeltklikk for å gi nytt navn';
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

// Inline omdøping: dobbeltklikk på en fane bytter den til et tekstfelt.
// Enter / klikk utenfor lagrer, Esc avbryter, tomt navn beholder det gamle.
function startSideRename(idx) {
  const nav = document.getElementById('sider-nav');
  // Klikkene som inngår i dobbeltklikket har allerede kjørt byttSide() →
  // renderSiderNav(), så den opprinnelige fane-knappen er løsrevet fra DOM.
  // Finn derfor den LEVENDE fanen på nytt før vi bytter den ut med tekstfeltet.
  const tab = nav && nav.children[idx];
  if (!tab) return;
  const input = document.createElement('input');
  input.className = 'side-tab-input';
  input.value = state.sider[idx].navn;
  input.maxLength = 30;
  tab.replaceWith(input);
  input.focus();
  input.select();
  let ferdig = false;
  const avslutt = lagre => {
    if (ferdig) return;
    ferdig = true;
    if (lagre) {
      const nytt = input.value.trim();
      if (nytt) { state.sider[idx].navn = nytt; saveState(); }
    }
    renderSiderNav();
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); avslutt(true); }
    if (e.key === 'Escape') { e.preventDefault(); avslutt(false); }
  });
  input.addEventListener('blur', () => avslutt(true));
}

// Bytter til side `idx`: setter aktiv side, bygger kolonnene på nytt og re-rendrer
// ALT per-side-innhold for den nye siden. Timeren røres ikke — den er global.
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

// Oppretter en ny, tom side og bytter til den. Den får egne notat- og bilde-
// instanser (ellers ville den delt innhold med side 1), og starter med alle widgets
// skjult — læreren henter fram det hun trenger via ⊞ Widgets.
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
  // Ny side starter tom: alle widgets skjules som default. Læreren henter dem
  // fram igjen via ⊞ Widgets-menyen. widget_layout beholdes intakt så posisjonene
  // huskes når et kort slås på igjen.
  side.widget_hidden = side.widget_layout.map(w => w.id);
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

// Sletter en side. Siste side kan ikke slettes (det må alltid finnes minst én).
// Etterpå byttes det til en gyldig nabo-side, som re-rendrer alt.
function fjernSide(idx) {
  if (state.sider.length <= 1) return;
  state.sider.splice(idx, 1);
  // byttSide lagrer og re-rendrer alt (kolonner + per-side data) for den nye aktive siden
  byttSide(Math.min(state.aktiv_side, state.sider.length - 1));
}

// ===================== Reset =====================
// Hver nullstill*-funksjon tømmer ett enkelt trekk/widget på aktiv side: tøm
// valgt + backlog, lagre, tegn på nytt og varsle. Brukes fra Nullstill-modalen.
function nullstillTilfeldig()   { const s = aktivSide(); s.tilfeldig_valgt = null; s.tilfeldig_backlog = []; saveState(); renderTilfeldig(); notify('🎲 Tilfeldig-trekk nullstilt'); }
function nullstillOrdenselev()  { const s = aktivSide(); s.ordenselev_valgte = []; s.ordenselev_backlog = []; saveState(); renderOrdenselev(); notify('⭐ Ordenselever-trekk nullstilt'); }
function nullstillUlv()         { const s = aktivSide(); s.ulv_valgt = null; s.ulv_backlog = []; saveState(); renderUlv(); notify('🐺 Ulv-trekk nullstilt'); }
// Tømmer teksten i ALLE notat-kort (ikke bare aktiv side, siden notater er globale).
// Må også nullstille de synlige tekstfeltene + krympe dem, ikke bare state.
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
// Ferdig HTML som vises i info-modalen via åpneInfoModal(). Disse to strengene er
// «innholdet» bak Klasserom-menyens to lenker. NB (se CLAUDE.md): når en brukersynlig
// funksjon endres, skal OPPDATERINGSLOGG_HTML og BRUKERVEILEDNING_HTML oppdateres i
// samme commit. Nyeste versjonsblokk legges øverst.
const OPPDATERINGSLOGG_HTML = `
  <div class="logg-entry">
    <div class="logg-versjon">v2.17</div>
    <div class="logg-dato">9. juni 2026</div>
    <ul>
      <li><strong>Volum­kontroll i kun lyd-modus:</strong> YouTube-kort i <strong>🎵 Kun lyd</strong> har nå en volum­glider ved siden av play-knappen. Volumet huskes til neste gang</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v2.16</div>
    <div class="logg-dato">8. juni 2026</div>
    <ul>
      <li><strong>Ny YouTube-widget:</strong> legg til så mange YouTube-kort du vil via <strong>⊞ Widgets → + ▶️ YouTube</strong>. Lim inn en YouTube-lenke, så spilles videoen rett i kortet</li>
      <li><strong>Kun lyd-modus:</strong> bytt et YouTube-kort til <strong>🎵 Kun lyd</strong> — bildet skjules og du får en kompakt play/pause-linje. Perfekt for bakgrunnsmusikk eller lydklipp uten at videoen tar plass</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v2.15</div>
    <div class="logg-dato">8. juni 2026</div>
    <ul>
      <li><strong>Mye større bilder:</strong> grensa er hevet fra 2 MB til <strong>50 MB</strong> per bilde. Bilder lagres nå i nettleserens IndexedDB i stedet for det vesle localStorage-lageret — mer plass, og de stjeler ikke lenger plass fra sider, elever og notater</li>
      <li>Eksisterende bilder flyttes automatisk over til det nye lageret første gang du åpner appen — du trenger ikke gjøre noe</li>
      <li>Backup-fila (eksporter/importer) virker som før og er kryss-kompatibel med eldre versjoner</li>
      <li>(Teknisk: åpner du appen som en lokal fil i en Firefox-basert nettleser, faller bildene tilbake til 2 MB — på den nettpubliserte versjonen gjelder alltid 50 MB)</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v2.14</div>
    <div class="logg-dato">8. juni 2026</div>
    <ul>
      <li><strong>Endre rekkefølge i dagsplanen:</strong> hold inne dra-håndtaket <strong>⠿</strong> helt til høyre på et punkt (dukker opp når du holder musa over raden) og dra punktet opp eller ned. En blå strek viser hvor det havner</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v2.13</div>
    <div class="logg-dato">8. juni 2026</div>
    <ul>
      <li><strong>Rediger elever og dagsplan-punkter med ett klikk:</strong> klikk på et elevnavn eller en dagsplan-tekst for å rette den direkte i lista. <kbd>Enter</kbd> lagrer, <kbd>Esc</kbd> avbryter</li>
      <li>Endrer du et elevnavn, følger det automatisk med til grupper, trekk-backlogs og gruppebegrensninger — ingenting blir hengende på det gamle navnet</li>
      <li>I dagsplanen markerer du nå et punkt som ferdig ved å klikke på <strong>prikken</strong> (●) — teksten er reservert for redigering</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v2.12</div>
    <div class="logg-dato">2. juni 2026</div>
    <ul>
      <li>Varselet <strong>«● Ueksporterte endringer»</strong> ligger nå nederst, rett over hurtigtast-baren — der blikket havner når du er ferdig for dagen — i stedet for oppe i toppen</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v2.11</div>
    <div class="logg-dato">30. mai 2026</div>
    <ul>
      <li>At man nå kan gi hver side sitt eget navn ved å dobbeltklikke på fanen (f.eks. «1A» eller «Mattegruppe»)</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v2.10</div>
    <div class="logg-dato">30. mai 2026</div>
    <ul>
      <li>Appen har fått sitt eget faneikon (🏫) som vises i nettleserfanen — lettere å kjenne den igjen blant mange åpne faner</li>
      <li>Nye sider starter nå helt tomme — ingen kort er synlige fra start. Du henter selv fram akkurat de widgetene du vil ha via <strong>⊞ Widgets</strong>-menyen</li>
    </ul>
  </div>
  <div class="logg-entry">
    <div class="logg-versjon">v2.9</div>
    <div class="logg-dato">30. mai 2026</div>
    <ul>
      <li><strong>📤 Eksporter data</strong> i Klasserom-menyen lagrer alt — klasselister, sider (med elever, grupper, trekk-backlogs og begrensninger), innstillinger, notater og bilder — til én backup-fil på maskinen din</li>
      <li><strong>📥 Importer data</strong> henter alt tilbake fra en slik fil. Du kan enten erstatte alt, eller bare slå sammen de lagrede klasselistene (nyttig for å dele lister mellom lærere)</li>
      <li>Et lite varsel <strong>«● Ueksporterte endringer»</strong> dukker opp når du har laget nye lister eller endret backlog siden forrige eksport. Klikk på det for å ta en ny backup</li>
    </ul>
  </div>
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

// Brukerveiledningen som vises i info-modalen (se note over OPPDATERINGSLOGG_HTML).
const BRUKERVEILEDNING_HTML = `
  <h4>Sider — ett arbeidsbord per klasse</h4>
  <p>Klikk <strong>+</strong> i midten av headeren for å legge til en ny side, klikk på et sidenavn for å bytte, og <strong>✕</strong> på en fane for å slette. Tanken er at <strong>hver side er sin egen klasse</strong>: lag side 1 for 1A og side 2 for 1B, og bytt fritt mellom dem gjennom dagen uten at noe blandes.</p>
  <p><strong>Gi en side nytt navn</strong> ved å dobbeltklikke på fanen. Da blir den til et lite skrivefelt — skriv inn navnet (f.eks. «1A» eller «Mattegruppe») og trykk <kbd>Enter</kbd> for å lagre. <kbd>Esc</kbd> avbryter uten å endre navnet.</p>
  <p><strong>Per side</strong> (egen for hver klasse): elevlisten, grupper, alle trekk og backlogs (tilfeldig/ordenselev/klassebamse), dagsplanen, gruppebegrensninger, klassebamsens navn — pluss kolonneoppsett, notater og bilder.</p>
  <p><strong>Delt mellom alle sider:</strong> lagrede klasselister (📋 Lister — et felles bibliotek du kan laste inn i hvilken som helst side), tema, font, skriftstørrelse og timeren.</p>
  <p>Timeren er felles og fortsetter å gå selv om du bytter side. Vil du f.eks. vise et bilde på en egen side mens nedtellingen ruller, går det helt fint — timeren teller videre i bakgrunnen.</p>
  <p>En <strong>ny side starter helt tom</strong> — ingen kort er synlige ennå. Du henter selv fram akkurat de kortene du vil ha via <strong>⊞ Widgets</strong>-menyen, så hver side blir nøyaktig slik du ønsker den. (Side 1 beholder sitt vanlige oppsett.)</p>

  <h4>Kom i gang</h4>
  <p>Trykk <strong>+ Legg til elev</strong> (eller tasten <kbd>a</kbd>) for å legge inn elevene i klassen din. Du kan ha opptil 35 elever inne samtidig.</p>
  <p><strong>Rette et navn:</strong> klikk rett på elevnavnet i lista — det blir til et lite skrivefelt. Rett opp og trykk <kbd>Enter</kbd> for å lagre, eller <kbd>Esc</kbd> for å avbryte. Endrer du navnet, oppdateres det automatisk overalt eleven er brukt — i grupper, trekk-backlogs og gruppebegrensninger. (Vil du fjerne eleven i stedet, bruk <strong>✕</strong> til høyre.)</p>
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
  <p>Hvert punkt har tre klikkmål: <strong>prikken</strong> (●) markerer punktet ferdig — den blir grønn og teksten får en strek over (klikk igjen for å angre). <strong>Teksten</strong> åpner redigering — klikk på den, rett opp og trykk <kbd>Enter</kbd> for å lagre eller <kbd>Esc</kbd> for å avbryte. <strong>✕</strong> fjerner punktet.</p>
  <p><strong>Endre rekkefølge:</strong> hold inne dra-håndtaket <strong>⠿</strong> helt til høyre på punktet (vises når du holder musa over raden) og dra det opp eller ned. En blå strek viser hvor punktet havner når du slipper.</p>

  <h4>🖼 Bilde-widget</h4>
  <p>Klikk på bilde-kortet for å velge en bildefil fra datamaskinen (maks 50 MB). Du kan også lime inn et bilde direkte med <kbd>Ctrl+V</kbd> (f.eks. et skjermbilde) — klikk først på kortet du vil lime inn i. Bildet lagres i nettleseren (IndexedDB) og vises igjen ved neste besøk. Trykk <strong>Fjern bilde</strong> for å slette bildeinnholdet.</p>
  <p>Du kan ha <strong>flere bildekort</strong>: åpne <strong>⊞ Widgets</strong>-menyen og klikk <strong>+ Bilde</strong>. Slett et bildekort med <strong>✕</strong> i kortets øverste høyre hjørne. Bildekort er per side — forskjellige sider har forskjellige bilder.</p>

  <h4>▶️ YouTube-widget</h4>
  <p>Legg til et YouTube-kort via <strong>⊞ Widgets</strong>-menyen og <strong>+ ▶️ YouTube</strong>. Lim inn en YouTube-lenke (vanlig lenke, <em>youtu.be</em> eller <em>Shorts</em> funker alle) og trykk <strong>Vis</strong> — videoen spilles rett i kortet.</p>
  <p><strong>🎵 Kun lyd:</strong> bytt mellom <strong>▶ Video</strong> og <strong>🎵 Kun lyd</strong> øverst i kortet. I lyd-modus skjules bildet og du får en liten play/pause-linje med en <strong>volum­glider</strong> (🔊) til høyre — fint for bakgrunnsmusikk eller et lydklipp uten at videoen tar plass. Volumet du stiller inn huskes til neste gang. Lyden spiller videre uavbrutt når du bytter modus. Trykk <strong>↻</strong> for å bytte til en annen lenke, og <strong>✕</strong> for å slette kortet.</p>
  <p>Du kan ha <strong>flere YouTube-kort</strong>, og de er per side som de andre widgetene.</p>

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
  <p>Alt lagres automatisk i nettleseren din (localStorage). Ingenting sendes til internett — data er kun på din maskin. Ulike nettlesere eller private vinduer har separate lagre.</p>

  <h4>📤 Eksportere og 📥 importere data</h4>
  <p>Siden data kun bor i nettleseren din, er det lurt å ta en <strong>backup</strong>. Åpne <strong>Klasserom-menyen</strong> og velg <strong>📤 Eksporter data</strong> — da lastes det ned én fil som inneholder alt: klasselister, alle sider (med elever, grupper, trekk-backlogs og begrensninger), innstillinger, notater og bilder.</p>
  <p>For å hente data tilbake — eller flytte alt til en annen maskin eller nettleser — velg <strong>📥 Importer data</strong> og pek på fila. Du får velge mellom <strong>«Erstatt alt»</strong> (full gjenoppretting som overskriver det som ligger der nå) og <strong>«Slå sammen kun klasselister»</strong> (behold alt ditt, men hent inn de lagrede listene fra fila — fint for å dele klasselister mellom lærere).</p>
  <p>Når du har laget nye lister eller endret en backlog siden forrige eksport, dukker det opp et lite <strong>«● Ueksporterte endringer»</strong>-merke nederst, rett over hurtigtast-baren. Klikk på det for å ta en ny backup. Tips: eksporter med jevne mellomrom, så er du trygg om nettleserdata skulle bli tømt.</p>`;

// Åpner info-overlayet med gitt tittel og ferdig HTML-innhold (logg eller guide).
function åpneInfoModal(tittel, innholdHtml) {
  document.getElementById('info-modal-tittel').textContent = tittel;
  document.getElementById('info-modal-innhold').innerHTML = innholdHtml;
  document.getElementById('info-overlay').classList.remove('hidden');
}

// Lukker info-overlayet.
function lukkInfoModal() {
  document.getElementById('info-overlay').classList.add('hidden');
}

// ===================== Modals =====================
let aktivModal = null;

// Åpner modalen med gitt id: vis overlayet, skjul alle modaler og vis kun den ene.
// Husker hvilken som er åpen i `aktivModal` (brukes av Esc-tasten). Fokuserer et
// eventuelt input-felt etter en liten forsinkelse, så feltet er klart til å skrive i.
function åpneModal(id) {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  aktivModal = id;
  const input = document.querySelector(`#${id} input`);
  if (input) setTimeout(() => input.focus(), 60);
}

// Lukker den åpne modalen og nullstiller aktivModal.
function lukkModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  aktivModal = null;
}

// Bygger og åpner «Fjern elever»-modalen: en «Tøm alle»-avkrysning øverst, så én
// avkrysning per elev. data-idx kobler hver avkrysning til elevens listeindeks.
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
// Viser en liten «toast»-melding nede i hjørnet som fjerner seg selv etter 3,2 sek.
// `type` (success/warning/error) styrer fargen via CSS-klassen.
function notify(melding, type = 'success') {
  const container = document.getElementById('notif-container');
  const el = document.createElement('div');
  el.className   = `notif ${type}`;
  el.textContent = melding;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ===================== Utils =====================
// Escaper HTML-spesialtegn i brukerinnhold (elevnavn osv.) før det settes inn via
// innerHTML. Hindrer at f.eks. et navn med < eller " bryter markupen / injiserer HTML.
// & må escapes først, ellers ville den doble-escape de andre erstatningene.
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Snarvei for modal-input: Enter kjører bekreft-funksjonen, Esc lukker modalen.
function inputEnter(inputId, bekreftFn) {
  document.getElementById(inputId).addEventListener('keydown', e => {
    if (e.key === 'Enter')  bekreftFn();
    if (e.key === 'Escape') lukkModal();
  });
}

// ===================== Tema =====================
// Bytter fargetema. Selve fargene ligger i CSS, knyttet til data-theme på <html>;
// her setter vi bare attributtet, lagrer valget og markerer det aktive valget i menyen.
function settTema(tema) {
  state.tema = tema;
  document.documentElement.setAttribute('data-theme', tema);
  saveState();
  document.querySelectorAll('.tema-valg').forEach(el => {
    el.classList.toggle('aktiv', el.dataset.tema === tema);
  });
}

// ===================== Font =====================
// Tilgjengelige fonter. `css` er font-family-verdien som settes; `url` peker på et
// Google Fonts-stilark som lastes inn ved behov (system-fonten trenger ingen, url=null).
const FONTER = {
  'system':      { css: 'system-ui,-apple-system,"Segoe UI",sans-serif', url: null },
  'victor-mono': { css: '"Victor Mono",monospace', url: 'https://fonts.googleapis.com/css2?family=Victor+Mono:ital,wght@0,400;0,700;1,400&display=swap' },
  'inter':       { css: '"Inter",sans-serif', url: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap' },
  'nunito':      { css: '"Nunito",sans-serif', url: 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;700&display=swap' },
  'roboto-slab': { css: '"Roboto Slab",serif', url: 'https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@400;700&display=swap' },
  'playfair':    { css: '"Playfair Display",serif', url: 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap' },
  'caveat':      { css: '"Caveat",cursive', url: 'https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&display=swap' },
};

// Bytter skrifttype. Webfonter lastes først ved behov: vi injiserer <link>-en bare
// hvis fonten har en url og ikke alt er lastet (data-font hindrer dobbeltlasting).
// Selve fonten brukes via CSS-variabelen --font.
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

// Setter global skriftstørrelse ved å endre rot-størrelsen (--font-size). Siden alt
// måles i rem skalerer hele grensesnittet proporsjonalt med dette ene tallet.
function settSkriftstørrelse(key) {
  const px = STØRRELSER[key] ?? STØRRELSER['normal'];
  document.documentElement.style.setProperty('--font-size', px);
  state.skrift_størrelse = key;
  saveState();
  document.querySelectorAll('.størrelse-valg').forEach(el => {
    el.classList.toggle('aktiv', el.dataset.størrelse === key);
  });
}

// Setter skriftstørrelse for ETT enkelt widget-kort, oppå den globale størrelsen.
// «normal» betyr «følg det globale» og lagres derfor ikke (slettes fra state).
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

// Gjenoppretter alle lagrede per-widget-størrelser ved oppstart.
function applyWidgetStørrelser() {
  const map = state.widget_størrelser ?? {};
  Object.entries(map).forEach(([id, key]) => settWidgetSkriftstørrelse(id, key));
}

// ===================== Event setup =====================
// Kobler alle klikk-, tastatur- og overlay-hendelser i grensesnittet til funksjonene
// sine. Kjøres én gang ved oppstart (fra init). Delene under er gruppert per widget/
// meny med egne kommentarer. Hver «bekreft»-funksjon valideres før modalen lukkes.
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
  document.getElementById('btn-eksporter').onclick = () => {
    klasseromDrop.classList.add('hidden');
    eksporterData();
  };
  document.getElementById('btn-importer').onclick = () => {
    klasseromDrop.classList.add('hidden');
    document.getElementById('import-fil').click();
  };
  document.getElementById('import-fil').addEventListener('change', e => håndterImportFil(e.target));
  document.getElementById('btn-import-bekreft').onclick = bekreftImport;
  document.getElementById('btn-import-avbryt').onclick  = () => { ventendeImport = null; lukkModal(); };
  document.getElementById('eksport-varsel').onclick = e => { e.stopPropagation(); eksporterData(); };
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
    // Ikke utløs hurtigtaster mens man skriver i et tekstfelt — da skal «a», «r» osv.
    // bli vanlige bokstaver, ikke kommandoer.
    const tag = document.activeElement?.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;

    // Enkelt-tast → handling (uten modifikatorer). Speiler knappene i grensesnittet.
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
// Kobler opp «gi nytt navn til klassebamsen»-modalen (egen funksjon fordi den ble
// lagt til etter settOppHendelser). Lagrer det nye navnet på aktiv side.
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
// Åpner backlog-editoren for ordenselev eller ulv (`type` velger hvilken). Viser én
// «chip» per elev; klikk på en chip legger eleven til / fjerner den fra backlogen
// manuelt — nyttig for å rette opp hvis noen var syk e.l. Re-rendrer trekket fortløpende.
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
// Hvilket bilde-kort som sist ble klikket. Brukes av lim-inn (Ctrl+V): innliming
// uten et tydelig «mål» går til det sist fokuserte bildekortet.
let fokusertBildeId = null;

// Maks bildestørrelse: 50 MB med IndexedDB. Uten IDB (lokal fallback i localStorage)
// gjelder fortsatt 2 MB pga det delte ~5 MB-taket.
const BILDE_MAKS_IDB      = 50 * 1024 * 1024;
const BILDE_MAKS_FALLBACK =  2 * 1024 * 1024;

// Objekt-URL-er (blob:…) vi har laget per bildekort. Må revokes når kortet tegnes på
// nytt eller fjernes, ellers lekker vi minne.
const bildeUrler = {};

// Bilde-lager: binære Blob-er i IndexedDB (stor kvote, ingen base64-skatt). På file://
// i Firefox-baserte nettlesere (Zen) er IDB blokkert — da faller vi tilbake til data-URL
// i state/localStorage (med 2 MB-grense). Den utrullede siden (GitHub Pages, https) får
// alltid IDB. ALL bildetilgang går gjennom dette objektet, så resten av koden slipper å
// vite hvilket lager som faktisk brukes.
const BildeLager = (() => {
  const DB_NAVN = 'klasserom';
  const STORE   = 'bilder';
  let db = null;
  let idbAktiv = false;
  let klarPromise = null;

  // Åpner (eller oppretter) databasen én gang. Feiler det — typisk file:// i Firefox —
  // markerer vi fallback i stedet for å kaste.
  function klar() {
    if (klarPromise) return klarPromise;
    klarPromise = new Promise(resolve => {
      if (typeof indexedDB === 'undefined' || !indexedDB) { idbAktiv = false; resolve(false); return; }
      let req;
      try { req = indexedDB.open(DB_NAVN, 1); }
      catch (_) { idbAktiv = false; resolve(false); return; }
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => { db = req.result; idbAktiv = true;  resolve(true);  };
      req.onerror   = () => { idbAktiv = false; resolve(false); };
      req.onblocked = () => { idbAktiv = false; resolve(false); };
    });
    return klarPromise;
  }

  const store     = mode => db.transaction(STORE, mode).objectStore(STORE);
  const somPromise = req => new Promise((res, rej) => {
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
  const filTilDataUrl = fil => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = () => rej(r.error);
    r.readAsDataURL(fil);
  });

  return {
    klar,
    get idbAktiv() { return idbAktiv; },

    // Lagre en valgt fil for et kort.
    async sett(id, fil) {
      await klar();
      if (idbAktiv) { await somPromise(store('readwrite').put(fil, id)); return; }
      state.bilder[id] = { data: await filTilDataUrl(fil) }; // fallback: data-URL i state
    },

    // Lagre en ferdig Blob direkte i IDB (migrering/import).
    async settBlob(id, blob) {
      await klar();
      if (idbAktiv) await somPromise(store('readwrite').put(blob, id));
    },

    // Vis-URL for et kort: blob:-URL (IDB) eller data-URL (fallback). null = ingen bilde.
    async hentUrl(id) {
      await klar();
      if (idbAktiv) { const b = await somPromise(store('readonly').get(id)); return b ? URL.createObjectURL(b) : null; }
      return state.bilder[id]?.data ?? null;
    },

    // Data-URL for et kort (brukes til eksport, så backup-fila blir selvstendig).
    async hentDataUrl(id) {
      await klar();
      if (idbAktiv) { const b = await somPromise(store('readonly').get(id)); return b ? filTilDataUrl(b) : null; }
      return state.bilder[id]?.data ?? null;
    },

    // Tøm bildet for ett kort (behold selve kortet).
    async slett(id) {
      await klar();
      if (idbAktiv) { await somPromise(store('readwrite').delete(id)); return; }
      if (state.bilder[id]) state.bilder[id] = {};
    },

    // Slett bilde-blob direkte i IDB (foreldreløs-opprydding).
    async slettBlob(id) {
      await klar();
      if (idbAktiv) await somPromise(store('readwrite').delete(id));
    },

    // Alle lagrede bilde-IDer (foreldreløs-opprydding).
    async alleNøkler() {
      await klar();
      if (idbAktiv) return somPromise(store('readonly').getAllKeys());
      return Object.keys(state.bilder);
    },

    // Tøm hele bilde-lageret (brukes ved «erstatt alt»-import).
    async tøm() {
      await klar();
      if (idbAktiv) await somPromise(store('readwrite').clear());
    },
  };
})();

// Flytter bilder lagret i gammelt format (data-URL i state.bilder[id].data, fra
// localStorage-tiden) over i IndexedDB, og fjerner de tunge data-URL-ene fra state —
// det krymper localStorage betydelig. Kjøres én gang ved oppstart. I fallback-modus
// (ingen IDB) lar vi dem ligge i state, der de fortsatt virker.
async function migrerGamleBilder() {
  if (!BildeLager.idbAktiv) return;
  let migrert = 0;
  for (const [id, obj] of Object.entries(state.bilder)) {
    if (obj && typeof obj.data === 'string' && obj.data.startsWith('data:')) {
      try {
        const blob = await (await fetch(obj.data)).blob();
        await BildeLager.settBlob(id, blob);
        state.bilder[id] = {}; // strip data-URL-en ut av state
        migrert++;
      } catch (e) { console.warn('Bilde-migrering feilet for', id, e); }
    }
  }
  if (migrert) saveState();
}

// Sletter «foreldreløse» bilder: blob-er i IDB som ikke lenger har et kort i state.bilder
// (kan oppstå etter import, migrering eller en feil). Trygt — rører aldri bilder i bruk.
async function ryddForeldreløseBilder() {
  if (!BildeLager.idbAktiv) return;
  const gyldige = new Set(Object.keys(state.bilder));
  for (const id of await BildeLager.alleNøkler()) {
    if (!gyldige.has(id)) {
      await BildeLager.slettBlob(id);
      console.info('Ryddet foreldreløst bilde:', id);
    }
  }
}

// Async bilde-oppstart: åpne lageret, migrer gammelt format, rydd foreldreløse, og tegn
// alle bildekort. Kalles fra init etter at kortene er bygd.
async function initBilder() {
  await BildeLager.klar();
  await migrerGamleBilder();
  await ryddForeldreløseBilder();
  for (const id of Object.keys(state.bilder)) renderBilde(id);
}

// Bygger DOM-en for ett bilde-kort (flerinstans, som notat). Inneholder opplastings-
// flate, <img> for visning og en fjern-knapp — alle skjult/vist av renderBilde.
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

// Kobler et bilde-kort: klikk på kortet gjør det til «fokusert» (lim-inn-mål). Selve
// tegningen skjer via renderBilde (kalt fra initBilder ved oppstart og etter endringer);
// et nytt, tomt kort viser opplastingsflaten allerede fra HTML-en.
function setupBilde(instansId) {
  document.getElementById(`card-${instansId}`)?.addEventListener('click', () => {
    fokusertBildeId = instansId;
  });
}

// Veksler bilde-kortet mellom to tilstander: har kortet et bilde i lageret viser vi det
// + fjern-knappen; ellers viser vi opplastingsflaten. Async fordi bildet hentes fra
// IndexedDB. Gamle objekt-URL-er revokes så vi ikke lekker minne.
async function renderBilde(instansId) {
  const img    = document.getElementById(`bilde-img-${instansId}`);
  const label  = document.getElementById(`bilde-label-${instansId}`);
  const fjernK = document.getElementById(`bilde-fjern-${instansId}`);
  if (!img) return;
  if (bildeUrler[instansId]) { URL.revokeObjectURL(bildeUrler[instansId]); delete bildeUrler[instansId]; }
  const url = await BildeLager.hentUrl(instansId);
  if (url) {
    if (url.startsWith('blob:')) bildeUrler[instansId] = url; // bare objekt-URL-er må revokes
    img.src = url;
    img.style.display = '';
    label.style.display = 'none';
    fjernK.style.display = '';
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
    label.style.display = '';
    fjernK.style.display = 'none';
  }
}

// Tar imot en fil valgt via fil-velgeren og sender den videre til lesBildefil.
function lastOppBilde(input, instansId) {
  const fil = input.files?.[0];
  if (fil) lesBildefil(fil, instansId);
}

// Leser en bildefil og lagrer den i bilde-lageret (Blob i IndexedDB, eller data-URL i
// fallback). Grensa er 50 MB med IDB, 2 MB i fallback (det delte ~5 MB-taket).
async function lesBildefil(fil, instansId) {
  if (!fil.type.startsWith('image/')) { notify('Det ser ikke ut som en bildefil', 'warning'); return; }
  await BildeLager.klar();
  const maks = BildeLager.idbAktiv ? BILDE_MAKS_IDB : BILDE_MAKS_FALLBACK;
  if (fil.size > maks) {
    notify(BildeLager.idbAktiv
      ? 'Bildet er for stort — maks 50 MB'
      : 'Lokalt uten IndexedDB er grensa 2 MB. På den utrullede siden gjelder 50 MB.', 'warning');
    return;
  }
  await BildeLager.sett(instansId, fil);
  if (!state.bilder[instansId]) state.bilder[instansId] = {}; // sørg for register-oppføring
  saveState();
  renderBilde(instansId);
}

// Tømmer bildet fra et kort (men beholder selve kortet — klar for et nytt bilde).
async function fjernBildeData(instansId) {
  await BildeLager.slett(instansId);
  saveState();
  renderBilde(instansId);
}

// Fjerner hele bilde-kortet fra denne siden. Bildedataene slettes kun hvis ingen
// andre sider bruker kortet (samme mønster som fjernNotat).
async function fjernBildeWidget(instansId) {
  const cardId = `card-${instansId}`;
  const side = aktivSide();
  side.widget_layout = side.widget_layout.filter(w => w.id !== cardId);
  side.widget_hidden  = (side.widget_hidden ?? []).filter(id => id !== cardId);
  const ingenSiderBrukerDen = state.sider.every(s => !s.widget_layout.some(w => w.id === cardId));
  if (ingenSiderBrukerDen) {
    delete state.bilder[instansId];
    await BildeLager.slett(instansId);
    if (bildeUrler[instansId]) { URL.revokeObjectURL(bildeUrler[instansId]); delete bildeUrler[instansId]; }
    document.getElementById(cardId)?.remove();
  }
  renderWidgetMeny();
  saveState();
}

// Oppretter et nytt, tomt bilde-kort på aktiv side (speiler leggTilNotat). Plasseres
// i kolonne 3 hvis den finnes, ellers i siste kolonne på smalere sider.
function leggTilBilde() {
  state.bilde_teller++;
  const id = `bilde-${state.bilde_teller}`;
  state.bilder[id] = {};
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

// ===================== YouTube-widget =====================
// Flerinstans, speiler bilde-kortet. state.youtube[id] = { url, videoId, start, modus }.
// Video spilles via YouTube IFrame Player API, slik at lyd-modus kan skjule bildet og
// likevel styre avspillingen med våre egne knapper. Player-instansene holdes her, ikke
// i state (de er DOM-objekter), og rives ned når et kort fjernes eller bytter lenke.
const ytPlayers = {};
let ytApiPromise = null;

// Laster YouTube IFrame Player API én gang og resolver når YT.Player er klar. API-et
// kaller den globale onYouTubeIframeAPIReady — vi kjeder oss på en evt. eksisterende.
function lastYoutubeApi() {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise(resolve => {
    if (window.YT && window.YT.Player) { resolve(window.YT); return; }
    const forrige = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (forrige) forrige(); resolve(window.YT); };
    if (!document.getElementById('yt-iframe-api')) {
      const s = document.createElement('script');
      s.id = 'yt-iframe-api';
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
  });
  return ytApiPromise;
}

// Plukker ut 11-tegns video-ID fra de vanlige YouTube-lenkeformatene (watch?v=, youtu.be,
// /embed/, /shorts/, /live/) — eller en rå ID. Returnerer null hvis ingenting matcher.
function parseYoutubeId(url) {
  if (!url) return null;
  url = url.trim();
  if (/^[\w-]{11}$/.test(url)) return url;
  let m;
  if ((m = url.match(/youtu\.be\/([\w-]{11})/)))            return m[1];
  if ((m = url.match(/[?&]v=([\w-]{11})/)))                 return m[1];
  if ((m = url.match(/\/(?:embed|shorts|v|live)\/([\w-]{11})/))) return m[1];
  return null;
}

// Starttid i sekunder fra en lenke (?t=90 eller ?start=90). Bare hele sekunder.
function parseYoutubeStart(url) {
  const m = (url || '').match(/[?&](?:t|start)=(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// Bygger DOM-en for ett YouTube-kort. Selve innholdet (lenke-felt eller spiller) tegnes
// av renderYoutube, som kalles fra setupYoutube.
function lagYoutubeElement(instansId) {
  const div = document.createElement('div');
  div.className = 'card';
  div.id = `card-${instansId}`;
  div.innerHTML = `
    <button class="kl-widget-close" onclick="fjernYoutubeWidget('${instansId}')" title="Slett dette YouTube-kortet">✕</button>
    <div class="card-header">
      <span class="drag-handle" title="Dra for å flytte">⠿</span>
      <h2>▶️ YouTube</h2>
    </div>
    <div id="youtube-body-${instansId}" class="youtube-body"></div>
  `;
  return div;
}

function setupYoutube(instansId) {
  renderYoutube(instansId);
}

// Tegner kortet etter tilstand: uten videoId vises et lenke-felt; med videoId vises
// modus-bryteren + spilleren (16:9 i video-modus, kompakt lyd-bar i lyd-modus). Lyd-
// panelet ligger alltid i DOM-en (skjult av CSS i video-modus), så bytte mellom modus
// bare veksler en klasse — spilleren rives ALDRI ned ved modusbytte, så lyden er
// sømløs. En ny spiller opprettes kun når selve videoen settes/endres.
function renderYoutube(instansId) {
  const body = document.getElementById(`youtube-body-${instansId}`);
  if (!body) return;
  // Riv ned evt. eksisterende spiller før vi bygger om body (innerHTML fjerner iframen).
  if (ytPlayers[instansId]) { try { ytPlayers[instansId].destroy(); } catch (_) {} delete ytPlayers[instansId]; }

  const data = state.youtube[instansId] ?? {};
  if (!data.videoId) {
    body.innerHTML = `
      <div class="youtube-input">
        <input type="text" id="youtube-url-${instansId}" placeholder="Lim inn YouTube-lenke…" autocomplete="off">
        <button class="btn btn-success btn-sm" onclick="settYoutubeUrlFraFelt('${instansId}')">Vis</button>
      </div>`;
    const inp = document.getElementById(`youtube-url-${instansId}`);
    inp?.addEventListener('keydown', e => { if (e.key === 'Enter') settYoutubeUrlFraFelt(instansId); });
    return;
  }

  const erLyd = data.modus === 'lyd';
  body.innerHTML = `
    <div class="youtube-modus">
      <button class="yt-modus-knapp video ${erLyd ? '' : 'aktiv'}" onclick="settYoutubeModus('${instansId}','video')">▶ Video</button>
      <button class="yt-modus-knapp lyd ${erLyd ? 'aktiv' : ''}" onclick="settYoutubeModus('${instansId}','lyd')">🎵 Kun lyd</button>
      <button class="yt-bytt-lenke" onclick="byttYoutubeLenke('${instansId}')" title="Bytt lenke">↻</button>
    </div>
    <div class="youtube-media ${erLyd ? 'youtube-lyd' : ''}" id="youtube-media-${instansId}">
      <div id="youtube-player-${instansId}" class="youtube-player"></div>
      <div class="youtube-lyd-panel">
        <button class="yt-spill" id="yt-spill-${instansId}" onclick="ytSpillPause('${instansId}')" title="Spill / pause">▶</button>
        <span class="yt-lyd-tittel" id="yt-tittel-${instansId}">🎵 Laster…</span>
        <span class="yt-volum-ikon" aria-hidden="true">🔊</span>
        <input type="range" class="yt-volum" id="yt-volum-${instansId}" min="0" max="100"
               value="${data.volum ?? 100}" title="Volum" aria-label="Volum"
               oninput="settYoutubeVolum('${instansId}', this.value)">
      </div>
    </div>`;
  opprettYoutubePlayer(instansId, data.videoId, data.start || 0);
}

// Oppretter YT.Player i mål-diven (som API-et bytter ut med en iframe). nocookie-verten
// gir færre cookies. onReady setter lyd-panelets tittel; onStateChange holder play/pause-
// knappen i synk. Guard hvis kortet ble fjernet mens API-et lastet.
async function opprettYoutubePlayer(instansId, videoId, start) {
  const YT = await lastYoutubeApi();
  const mål = document.getElementById(`youtube-player-${instansId}`);
  if (!mål || !state.youtube[instansId]) return;
  ytPlayers[instansId] = new YT.Player(mål, {
    videoId,
    host: 'https://www.youtube-nocookie.com',
    playerVars: { start, rel: 0, modestbranding: 1, playsinline: 1 },
    events: {
      onReady: e => {
        const t = document.getElementById(`yt-tittel-${instansId}`);
        if (t) { const d = e.target.getVideoData?.(); t.textContent = '🎵 ' + (d?.title || 'YouTube'); }
        const v = state.youtube[instansId]?.volum;
        if (typeof v === 'number') { e.target.setVolume(v); if (v > 0) e.target.unMute?.(); }
      },
      onStateChange: e => oppdaterSpillKnapp(instansId, e.data),
    },
  });
}

// Veksler video/lyd uten å røre spilleren: bare en CSS-klasse + knappemarkering. Lyden
// fortsetter uavbrutt fordi iframen aldri fjernes (CSS klipper bare bildet bort).
function settYoutubeModus(instansId, modus) {
  const d = state.youtube[instansId];
  if (!d) return;
  d.modus = modus;
  saveState();
  const erLyd = modus === 'lyd';
  document.getElementById(`youtube-media-${instansId}`)?.classList.toggle('youtube-lyd', erLyd);
  const body = document.getElementById(`youtube-body-${instansId}`);
  body?.querySelector('.yt-modus-knapp.video')?.classList.toggle('aktiv', !erLyd);
  body?.querySelector('.yt-modus-knapp.lyd')?.classList.toggle('aktiv', erLyd);
}

// Spill/pause via API-et (1 = spiller av i YouTube sitt state-skjema).
function ytSpillPause(instansId) {
  const p = ytPlayers[instansId];
  if (!p) return;
  if (p.getPlayerState?.() === 1) p.pauseVideo(); else p.playVideo();
}
function oppdaterSpillKnapp(instansId, playerState) {
  const b = document.getElementById(`yt-spill-${instansId}`);
  if (b) b.textContent = playerState === 1 ? '⏸' : '▶';
}

// Volum (0–100) for lyd-modus. Lagres i state så det huskes ved reload, og settes
// direkte på spilleren. Skrur av mute hvis brukeren drar volumet opp fra null.
function settYoutubeVolum(instansId, verdi) {
  const v = Math.max(0, Math.min(100, parseInt(verdi, 10) || 0));
  const d = state.youtube[instansId];
  if (d) { d.volum = v; saveState(); }
  const p = ytPlayers[instansId];
  if (p) { p.setVolume?.(v); if (v > 0) p.unMute?.(); }
}

// Leser lenke-feltet og setter videoen.
function settYoutubeUrlFraFelt(instansId) {
  const inp = document.getElementById(`youtube-url-${instansId}`);
  if (inp) settYoutubeUrl(instansId, inp.value);
}
function settYoutubeUrl(instansId, url) {
  const videoId = parseYoutubeId(url);
  if (!videoId) { notify('Fant ingen gyldig YouTube-lenke', 'warning'); return; }
  state.youtube[instansId] = {
    url: url.trim(),
    videoId,
    start: parseYoutubeStart(url),
    modus: state.youtube[instansId]?.modus || 'video',
    volum: state.youtube[instansId]?.volum ?? 100,
  };
  saveState();
  renderYoutube(instansId);
}

// Tilbake til lenke-feltet (behold valgt modus). Rydder spilleren.
function byttYoutubeLenke(instansId) {
  if (ytPlayers[instansId]) { try { ytPlayers[instansId].destroy(); } catch (_) {} delete ytPlayers[instansId]; }
  const modus = state.youtube[instansId]?.modus || 'video';
  state.youtube[instansId] = { modus };
  saveState();
  renderYoutube(instansId);
}

// Nytt, tomt YouTube-kort på aktiv side (speiler leggTilBilde).
function leggTilYoutube() {
  state.youtube_teller++;
  const id = `youtube-${state.youtube_teller}`;
  state.youtube[id] = { modus: 'video' };
  const cardId = `card-${id}`;
  const col = Math.min(3, aktivSide().kolonner ?? 3);
  aktivSide().widget_layout.push({ id: cardId, col });
  const el = lagYoutubeElement(id);
  document.querySelector(`.col-wrapper[data-col="${col}"]`).appendChild(el);
  setupYoutube(id);
  settOppDragOgDrop();
  applyLayout();
  renderWidgetMeny();
  saveState();
}

// Fjerner et YouTube-kort fra denne siden. Data + spiller slettes kun hvis ingen andre
// sider bruker kortet (samme mønster som fjernBildeWidget).
function fjernYoutubeWidget(instansId) {
  const cardId = `card-${instansId}`;
  const side = aktivSide();
  side.widget_layout = side.widget_layout.filter(w => w.id !== cardId);
  side.widget_hidden  = (side.widget_hidden ?? []).filter(id => id !== cardId);
  const ingenSiderBrukerDen = state.sider.every(s => !s.widget_layout.some(w => w.id === cardId));
  if (ingenSiderBrukerDen) {
    if (ytPlayers[instansId]) { try { ytPlayers[instansId].destroy(); } catch (_) {} delete ytPlayers[instansId]; }
    delete state.youtube[instansId];
    document.getElementById(cardId)?.remove();
  }
  renderWidgetMeny();
  saveState();
}

// ===================== Gruppebegrensning =====================
// Legger til et «hold fra hverandre»-par på aktiv side, som lagGrupper respekterer.
// Hopper over tomt/likt par og duplikater (par er retningsløse: A+B == B+A).
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

// Fjerner et begrensnings-par ved indeks.
function fjernBegrensning(idx) {
  aktivSide().gruppe_begrensninger.splice(idx, 1);
  saveState();
  renderBegrensninger();
}

// Tegner lista over begrensnings-par («A + B») med en slett-knapp per par.
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

// Åpner begrensnings-modalen og tegner gjeldende par.
function åpneBegrensningModal() {
  document.getElementById('begrensning-modal').style.display = 'flex';
  renderBegrensninger();
}

// Fyller de to nedtrekkslistene i begrensnings-modalen med dagens elever, og prøver
// å beholde det allerede valgte navnet hvis eleven fortsatt er inne.
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

// ===================== Eksport / import av data =====================
const EKSPORT_FORMAT_VERSJON = 1;

// Fingeravtrykk av det brukeren ville mistet uten eksport: lagrede lister + alle
// siders backlogs. Brukes til endrings-varselet (punkt 3).
function beregnEksportSignatur(s = state) {
  return JSON.stringify({
    lister: s.lister ?? {},
    backlogs: (s.sider ?? []).map(side => [
      side.tilfeldig_backlog, side.ordenselev_backlog, side.ulv_backlog,
    ]),
  });
}

// Viser/skjuler «du har ulagrede endringer»-varselet. Vises kun når det finnes data
// verdt å sikre (lister eller backlogs) OG signaturen avviker fra siste eksport.
function oppdaterEksportVarsel() {
  const el = document.getElementById('eksport-varsel');
  if (!el) return;
  const harData = Object.keys(state.lister ?? {}).length > 0 ||
    (state.sider ?? []).some(s =>
      s.tilfeldig_backlog.length || s.ordenselev_backlog.length || s.ulv_backlog.length);
  const endret = state.eksport_signatur !== beregnEksportSignatur();
  el.classList.toggle('hidden', !(harData && endret));
}

// Skriver hele tilstanden til en JSON-fil og laster den ned som backup. Vi pakker
// en versjon + app-navn rundt innholdet så import kan kjenne igjen og validere fila.
// Trikset for nedlasting: lag en Blob, lag en midlertidig <a download>, klikk den
// programmatisk, og rydd opp. Etterpå markeres dataene som «eksportert».
async function eksporterData() {
  // Bygg bilder med data-URL-er (hentet fra IndexedDB, eller state i fallback) så
  // backup-fila blir selvstendig og beholder samme format som før — gamle/nye
  // backups er kryss-kompatible.
  const bilderEksport = {};
  for (const id of Object.keys(state.bilder)) {
    bilderEksport[id] = { data: await BildeLager.hentDataUrl(id) };
  }
  const nå = new Date();
  const data = {
    app: 'klasserom-dashboard',
    format_versjon: EKSPORT_FORMAT_VERSJON,
    eksportert: nå.toISOString(),
    innhold: {
      preferanser: {
        tema:              state.tema,
        font:              state.font,
        skrift_størrelse:  state.skrift_størrelse,
        widget_størrelser: state.widget_størrelser,
        timer_varighet:    state.timer_varighet,
      },
      klasselister: state.lister,
      sider:        state.sider,
      aktiv_side:   state.aktiv_side,
      widgetinnhold: {
        notater:        state.notater,
        bilder:         bilderEksport,
        youtube:        state.youtube,
        notat_teller:   state.notat_teller,
        bilde_teller:   state.bilde_teller,
        youtube_teller: state.youtube_teller,
      },
    },
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const dato = `${nå.getFullYear()}-${String(nå.getMonth() + 1).padStart(2, '0')}-${String(nå.getDate()).padStart(2, '0')}`;
  a.href = url;
  a.download = `klasserom-backup-${dato}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  // Marker som eksportert → endrings-varselet forsvinner til neste endring
  state.eksport_signatur = beregnEksportSignatur();
  saveState();
  notify('📤 Data eksportert');
}

let ventendeImport = null; // parsed fil mellom valg av fil og bekreftelse av modus

// Steg 1 av import: les og valider den valgte fila. Selve sammenslåingen skjer ikke
// her — vi parser, sjekker at det faktisk er en klasserom-backup, fyller infoteksten
// og åpner import-modalen der brukeren velger modus. Resultatet venter i ventendeImport.
function håndterImportFil(input) {
  const fil = input.files?.[0];
  input.value = ''; // tillat å velge samme fil igjen senere
  if (!fil) return;
  const reader = new FileReader();
  reader.onload = e => {
    let data;
    try {
      data = JSON.parse(e.target.result);
    } catch (_) {
      notify('Kunne ikke lese fila — er det en gyldig JSON-fil?', 'error');
      return;
    }
    if (!data || data.app !== 'klasserom-dashboard' || !data.innhold) {
      notify('Dette ser ikke ut som en klasserom-backup', 'error');
      return;
    }
    if (data.format_versjon > EKSPORT_FORMAT_VERSJON) {
      notify('Fila er laget i en nyere versjon — importerer det jeg kjenner igjen', 'warning');
    }
    ventendeImport = data;
    const antL = Object.keys(data.innhold.klasselister ?? {}).length;
    const antS = (data.innhold.sider ?? []).length;
    document.getElementById('import-info').textContent =
      `Fil fra ${(data.eksportert || '').slice(0, 10) || 'ukjent dato'} — ${antS} side(r), ${antL} lagret liste(r).`;
    document.querySelector('input[name="import-modus"][value="erstatt"]').checked = true;
    åpneModal('modal-import');
  };
  reader.readAsText(fil);
}

// Steg 2 av import: utfør den etter at brukeren har valgt modus.
//  - «flett_lister»: behold alt nåværende, bare legg til/oppdater lagrede lister.
//  - «erstatt»: bygg en helt ny tilstand fra fila (tolerant — manglende felt får
//    dagens defaults), skriv den rett til localStorage og last siden på nytt.
async function bekreftImport() {
  const data  = ventendeImport;
  if (!data) { lukkModal(); return; }
  const modus = document.querySelector('input[name="import-modus"]:checked')?.value ?? 'erstatt';
  const innhold = data.innhold ?? {};

  if (modus === 'flett_lister') {
    // Behold alt nåværende; legg til/oppdater kun de lagrede listene
    Object.assign(state.lister, innhold.klasselister ?? {});
    saveState();
    lukkModal();
    ventendeImport = null;
    const n = Object.keys(innhold.klasselister ?? {}).length;
    notify(`📥 ${n} liste(r) flettet inn`);
    return;
  }

  // Erstatt alt: bygg en ny tilstand tolerant (manglende felt → dagens defaults)
  const ny   = defaultState();
  const pref = innhold.preferanser ?? {};
  if (pref.tema              !== undefined) ny.tema = pref.tema;
  if (pref.font              !== undefined) ny.font = pref.font;
  if (pref.skrift_størrelse  !== undefined) ny.skrift_størrelse = pref.skrift_størrelse;
  if (pref.widget_størrelser !== undefined) ny.widget_størrelser = pref.widget_størrelser;
  if (pref.timer_varighet    !== undefined) ny.timer_varighet = pref.timer_varighet;
  if (innhold.klasselister   !== undefined) ny.lister = innhold.klasselister;
  if (Array.isArray(innhold.sider) && innhold.sider.length) ny.sider = innhold.sider;
  const wi = innhold.widgetinnhold ?? {};
  if (wi.notater        !== undefined) ny.notater = wi.notater;
  if (wi.bilder         !== undefined) ny.bilder = wi.bilder;
  if (wi.youtube        !== undefined) ny.youtube = wi.youtube;
  if (wi.notat_teller   !== undefined) ny.notat_teller = wi.notat_teller;
  if (wi.bilde_teller   !== undefined) ny.bilde_teller = wi.bilde_teller;
  if (wi.youtube_teller !== undefined) ny.youtube_teller = wi.youtube_teller;
  ny.aktiv_side = Math.min(
    typeof innhold.aktiv_side === 'number' ? innhold.aktiv_side : 0,
    ny.sider.length - 1,
  );

  // Flytt importerte bilde-data-URL-er ut av state-blobben og inn i IndexedDB. Ellers
  // kan store bilder sprenge localStorage-taket idet vi skriver hele staten under. Ved
  // «erstatt alt» tømmer vi lageret først, så det matcher nøyaktig det importerte.
  await BildeLager.klar();
  if (BildeLager.idbAktiv && ny.bilder) {
    await BildeLager.tøm();
    for (const id of Object.keys(ny.bilder)) {
      const d = ny.bilder[id]?.data;
      if (typeof d === 'string' && d.startsWith('data:')) {
        try { await BildeLager.settBlob(id, await (await fetch(d)).blob()); }
        catch (e) { console.warn('Import-bilde feilet for', id, e); }
      }
      ny.bilder[id] = {}; // lett register i state
    }
  }

  // En nettopp importert backup regnes som «eksportert» (ingen ulagrede endringer)
  ny.eksport_signatur = beregnEksportSignatur(ny);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ny));
  } catch (e) {
    console.warn('Import-lagring feilet:', e);
    notify('Klarte ikke lagre importen — for mye data for nettleseren', 'error');
    return;
  }
  ventendeImport = null;
  location.reload(); // enkleste, sikreste vei til full re-render fra ny tilstand
}

// Appens oppstart (kjøres når DOM-en er klar, se nederst i fila). Tegner all data fra
// lagret tilstand, oppretter DOM for flerinstans-widgets (notat/bilde), kobler opp
// hendelser og dra-og-slipp, og setter i gang dato-/vær-oppdatering på timer.
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

  for (const instansId of Object.keys(state.youtube ?? {})) {
    const el = lagYoutubeElement(instansId);
    document.querySelector('.col-wrapper[data-col="3"]').appendChild(el);
    setupYoutube(instansId);
  }

  // Lim inn bilde (Ctrl+V): går til det sist fokuserte bildekortet. Vi leter gjennom
  // utklippstavlas elementer etter det første som er en bildefil.
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
  setupDagsplanDrag();
  renderSiderNav();
  oppdaterKolonneStepper();
  oppdaterEksportVarsel();

  // Async bilde-oppstart: åpne IndexedDB, migrer gammelt localStorage-format, rydd
  // foreldreløse blober og tegn bildekortene. Blokkerer ikke resten av oppstarten.
  initBilder();
}

// Start appen når DOM-en er ferdig parset (skriptet ligger i <head> uten defer).
document.addEventListener('DOMContentLoaded', init);
