# GeoPeil – Entwicklungsdokumentation

Stand: August 2026. Reine Vanilla-Web-App ohne Framework, ohne Build-Schritt,
ohne Abhängigkeiten. Alle Dateien sind statisch auslieferbar.

## Projektstruktur

```
claude-geo/
├── index.html            Oberfläche: Berechtigungs-Gate, Tabs, Radar, Listen, Detail-Sheet
├── style.css             Layout, dunkles Farbschema, Radar-Maße
├── js/
│   ├── app.js            Einstiegspunkt: Overpass-Ladeschicht, Verdrahtung der Bedienung
│   ├── geo.js            reine Geometrie (haversine, bearing, angleDiff, cardinal, fmtDist)
│   ├── overpass.js       Abfrage bauen, abschicken (Timeout/Abbruch), auswerten
│   ├── store.js          Zustand, localStorage, APP_VERSION, abgeleitete Werte
│   ├── sensors.js        GPS-Watcher und Kompass
│   └── ui.js             Rendering, Radar-Canvas, Detail-Sheet
├── tests/                Testläufer + Tests (tests/test.html im Browser öffnen)
├── sw.js                 Service Worker (network-first, Cache als Offline-Fallback)
├── manifest.webmanifest  PWA-Manifest
├── icon.svg / icon-maskable.svg
├── README.md             Kurzüberblick, Bedienung, Freigabe-Checkliste
├── CODEREVIEW.md         Code-Review vom 04.08.2026 samt Abarbeitung
└── ENTWICKLUNG.md        diese Datei
```

Bis v11 lag die gesamte App in einer `app.js` im Wurzelverzeichnis; seit v12
ist sie auf die Module unter `js/` aufgeteilt (Befund C3), und `index.html`
lädt nur noch `js/app.js` als ES-Modul.

## Wie die App rechnet

- **GPS** über `navigator.geolocation.watchPosition` liefert `state.pos`.
- **Kompass** über `deviceorientationabsolute` / `deviceorientation`. iOS meldet
  `webkitCompassHeading` (schon 0 = Nord im Uhrzeigersinn), Android `alpha`
  (gegenläufig, daher `360 - alpha`). Sobald **absolute** Ereignisse eintreffen,
  werden relative ignoriert — sonst arbeiten beide Quellen gegeneinander und der
  Wert zappelt. Geglättet wird zirkulär über einen Einheitsvektor (Tiefpass
  k = 0,12), damit der Sprung 359° → 0° nicht durch die Mitte läuft.
- **Objektdaten** kommen live von der Overpass API (OpenStreetMap). Verworfen
  wird alles ohne Namen — ein unbenannter Gipfel lässt sich nicht ansagen.
- **Entfernung** ist die Großkreisdistanz (Haversine, Kugelmodell, R = 6371 km),
  **Peilung** die Anfangspeilung des Großkreises. Beides ist rein rechnerisch
  und liegt deshalb in `js/geo.js` — dem einzigen Teil mit Tests.
- **Radar**: die Blickrichtung liegt immer oben, alle Objekte werden relativ
  dazu gedreht (`o.brg - heading`).

## Entwickeln und Testen

```
python -m http.server 5178
```

im Projektordner starten, dann `http://localhost:5178` öffnen. Für GPS/Kompass
ist ein sicherer Kontext nötig; `localhost` gilt als sicher, über die IP im WLAN
braucht es HTTPS.

Die Tests laufen im Browser unter `http://localhost:5178/tests/test.html`
(Details im Abschnitt zu C2). Vor jeder Freigabe die Checkliste im `README.md`
abarbeiten — ein vergessener Cache-Bump führt sonst dazu, dass der Service
Worker alten Code ausliefert und am falschen Stand gemessen wird.

---

## Umsetzung des Code-Reviews (August 2026)

Grundlage: `CODEREVIEW.md`. Ein Abschnitt je Arbeitsschritt, in der dort
empfohlenen Reihenfolge.

### 05.08.2026 — A1: genau ein GPS-Watcher

**Geändert.** `startGeo()` legt die Rückgabe von `watchPosition` in `geoWatchId`
ab und ruft vor jeder Neuregistrierung `clearWatch(geoWatchId)`. Bisher wurde die
ID verworfen; da der Knopf „Erneut versuchen" in **jedem** Fehlerbanner steht,
lief nach fünf Klicks fünfmal `watchPosition` parallel — fünffacher
GPS-Stromverbrauch und bis zu fünf gleichzeitige Overpass-Abfragen pro Fix.

**Geprüft.** Die Watcher-Buchführung ist ohne echtes GPS prüfbar, weil `startGeo`
das `geolocation`-Objekt als Parameter annimmt (Vorgabe: `navigator.geolocation`).
`tests/sensors.test.js` reicht eine Attrappe herein, die Registrierungen zählt
und Abmeldungen mitschreibt:

| Aufrufe von `startGeo` | `watchPosition` | `clearWatch` | `aktiverWatcher()` |
|---|---|---|---|
| vorher, 3× | 3 | 0 (nie gerufen) | – (ID verworfen) |
| jetzt, 1×  | 1 | 0 | 1 |
| jetzt, 3×  | 3 | 2, mit `[1, 2]` | 3 |

Nach beliebig vielen Klicks läuft also genau ein Watcher, und abgemeldet werden
exakt die Vorgänger in der richtigen Reihenfolge. Ein weiterer Fall hält fest,
dass ohne verfügbares `geolocation` kein Watcher entsteht und die Statusanzeige
auf „Kein GPS" springt.

### 05.08.2026 — A3: Zeitlimit und Abbruch für Overpass

**Geändert.** Die Endpunkt-Schleife steckt jetzt in `overpassAbfrage()`. Je
Endpunkt gibt es einen eigenen `AbortController` und ein `setTimeout` auf 25 s;
`clearTimeout` steht im `finally`, damit kein Timer überlebt. Ein `AbortError`
wird in „Zeitüberschreitung nach 25 s" übersetzt und der nächste Endpunkt
probiert. In `fetchObjects` steht `state.loading = false` jetzt im `finally` —
vorher blieb das Flag bei einer Ausnahme auf `true` und blockierte **jeden**
weiteren Ladeversuch, die App wirkte tot, ohne eine Fehlermeldung zu zeigen.

Zwei Dinge, die im Review nur angerissen waren:

- Nach dem Warten wird geprüft, ob die Antwort noch zum aktuellen Ort gehört
  (`if (state.loadedFor !== key) return;`). Sonst überschreibt ein spätes
  Ergebnis die Liste mit Objekten von woanders.
- Im Fehlerfall werden `state.loadedFor` und `state.loadedRadius` **zurückgesetzt**.
  Ohne das gilt der Ort als geladen, `maybeReload` versucht es nie wieder und die
  App bleibt nach einem einzelnen Netzfehler dauerhaft leer.

**Geprüft.** `tests/overpass.test.js`, 8 Fälle, **ohne echten Netzverkehr** —
`overpassAbfrage(query, {fetchImpl, timeoutMs, endpoints})` nimmt eine
`fetch`-Attrappe entgegen. Abgedeckt: Erfolg beim ersten Endpunkt (der zweite
wird dann nicht mehr angefragt), Weiterschalten nach `HTTP 429`, Weiterschalten
nach einem hängenden Endpunkt, Abbruch bei `timeoutMs = 30` mit der Meldung
„Zeitüberschreitung", `signal.aborted === true` nach dem Abbruch, und die
POST-Nutzlast (`data=`-kodiert).

### 05.08.2026 — A2: Umkreis-Regler lädt nach, aber nur wenn nötig

**Geändert.** Der Regler hört zusätzlich auf `change` — das feuert bei einem
`range`-Eingabefeld erst beim Loslassen, während `input` bei jeder Zwischenstufe
kommt. Von dort geht es in `maybeReload()`.

Abweichend von der Anweisung wird **nicht** `maybeReload(true)` gerufen. Ein
erzwungenes Nachladen fragt Overpass auch dann, wenn der Umkreis
**verkleinert** wurde — die Objekte stecken dann längst in den geladenen Daten,
und Overpass ist ein fremder, gedrosselter Dienst. Stattdessen:

- `locKey(lat, lon)` enthält den Umkreis nicht mehr (vorher `lat,lon,r`),
- der zuletzt geladene Umkreis steht getrennt in `state.loadedRadius`,
- `maybeReload` lädt bei `force || Ort gewechselt || radius > loadedRadius`.

**Geprüft.** Durchgespielt am Zustandsautomaten (`state.loadedFor`,
`state.loadedRadius`):

| Aktion | vorher | jetzt |
|---|---|---|
| 60 → 200 km | keine Abfrage, bis zufällig ein GPS-Fix kommt | sofort eine Abfrage |
| 200 → 60 km | Abfrage beim nächsten GPS-Fix, scheinbar grundlos | keine Abfrage |
| 60 → 200 → 60 → 200 | vier Abfragen | eine Abfrage |
| GPS-Fix am selben Ort | Abfrage, sobald der Radius-Schlüssel abweicht | keine Abfrage |
| „Daten neu laden" | Abfrage | Abfrage (`force`) |

Der Nebeneffekt „der nächste GPS-Fix löst wegen des geänderten
Radius-Schlüssels eine Abfrage aus" ist damit weg, weil der Schlüssel den Radius
nicht mehr enthält.

### 05.08.2026 — B1/B2/B3 und die Kleinigkeiten aus D

**Geändert.**

- **B1 (Canvas-Schärfe).** `resizeRadar()` setzt die Pixelgröße auf
  `clientWidth × devicePixelRatio` und skaliert den Kontext auf feste
  `RADAR_UNITS = 600` Zeicheneinheiten. Bewusst nicht auf CSS-Pixel wie in der
  Anweisung: Schriftgrößen (20/22 px) und Punktradien (4/7) waren auf 600
  Einheiten abgestimmt und würden auf einem 330-px-Handy sonst plötzlich riesig
  wirken. So bleibt jedes Größenverhältnis exakt wie bisher, nur die Auflösung
  steigt — auf einem Gerät mit `devicePixelRatio` 3 und 360 CSS-Pixeln von
  600×600 auf 1080×1080. Aufgerufen beim Binden, beim Freischalten der Sensoren
  (vorher meldet der versteckte Canvas `clientWidth === 0`), beim Wechsel auf
  den Radar-Tab, bei `resize` und bei `orientationchange`.
- **B2 (Namen).** `o.hidden` → `o.gefiltert`, `state.hidden` → `state.entfernt`,
  dazu `entferneObjekt` / `entferneAlleSichtbaren` / `zeigeAlleWieder`. Zwei
  Dinge namens „hidden" mit gegensätzlicher Bedeutung gibt es nicht mehr.
- **B3 (Sortier-Option).** Ohne Kompasswert ist „In Blickrichtung zuerst"
  `disabled` und heißt „In Blickrichtung zuerst (Kompass nötig)". Stand die
  Auswahl beim Sperren darauf, wechselt sie auf „Nächste zuerst" und kehrt beim
  ersten Kompasswert zurück — es sei denn, der Nutzer hat inzwischen selbst
  etwas anderes gewählt.
- **D.** `angleDiff` gibt direkt zurück; der Datenhinweis nennt die Beschränkung
  auf benannte Objekte; die Migration in `loadEntfernt` ist datiert; `sw.js`
  prüft `resp.ok`, bevor es cached (sonst landet eine 404-Seite im Cache und
  wird später offline als App-Datei ausgeliefert); `drawRadar` hängt an
  `requestAnimationFrame`.

**Nebenbefund beim rAF-Umbau.** An denselben Takt gehört die Blickfeld-Liste,
sonst folgt sie der Drehung überhaupt nicht (das tat sie vorher auch nicht — sie
wurde nur bei einem Ladevorgang aufgebaut). Sie 60×/s neu aufzubauen tauscht
allerdings den DOM unter dem Finger aus, und ein Tipper auf einen Eintrag geht
ins Leere, weil das Element zwischen `touchstart` und `touchend` ersetzt wird.
Gelöst über eine Signatur aus IDs, Pfeilrichtungen und Entfernungstexten:
`renderFov()` baut nur neu auf, wenn sich die Signatur ändert — beim ruhigen
Halten also gar nicht, beim Drehen nur, wenn ein Objekt ins Blickfeld kommt,
eines herausfällt oder ein Pfeil in den nächsten 45°-Sektor springt. `render()`
setzt die Signatur zurück, weil ein `render()`-Aufruf immer eine echte
Datenänderung meldet.

### 05.08.2026 — C1: Versionsnummer an einer Stelle

**Geändert.** `APP_VERSION` steht einmal im Code und wird beim Binden der
Oberfläche in `<span id="appVersion">` geschrieben. Das fest eingetippte
„Version v10" in `index.html` ist weg.

Es bleiben **zwei** Stellen statt der angestrebten einen: `APP_VERSION` und
`CACHE` in `sw.js`. Weniger geht nicht, ohne den Service Worker selbst zu einem
ES-Modul-Worker zu machen (`type: 'module'` bei `register`) — das ist auf iOS
bis heute nicht überall verlässlich, und ein kaputter Service Worker ist bei
einer PWA teurer als eine Zeile Disziplin. Stattdessen steht im `README.md` eine
**Freigabe-Checkliste**: beide Versionsnummern, die `SHELL`-Liste in `sw.js`,
der Testlauf und die Prüfung über „Update on reload".

### 06.08.2026 — C3/C2: Module verdrahtet, Tests laufen

**Geändert.** Die Aufteilung nach `js/` lag als Dateien schon vor, war aber
nicht angeschlossen: `index.html` lud weiterhin die monolithische
Wurzel-`app.js`, und die `SHELL` in `sw.js` kannte nur diese eine Datei. Der
laufende Code war also der alte, die Module waren totes Gewicht — der
gefährlichste Zwischenstand, weil ein Fehler in `js/ui.js` gesucht worden wäre,
während `app.js` lief.

- `index.html` bindet jetzt `<script type="module" src="js/app.js">`.
- Die `SHELL` in `sw.js` führt alle sechs Module; `CACHE` und `APP_VERSION`
  stehen auf `v12`.
- Die Wurzel-`app.js` ist gelöscht. Ihr Inhalt steht vollständig in den Modulen
  und im Git-Verlauf.
- Die Freigabe-Checkliste im `README.md` zeigt auf `js/store.js` statt auf
  `app.js`.

**Kontrolle vor dem Verdrahten:** Funktionsbestand des Monolithen gegen die
Module gezählt — keine der 51 Funktionen fehlt; die Module haben acht dazu, die
vorher namenlose Blöcke oder gar nicht vorhanden waren (`setzeFixRueckruf`,
`stopGeo`, `aktiverWatcher`, `dedupe`, `setPill`, `sortAuswahlGeaendert`,
`starteSensoren`, `bannerSichtbar`).

**Kontrolle danach**, im Browser über den lokalen Server:

| Prüfung | Ergebnis |
|---|---|
| `tests/test.html` | alle **65** Tests bestanden |
| Startseite | lädt `js/app.js` als Modul, Version `v12`, keine Konsolenfehler |
| GPS-Attrappe → Overpass-Attrappe | „3 Objekte geladen.", GPS-Pille „±12m" |
| Liste | 💧 Suedsee S · 27 km, ⛰️ Nordberg N · 1200 m · 29 km, 🏘️ Ostdorf O · 46 km |
| Suche „nord" | filtert auf den einen Treffer |
| Radar-Canvas | zeichnet, 450 px bei `devicePixelRatio` 1 |
| Umkreis 60 → 200 km | **eine** Overpass-Abfrage |
| Umkreis 200 → 60 km | **keine** Abfrage (A2-Regel hält auch im Modulaufbau) |

GPS und `fetch` wurden dafür im Seitenkontext durch Attrappen ersetzt; es ging
kein Abruf an Overpass hinaus.

**Zu C2:** Die Tests waren bereits geschrieben (65 in drei Dateien) und liefen
gegen die Module — nur eben gegen Code, den die App nicht benutzte. Mit dem
Verdrahten prüfen sie jetzt den ausgelieferten Stand.
