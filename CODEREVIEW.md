# Code-Review: claude-geo (GeoPeil)

Stand: 04.08.2026 · Umfang: `app.js` 651 Zeilen, `index.html`, `style.css`, `sw.js`

Eine schlanke, gut lesbare PWA. Besonders gelungen: die plattformspezifische
Diagnose bei blockiertem Standort/Kompass (`gpsHelpHtml`/`compassHelpHtml`), die
zirkuläre Glättung des Kompasswerts und der bewusste Vorrang absoluter gegenüber
relativer Orientierungsereignisse (`app.js:186-189`) — das sind Details, an denen
die meisten Kompass-Apps scheitern.

Die Befunde betreffen vor allem Ressourcen (mehrfach registrierte GPS-Watcher)
und zwei Stellen, an denen die Bedienung nicht das tut, was der Nutzer erwartet.

> **Stand 06.08.2026: alle zwölf Befunde erledigt** (A1–A3, B1–B3, C1–C3, D).
> Die App läuft als `v12` aus den Modulen unter `js/`, 65 Tests laufen im
> Browser über `tests/test.html`. Details je Befund in den Kästen unten,
> ausführlich in `ENTWICKLUNG.md`.

---

## A. Wichtig

### A1. Jeder Neuversuch registriert einen weiteren GPS-Watcher — ✅ erledigt 05.08.2026

> **Behoben.** `startGeo()` merkt sich die Watcher-ID in `geoWatchId` und ruft
> vor jeder Neuregistrierung `clearWatch` darauf. Der Parameter `geo` ist
> injizierbar, damit die Buchführung ohne echtes GPS prüfbar ist.
> **Gegenprobe** (`tests/sensors.test.js`, Gruppe „startGeo"): drei Aufrufe
> hintereinander ergeben **3 Registrierungen, 2 Abmeldungen** (`[1, 2]`, in
> dieser Reihenfolge) und `aktiverWatcher() === 3` — also genau **ein** laufender
> Watcher, egal wie oft „Erneut versuchen" gedrückt wird. Vorher: 3 Watcher,
> 0 Abmeldungen. Ein zusätzlicher Test hält fest, dass ohne verfügbares
> `geolocation` gar kein Watcher entsteht.

**Wo:** `startGeo()` (`:142-169`), aufgerufen aus `enableSensors()` (`:243`),
das wiederum von `retrySensors()` (`:258-262`) erneut aufgerufen wird.

`navigator.geolocation.watchPosition` gibt eine ID zurück, die nirgends
gespeichert und nie an `clearWatch` übergeben wird. Jeder Klick auf
"Erneut versuchen" — der Knopf steht in **jedem** Fehlerbanner — startet einen
zusätzlichen, parallel laufenden Watcher. Nach fünf Versuchen laufen fünf
Watcher; jeder ruft bei jedem Fix `recompute()`, `render()` und `maybeReload()`
auf. Auf dem Handy heißt das: mehrfacher GPS-Stromverbrauch und potenziell
mehrere gleichzeitige Overpass-Abfragen.

**Anweisung:**
```js
let geoWatchId = null;
function startGeo(){
  if (!('geolocation' in navigator)){ setGps('Kein GPS','off'); return; }
  if (geoWatchId !== null) navigator.geolocation.clearWatch(geoWatchId);
  geoWatchId = navigator.geolocation.watchPosition(/* … unverändert … */);
}
```
Zusätzlich in `enableSensors()` den `compassTimer` bereits gesetzt löschen —
das passiert in `:246` schon korrekt, hier also nichts zu tun.

### A2. Radius-Änderung lädt keine neuen Daten nach — ✅ erledigt 05.08.2026

> **Behoben, mit einer Abweichung.** Der Radius-Regler hört jetzt zusätzlich auf
> `change` (feuert beim Loslassen, nicht bei jeder Zwischenstufe) und stößt von
> dort `maybeReload()` an.
>
> **Abweichung von der Anweisung:** dort steht `maybeReload(true)` — also
> erzwungenes Nachladen bei *jeder* Radiusänderung. Das schickt auch beim
> **Verkleinern** eine Abfrage an Overpass, obwohl die Objekte in den geladenen
> Daten längst enthalten sind. Overpass ist ein fremder, gedrosselter Dienst;
> unnötige Abfragen sind hier keine Kleinigkeit. Stattdessen:
> `locKey` enthält den Umkreis nicht mehr (nur noch `lat,lon` auf zwei
> Nachkommastellen), der zuletzt geladene Umkreis steht getrennt in
> `state.loadedRadius`, und `maybeReload` lädt nach, wenn
> `force || Ort gewechselt || settings.radius > loadedRadius`.
>
> Ergebnis: 60 → 200 km lädt sofort nach (vorher: gar nicht, bis irgendwann ein
> GPS-Fix kam), 200 → 60 km lädt nicht (vorher: beim nächsten GPS-Fix, scheinbar
> grundlos), 60 → 200 → 60 → 200 km ergibt **eine** Abfrage statt vier. Der
> Nebeneffekt „nächster GPS-Fix löst wegen des geänderten Radius-Schlüssels eine
> Abfrage aus" ist damit weg, weil der Schlüssel den Radius nicht mehr enthält.

**Wo:** Slider-Bindung `bind('radius', …)` (`:621`) gegen `maybeReload` (`:363`)

Wird der Umkreis von 60 auf 200 km erhöht, ruft der Slider nur `recompute()` und
`render()`. `recompute` blendet lediglich Objekte **außerhalb** des Radius aus —
neue Objekte kann es nicht anzeigen, weil sie nie geladen wurden. Der Nutzer
sieht: Regler nach rechts, nichts passiert. Erst der nächste GPS-Fix (bis zu
mehrere Sekunden später) löst über den geänderten `locKey` einen Nachladevorgang
aus — und dann scheinbar grundlos.

**Anweisung:** Beim Radius-Slider zusätzlich neu laden, aber erst nach dem
Loslassen (sonst feuert jede Zwischenstufe eine Overpass-Abfrage):
```js
bind('radius','radius','radiusVal', () => { recompute(); render(); drawRadar(); });
$('#radius').addEventListener('change', () => maybeReload(true));   // change ≠ input
```
`change` löst bei einem `range`-Input erst beim Loslassen aus — genau das richtige
Ereignis dafür.

### A3. Overpass-Abfragen ohne Timeout und ohne Abbruch — ✅ erledigt 05.08.2026

> **Behoben.** Die Endpunkt-Schleife steckt jetzt in `overpassAbfrage()`
> (`js/overpass.js`): je Endpunkt ein eigener `AbortController` mit
> `setTimeout(..., 25000)`, `clearTimeout` im `finally`. Ein `AbortError` wird in
> die lesbare Meldung „Zeitüberschreitung nach 25 s" übersetzt, danach wird der
> nächste Endpunkt probiert. `state.loading = false` steht im `finally` von
> `fetchObjects`, `state.loadedFor`/`loadedRadius` werden im Fehlerfall
> zurückgenommen — sonst gälte der Ort als geladen und die App bliebe nach einem
> Netzfehler dauerhaft leer.
>
> **Gegenprobe** (`tests/overpass.test.js`, 8 Fälle, **kein echter Netzverkehr** –
> `fetchImpl`, `timeoutMs` und `endpoints` sind für Tests injizierbar):
> ein Endpunkt, der nie antwortet, bricht bei `timeoutMs = 30` ab und die
> Fehlermeldung enthält „Zeitüberschreitung"; ein hängender erster Endpunkt führt
> dazu, dass der **zweite** benutzt wird; das durchgereichte `signal` ist nach dem
> Abbruch `aborted === true`; nach einer erfolgreichen Antwort wird der zweite
> Endpunkt **nicht** mehr angefragt (1 Aufruf statt 2); `HTTP 429` zählt als
> Fehlschlag und wandert weiter zum nächsten Endpunkt.
>
> Der Veraltungs-Schutz `if (state.loadedFor !== key) return;` ist ebenfalls drin.

**Wo:** `fetchObjects()` (`:328-361`)

Zwei Endpunkte werden nacheinander probiert, aber `fetch` hat kein clientseitiges
Zeitlimit. Ist `overpass-api.de` überlastet (kommt regelmäßig vor), hängt die
Abfrage minutenlang, `state.loading` bleibt `true` und blockiert jeden weiteren
Ladeversuch — die App wirkt tot, ohne dass "Fehler beim Laden" erscheint.

Zusätzlich: Bewegt sich der Nutzer während des Ladens, kann ein zweiter
`fetchObjects`-Aufruf zwar durch `state.loading` verhindert werden, aber ein
veraltetes Ergebnis überschreibt danach ungefragt `state.objects`.

**Anweisung:**
```js
const ac = new AbortController();
const t  = setTimeout(() => ac.abort(), 25000);
try {
  const resp = await fetch(ep, {method:'POST', body:'data='+encodeURIComponent(q),
                               signal: ac.signal});
  …
} finally { clearTimeout(t); }
```
Und vor dem Übernehmen des Ergebnisses prüfen, ob der Ladeschlüssel noch aktuell
ist:
```js
if (state.loadedFor !== key) return;   // Standort hat sich zwischenzeitlich geändert
```
`state.loading = false` gehört in ein `finally`, damit es auch bei einer Exception
zurückgesetzt wird.

---

## B. Korrektheit

### B1. Canvas ignoriert die Gerätepixeldichte — ✅ erledigt 05.08.2026

> **Behoben, leicht anders als vorgeschlagen.** `resizeRadar()` setzt
> `cv.width = cv.height = round(clientWidth × devicePixelRatio)` und skaliert den
> Kontext per `setTransform`. Aufgerufen wird es beim Binden der Oberfläche, beim
> Freischalten der Sensoren (vorher hat der versteckte Canvas `clientWidth === 0`
> gemeldet), beim Wechsel auf den Radar-Tab sowie bei `resize` und
> `orientationchange`.
>
> **Abweichung:** die Anweisung skaliert mit dem reinen `devicePixelRatio` und
> lässt die Zeichenlogik in CSS-Pixeln rechnen. Dann wäre der Radar auf einem
> schmalen Handy (CSS-Breite 330 px statt der bisherigen 600) plötzlich in allen
> Größen anders: 20-px-Schrift und Punktradius 4/7 waren auf 600 Einheiten
> abgestimmt. Deshalb wird auf `RADAR_UNITS = 600` skaliert
> (`s = px / 600`) — alle Größenverhältnisse bleiben exakt wie bisher, nur die
> Auflösung steigt. Auf einem Gerät mit `devicePixelRatio` 3 und 360 CSS-Pixeln
> Breite zeichnet der Canvas jetzt 1080×1080 statt 600×600 Pixel.

**Wo:** `index.html:46` (`<canvas width="600" height="600">`), `drawRadar()`
(`:505-557`)

Die Zeichenfläche ist fest 600×600 CSS-unabhängige Pixel; auf einem Handy mit
`devicePixelRatio` 3 wird sie hochskaliert dargestellt und wirkt unscharf —
gerade bei den kleinen Objektpunkten (Radius 4 px) und den Beschriftungen.

**Anweisung:**
```js
function resizeRadar(){
  const cv = $('#radar'), r = window.devicePixelRatio || 1;
  const seite = cv.clientWidth;
  cv.width = cv.height = Math.round(seite * r);
  cv.getContext('2d').setTransform(r, 0, 0, r, 0, 0);
}
```
in `bindUI` und im vorhandenen `resize`-Listener (`:638`) aufrufen, danach
`drawRadar()`. Die Zeichenlogik selbst kann in CSS-Pixeln bleiben, wenn `W`/`H`
aus `clientWidth` statt aus `cv.width` gelesen werden.

### B2. `recompute()` filtert, ohne dass der Aufrufer es merkt — ✅ erledigt 05.08.2026

> **Behoben.** Umbenannt wie vorgeschlagen: `o.hidden` → `o.gefiltert`
> (Radius-/Höhenkriterium), `state.hidden` → `state.entfernt` (vom Nutzer
> gelöschte IDs). Mit umbenannt wurden die Hilfsfunktionen:
> `hideObject`/`hideAllVisible`/`unhideAll` → `entferneObjekt` /
> `entferneAlleSichtbaren` / `zeigeAlleWieder`; das nur einmal benutzte
> `isHidden` ist ersatzlos weg. Beide Kommentarblöcke verweisen jetzt
> gegenseitig aufeinander.
>
> **Gegenprobe:** `grep -n "hidden" js/` findet nur noch das HTML-Attribut
> `hidden` (Tabs, Sheet, `permGate`) und den localStorage-Schlüssel
> `geo.hidden`, der beim Start der Migration wegen gelöscht wird — keine
> Zustandsvariable mehr. Das Verhalten aus Commit 047b1e6 (Löschen wirkt nur
> sitzungsweise, frische Daten zeigen wieder alles) ist unverändert:
> `state.entfernt.clear()` steht weiterhin im Erfolgszweig von `fetchObjects`.

**Wo:** `:380-383` setzt `o.hidden` als Eigenschaft **auf dem Objekt**, während
`state.hidden` ein separates Set für nutzerseitig ausgeblendete Einträge ist.
Zwei Dinge namens "hidden" mit völlig unterschiedlicher Bedeutung im selben
Zustand — `visibleObjects()` (`:386`) muss beide prüfen.

**Anweisung:** Umbenennen: `o.ausserhalb` (bzw. `o.gefiltert`) für das
Radius-/Höhenkriterium, `state.entfernt` für die vom Nutzer gelöschten IDs. Rein
kosmetisch, spart aber beim nächsten Anfassen eine Fehlersuche.

### B3. Sortierung "In Blickrichtung zuerst" ohne Kompass — ✅ erledigt 05.08.2026

> **Behoben.** `updateSortOptions()` sperrt die Option per `disabled`, solange
> `state.heading == null`, und hängt den Hinweis direkt in den Optionstext:
> „In Blickrichtung zuerst (Kompass nötig)". Ein `<option>` kann kein eigenes
> Label daneben tragen — der Zusatz im Text ist die einzige Stelle, die auch im
> zugeklappten `<select>` sichtbar ist.
>
> Zwei Feinheiten, die in der Anweisung fehlen: stand die Auswahl beim Sperren
> auf `dir`, wird sie auf `dist` gestellt (sonst zeigt das `<select>` eine
> gesperrte Option an) und beim Eintreffen des ersten Kompasswerts wieder
> zurück — aber nur, wenn der Nutzer in der Zwischenzeit nicht selbst etwas
> anderes gewählt hat (`sortDirErsetzt`). Und die Funktion steigt sofort aus,
> wenn sich am Zustand nichts geändert hat; sie hängt an jedem Kompass-Ereignis
> (bis zu 60×/s) und darf dort nichts kosten.

**Wo:** `renderList()` (`:457-461`), `inView()` (`:388-391`)

Ohne Kompasswert liefert `inView` immer `false`, die Sortierung fällt still auf
Distanz zurück. Für den Nutzer sieht die gewählte Option dann funktionslos aus.

**Anweisung:** Wenn `state.heading == null` ist, die Option im `<select>` per
`disabled` sperren und einen Hinweis daneben setzen ("Kompass nötig"). Bei
eintreffendem Kompasswert wieder freigeben.

---

## C. Struktur und Wartbarkeit

### C1. Versionsnummer an drei Stellen — ✅ erledigt 05.08.2026

> **Behoben.** `APP_VERSION` steht einmal in `js/store.js` und wird beim Binden
> der Oberfläche per `textContent` in `<span id="appVersion">` geschrieben; das
> fest eingetippte „Version v10" in `index.html` ist weg. Bleiben **zwei**
> Stellen, die zusammen hochgezählt werden müssen: `APP_VERSION` und `CACHE` in
> `sw.js`. Weniger geht nicht — der Service Worker läuft in einem eigenen
> Kontext und kann kein Modul der App importieren, ohne selbst ein
> ES-Modul-Worker zu werden (auf iOS bis heute nicht überall verlässlich).
> Deshalb steht in `README.md` jetzt eine **Freigabe-Checkliste** mit genau
> diesen zwei Stellen, der `SHELL`-Liste (Befund C3 legt neue Dateien an) und
> der Prüfung über „Update on reload".

`sw.js:4` (`geopeil-v10`), `index.html:31` (`Version v10`) und implizit der
Git-Commit-Text. Aus den bisherigen Sitzungen ist bekannt, dass ein vergessener
Cache-Bump dazu führt, dass der Service Worker alten `app.js`-Code ausliefert und
Tests am falschen Stand laufen.

**Anweisung:** In `app.js` ganz oben `const APP_VERSION = 'v11';` definieren, im
Setup-Bereich per `textContent` einsetzen und in `README.md` eine
Freigabe-Checkliste ergänzen:
> Vor jedem Push: `CACHE` in `sw.js` **und** `APP_VERSION` in `app.js` erhöhen,
> danach in den Entwicklertools "Update on reload" prüfen.

### C2. Keine Tests für die Geometrie — ✅ erledigt 06.08.2026

> **Erledigt, mit größerem Zuschnitt als angewiesen.** Statt einer `tests.html`
> mit Konsolenausgaben gibt es `tests/` mit einem eigenen Läufer (`lauf.js`,
> ohne Abhängigkeiten — node und npm gibt es auf diesem Rechner nicht) und
> **65 Tests** in drei Dateien: `geo.test.js` (32) über `haversine`, `bearing`,
> `angleDiff`, `cardinal`, `fmtDist`, `arrowFor`, `imBlickfeld`;
> `overpass.test.js` (26) über `buildQuery`, `classify`, `parseElements`,
> `dedupe`, `locKey` und `overpassAbfrage` mit `fetch`-Attrappe;
> `sensors.test.js` (7) über die Watcher-Buchführung aus A1. Kein Test geht ins
> Netz. Aufruf: `tests/test.html` im Browser, die Kopfzeile meldet das Ergebnis.

`haversine`, `bearing`, `angleDiff`, `cardinal` und `fmtDist` sind reine
Funktionen und der mathematische Kern der App — bisher ungetestet.

**Anweisung:** Eine `tests.html`, die `app.js` als Modul lädt und ein paar
Behauptungen in die Konsole schreibt (kein Build-Schritt nötig). Fälle:
- `haversine` Berlin↔München ≈ 504 km (±2 km)
- `bearing` von Nord nach Süd = 180°, von West nach Ost ≈ 90°
- `angleDiff(350, 10)` = −20, `angleDiff(10, 350)` = 20 (Wrap-around)
- `cardinal(0)`='N', `cardinal(337.5)`='NW', `cardinal(359)`='N'
- `fmtDist(0.5)`='500 m', `fmtDist(5.25)`='5.3 km', `fmtDist(120)`='120 km'

Dafür müsste `app.js` die Funktionen exportieren — was ohnehin sinnvoll ist
(siehe C3).

### C3. Ein monolithisches Skript — ✅ erledigt 06.08.2026

> **Erledigt.** Aus `app.js` (zuletzt 784 Zeilen) sind sechs Module unter `js/`
> geworden: `geo.js` (64), `overpass.js` (116), `store.js` (93), `sensors.js`
> (160), `ui.js` (344), `app.js` (175). `index.html` lädt nur noch
> `<script type="module" src="js/app.js">`, die `SHELL` in `sw.js` führt alle
> sechs Dateien, `CACHE` und `APP_VERSION` stehen auf `v12`. Die alte
> Wurzel-`app.js` ist gelöscht — sie wäre toter Code gewesen, der beim nächsten
> Fehler zuerst gelesen wird.
>
> **Kontrolle:** Der Funktionsbestand des Monolithen wurde gegen die Module
> gezählt — **keine** Funktion fehlt, die Module haben zusätzlich
> `setzeFixRueckruf`, `stopGeo`, `aktiverWatcher`, `dedupe`, `setPill`,
> `sortAuswahlGeaendert`, `starteSensoren` und `bannerSichtbar` (vorher
> namenlose Blöcke oder Testzugänge). Im Browser gegengeprüft mit Attrappen für
> GPS und `fetch`: Fix → Overpass → Parsen → Liste („💧 Suedsee S · Gewässer
> 27 km", „⛰️ Nordberg N · 1200 m 29 km", „🏘️ Ostdorf O · village 46 km"),
> Suche filtert, Radar zeichnet, und die A2-Regel hält — 60 → 200 km löst
> **eine** Abfrage aus, 200 → 60 km **keine**. Keine Konsolenfehler.

651 Zeilen im globalen Namensraum: Sensorik, Overpass-Abfrage, Geometrie,
Rendering und UI-Verdrahtung.

**Anweisung:** Auf `<script type="module">` umstellen und aufteilen:
`geo.js` (Geometrie, rein), `overpass.js` (Abfrage/Parsing), `sensors.js`
(GPS/Kompass), `ui.js` (Rendering/Radar), `app.js` (Verdrahtung). Der
Service-Worker-`SHELL` muss dann die neuen Dateien mit aufnehmen — leicht zu
vergessen, gehört in die Checkliste aus C1.

---

## D. Kleinigkeiten — ✅ erledigt 05.08.2026

> **Behoben, Punkt für Punkt:**
> - `angleDiff` gibt direkt zurück (`return ((a-b+540)%360)-180;`).
> - Der Datenhinweis in den Einstellungen sagt jetzt, dass nur **benannte**
>   Objekte angezeigt werden; ausführlicher noch einmal im `README.md`.
> - `escapeHtml`: unverändert gelassen wie empfohlen. `cardinal()` liefert einen
>   von acht festen Strings, `o.elev` ist eine Zahl aus `Math.round` — beides
>   kann kein Markup enthalten.
> - Zur Alterung von `state.saved` steht ein Absatz im `README.md` (samt
>   Begründung, warum trotzdem eine Kopie gespeichert wird und nicht nur die ID).
> - `loadEntfernt` (früher `loadHidden`): die Migration ist datiert — „seit
>   08.2026 … kann ab ca. 11.2026 raus".
> - `drawRadar` hängt über `planeRadar()` an `requestAnimationFrame`.
>   **Zusätzlich nötig geworden:** an denselben Takt gehört die Blickfeld-Liste,
>   sonst folgt sie der Drehung nicht. Sie 60×/s neu aufzubauen tauscht aber den
>   DOM unter dem Finger aus und lässt Tipper ins Leere gehen. Deshalb bildet
>   `renderFov()` eine Signatur aus IDs, Pfeilen und Entfernungstexten und baut
>   nur neu auf, wenn die sich ändert — beim ruhigen Halten also gar nicht.
>   `render()` setzt die Signatur zurück, weil ein `render()`-Aufruf immer eine
>   echte Datenänderung meldet.
> - `sw.js` prüft `resp.ok`, bevor die Antwort in den Cache geht.

- `angleDiff` (`:130`): `let d = …; return d;` — direkt zurückgeben.
- `widerstaende`-Analogon: `hoch.iloc`-Muster gibt es hier nicht; stattdessen
  `parseElements` (`:304-324`) verwirft Objekte ohne Namen still. Das ist
  gewollt, sollte aber im Datenhinweis auftauchen ("nur benannte Objekte").
- `escapeHtml` (`:431`) wird auf `o.name` und `o.sub` angewandt — richtig, da die
  Werte aus OSM stammen. In `itemEl` (`:401`) wird `dir` (aus `cardinal`) und
  `o.elev` unescaped eingefügt; beides sind projekteigene Zahlen/Konstanten, also
  unbedenklich. So lassen, aber nicht zum Muster machen.
- `state.saved` (`:87-97`) speichert eine Kopie des Objekts. Ändert sich in OSM
  die Position, bleibt der gespeicherte Eintrag veraltet. Für Favoriten
  akzeptabel — im README einen Satz dazu.
- `loadHidden` (`:103-107`) räumt bei jedem Start `geo.hidden` aus dem
  localStorage auf. Das ist eine Migration von einer alten Version; nach ein paar
  Wochen kann sie weg (Kommentar mit Datum versehen, damit klar ist, ab wann).
- `drawRadar` zeichnet bei jedem Kompass-Ereignis (`:209`) neu, also potenziell
  60×/Sekunde. Über `requestAnimationFrame` entkoppeln:
  ```js
  let radarPending = false;
  function planeRadar(){ if (radarPending) return; radarPending = true;
    requestAnimationFrame(() => { radarPending = false; drawRadar(); }); }
  ```
- `sw.js` cached bei network-first jede erfolgreiche Antwort — auch Fehlerseiten
  mit Status 404, weil `resp.ok` nicht geprüft wird. Vor `c.put` ergänzen:
  `if (resp.ok)`.

---

## Reihenfolge der Umsetzung

1. **A1** (Watcher-Leck) — Akkuverbrauch, betrifft jeden Neuversuch
2. **A3** (Timeout/Abbruch) — verhindert den "App hängt"-Zustand
3. **A2** (Radius lädt nach) — die auffälligste Bedienschwäche
4. **C1** (Versions-Disziplin) — verhindert Fehlmessungen bei künftigen Tests
5. **B1** (Canvas-Schärfe), **B3** (Sortier-Option)
6. **C2/C3** (Module + Tests) ✅ 06.08.2026 — Module verdrahtet (`v12`), 65 Tests
   grün, die alte Wurzel-`app.js` gelöscht

**Alle Befunde des Reviews sind umgesetzt.**
