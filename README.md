# GeoPeil

PWA, die Berge, Flüsse/Seen, Orte und Sehenswürdigkeiten benennt, wenn man das
Handy in ihre Richtung hält – mit Kompass-Radar, Luftlinie (Großkreis-Distanz)
und lokaler Speicherung von Favoriten.

## Funktioniert so
- **GPS** bestimmt deinen Standort.
- **Kompass** (Magnetometer) bestimmt die Blickrichtung.
- Objektdaten kommen live von **OpenStreetMap** über die **Overpass API**.
- Für jedes Objekt wird **Luftlinie** (Haversine) und **Peilung** berechnet.
- **Radar**: Blickrichtung ist immer oben; blaue Keil = Sichtfeld.
- **Liste**: „In Blickrichtung zuerst" / „Nächste" / „Höchste".
- **Gespeichert**: Favoriten liegen lokal im Browser (`localStorage`).

## Starten (lokal testen)
Aus dem Projektordner:

```bash
python -m http.server 5178
```

Dann am Handy im selben WLAN `http://<PC-IP>:5178` öffnen. Für GPS/Kompass ist
ein **sicherer Kontext** nötig: `localhost` gilt als sicher; über die IP braucht
es **HTTPS** (z. B. via Reverse-Proxy oder Hosting).

## Auf dem Handy nutzen
Am zuverlässigsten über **HTTPS-Hosting** (z. B. GitHub Pages). Dann:
1. Seite im Handy-Browser öffnen.
2. „Standort & Kompass erlauben" tippen (iOS fragt separat nach Kompass).
3. Handy kurz in einer liegenden 8 bewegen, damit der Kompass kalibriert.

### iOS / Android Hinweise
- **iOS Safari** braucht die explizite Kompass-Erlaubnis (per Button ausgelöst).
- **Android Chrome** nutzt die absolute Orientierung automatisch.
- **Kompass-Korrektur** in den Einstellungen justiert die magnetische Missweisung
  bzw. kleine Sensorabweichungen (−30°…+30°).

## Einstellungen
- **Umkreis** 5–150 km, Standard 40 km, gilt für Orte, Gewässer und
  Sehenswürdigkeiten. Große Werte laden im Ballungsraum tausende Objekte
  (60 km ≈ 7000 / 1,7 MB) und laufen leicht in den Overpass-Timeout – für „was
  peile ich an?" reichen 30–40 km.
- **Berge** werden unabhängig davon bis **100 km** gesucht (man sieht sie ja aus
  der Ferne). Jenseits des Umkreises zählen nur echte Berge **ab 800 m**, sonst
  überschwemmen tausende benannte Mittelgebirgshügel Liste und Radar. Der Radar
  zieht sich automatisch auf den fernsten sichtbaren Berg auf.
- **Min. Berghöhe** blendet kleine Hügel aus (nützlich bei großem Umkreis).
- **Blickfeld-Breite** ±5°…±60°.
- **Kategorien** Berge, Flüsse/Seen, Orte, Sehenswürdigkeiten.

## Freigabe-Checkliste
Vor jedem Push abarbeiten – ein vergessener Cache-Bump führt dazu, dass der
Service Worker alten Code ausliefert und Tests am falschen Stand laufen:

1. `APP_VERSION` in `js/store.js` **und** `CACHE` in `sw.js` auf dieselbe neue
   Nummer setzen (`v12` → `v13`). Die Anzeige auf dem Startbildschirm kommt aus
   `APP_VERSION`, es gibt keine dritte Stelle mehr.
2. Neue oder umbenannte Dateien in die `SHELL`-Liste in `sw.js` aufnehmen –
   sonst fehlen sie offline.
3. `tests/test.html` im Browser öffnen, Kopfzeile muss „alle N Tests bestanden"
   melden.
4. In den Entwicklertools unter *Application → Service Workers* „Update on
   reload" anhaken und die Seite einmal neu laden; die angezeigte Versionsnummer
   muss die neue sein.

## Bekannte Grenzen / nächste Schritte
- **Sichtlinie**: verdeckte Berge werden noch angezeigt. Echte
  Horizont-/Verdeckungsberechnung braucht ein Höhenmodell (DEM) – geplant.
- Sehr kleine Gewässer (Teiche) tauchen im Umkreis mit auf; ggf. Radius senken.
- Angezeigt werden nur **benannte** Objekte. Unbenannte Gipfel, Teiche und
  Flussabschnitte gibt es in OSM reichlich – sie lassen sich aber nicht
  ansagen und werden deshalb schon beim Auswerten verworfen.
- **Favoriten altern**: gespeichert wird eine Kopie des Objekts (Name, Art,
  Koordinaten), nicht nur die OSM-ID. Vorteil: der Favorit bleibt auch ohne Netz
  und außerhalb des geladenen Umkreises sichtbar. Preis: wird der Eintrag in OSM
  verschoben oder umbenannt, bleibt die gespeicherte Fassung stehen – dann
  einmal löschen und neu speichern.
- **Umkreis kleiner stellen** löst absichtlich **keinen** neuen Abruf aus: die
  Objekte stecken in den bereits geladenen Daten. Nachgeladen wird nur, wenn der
  Umkreis über den zuletzt geladenen hinauswächst, der Standort wechselt oder
  „Daten neu laden" gedrückt wird.

Daten © OpenStreetMap-Mitwirkende.
