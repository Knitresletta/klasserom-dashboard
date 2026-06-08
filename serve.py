#!/usr/bin/env python3
"""Lokal testserver for klasserom-web (staging før push til GitHub Pages).

Hvorfor en egen server i stedet for å åpne index.html direkte:
  - http://localhost er et «secure context» → IndexedDB virker (også i Zen/Firefox),
    akkurat som på den nettpubliserte siden. file:// blokkerer IndexedDB.
  - Den sender Cache-Control: no-store, så nettleseren alltid henter nyeste app.js/
    style.css — ingen «jeg endret koden, men ser gammel versjon»-forvirring.

Bruk:
    python3 serve.py            # port 8000
    python3 serve.py 5500       # egen port
Åpne så http://localhost:8000 i nettleseren. Ctrl+C stopper serveren.
"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """Serverer mappa som vanlig, men ber nettleseren la være å cache noe."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
    print(f"Klasserom (staging) kjører på http://localhost:{PORT}")
    print("Test her FØR du pusher. Ctrl+C for å stoppe.")
    httpd.serve_forever()
