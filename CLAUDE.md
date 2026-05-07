# CLAUDE.md — klasserom-web

## Oppdateringslogg og brukerveiledning

**OBLIGATORISK:** Når du legger til, endrer eller fjerner brukersynlige funksjoner, MÅ du oppdatere begge disse strengene i `app.js`:

- `OPPDATERINGSLOGG_HTML` (ca. linje 774) — legg til en ny versjonblokk øverst med dato og kulepunkt per ny funksjon. Bruk samme format som eksisterende blokker.
- `BRUKERVEILEDNING_HTML` (ca. linje 814) — oppdater eller legg til `<h4>`-seksjoner som forklarer nye funksjoner i enkelt norsk. Seksjonene skal hjelpe en lærer som aldri har sett appen før.

Gjør dette **i samme commit** som kodeendringen. Ikke lag separate "docs"-commits.

## Arkitektur

- Én HTML-fil, én CSS-fil, én JS-fil — ingen byggsteg.
- Tilstand lagres utelukkende i `localStorage` via `state`-objektet. Bruk alltid `saveState()` etter mutasjon.
- Tema og font settes via CSS custom properties på `<html>` (`data-theme`-attributt og `--font`/`--font-size`-variabler).
- Nye widgets trenger en `<div id="card-*" class="card">` i `index.html` og en tilhørende `setup*()`-funksjon kalt fra `init()`.

## Navnekonvensjoner

- CSS-klasser: `kl-` prefix for dropdown-UI, `card` for widget-kort.
- JS-funksjoner: norsk, camelCase (`settTema`, `setupNotat`, `renderDagsplan`).
- `data-`-attributter på HTML-elementer styrer logikken (f.eks. `data-tema`, `data-font`, `data-størrelse`).

## Kjør lokalt

Åpne `index.html` direkte i nettleseren — ingen server nødvendig.
For syntaks-sjekk av JS: `node --check app.js`
