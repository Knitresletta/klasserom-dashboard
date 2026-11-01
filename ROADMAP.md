# Roadmap

Verktøy som finnes i Classroomscreen og som Skoledash ikke har ennå. Lista er satt opp etter hukommelse 1. november 2026 og er **ikke verifisert** mot Classroomscreen sin nettside.

En kort, lærervennlig utgave av lista vises i appen, øverst i `OPPDATERINGSLOGG_HTML` (`app.js`). Endres planen, oppdater begge stedene.

Prinsipp: alt skal fungere uten server og uten innlogging. Ingen elevdata forlater maskinen.

## Neste

| Verktøy | Hva det er | Innsats | Merknad |
|---|---|---|---|
| Lydnivåmåler | Mikrofonen viser hvor høyt det er i rommet | Middels | Trenger mikrofontilgang (`getUserMedia`). Lyden behandles lokalt |
| Arbeidssymboler | «Hvisk», «Stille», «Spør en venn», «Jobb sammen» | Lett | Kan slås sammen med trafikklys |
| Trafikklys | Rødt, gult og grønt for arbeidsro | Lett | |
| Stoppeklokke | Teller oppover | Lett | Kan bli en modus i Timer-kortet |

## Senere

| Verktøy | Hva det er | Innsats | Merknad |
|---|---|---|---|
| Exit-avstemning | Emoji-skala på tavla («hvordan gikk timen») | Lett | Elevsvar fra egne mobiler krever server, så det er utenfor scope |
| Poengtavle | Poeng per gruppe eller lag | Lett | Kan hente gruppene fra Grupper-kortet |
| Nedtelling til dato | «12 dager til juleferie» | Lett | |
| Tegnebrett | Frihåndstegning på canvas | Middels | |
| Dokumentkamera | Webkamera vist i et kort | Lett-middels | Trenger kameratilgang |
| QR-kode | Lim inn en lenke, få en QR-kode | Middels | Ny avhengighet: QR-bibliotek eller ekstern API. Må avklares først |
| Bakgrunner | Bilde eller animert bakgrunn bak kortene | Middels | Temaene dekker noe av dette |

## Vurdert, ikke planlagt

| Verktøy | Hvorfor ikke |
|---|---|
| Innebygd nettside (iframe) | Mange sider blokkerer innbygging, så det fungerer dårlig i praksis |
