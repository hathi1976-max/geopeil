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
- **Umkreis** 5–300 km (große Werte = mehr entfernte Gipfel, aber langsamer).
- **Min. Berghöhe** blendet kleine Hügel aus (nützlich bei großem Umkreis).
- **Blickfeld-Breite** ±5°…±60°.
- **Kategorien** Berge, Flüsse/Seen, Orte, Sehenswürdigkeiten.

## Bekannte Grenzen / nächste Schritte
- **Sichtlinie**: verdeckte Berge werden noch angezeigt. Echte
  Horizont-/Verdeckungsberechnung braucht ein Höhenmodell (DEM) – geplant.
- Sehr kleine Gewässer (Teiche) tauchen im Umkreis mit auf; ggf. Radius senken.
- **Update-Hinweis**: Der Service Worker cached die App-Dateien. Nach Änderungen
  die Version in `sw.js` (`const CACHE = 'geopeil-vN'`) hochzählen, damit Geräte
  die neue Version laden.

Daten © OpenStreetMap-Mitwirkende.
