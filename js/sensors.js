/* ============================================================
   Sensoren: GPS (watchPosition) und Kompass (deviceorientation).
   Pflegt state.pos / state.heading, setzt die Statusanzeigen und meldet
   neue Fixe über einen Rückruf an die Ladeschicht.
   ============================================================ */

import { toRad, toDeg } from './geo.js';
import { state, recompute } from './store.js';
import { setGps, setHead, showBanner, clearBanner, bannerSichtbar,
         gpsHelpHtml, compassHelpHtml,
         updateSortOptions, renderHeading, planeRadar } from './ui.js';

/* Rückruf für „neuer Standort" – app.js hängt hier maybeReload ein.
   Über einen Rückruf statt eines Imports, damit sensors.js nichts über die
   Overpass-Schicht wissen muss. */
let onFix = () => {};
export function setzeFixRueckruf(fn){ onFix = fn; }

/* ---------- GPS ----------
   Genau ein Watcher. Ohne die gespeicherte ID startete jeder Klick auf
   „Erneut versuchen" – der Knopf steht in jedem Fehlerbanner – einen
   zusätzlichen, parallel laufenden Watcher: mehrfacher GPS-Stromverbrauch und
   mehrere gleichzeitige Overpass-Abfragen pro Fix. */
let geoWatchId = null;
let geoQuelle = null;

/* Die ID des einzigen laufenden Watchers (null = keiner läuft). */
export function aktiverWatcher(){ return geoWatchId; }

/* Meldet den laufenden Watcher ab. Merkt sich die Quelle mit, damit auch
   abgemeldet wird, wenn beim nächsten Start eine andere kommt. */
export function stopGeo(){
  if (geoWatchId !== null && geoQuelle) geoQuelle.clearWatch(geoWatchId);
  geoWatchId = null;
  geoQuelle = null;
}

/* quelle ist injizierbar, damit die Watcher-Buchführung ohne echtes GPS
   geprüft werden kann (tests/sensors.test.js). */
export function startGeo(quelle = (('geolocation' in navigator) ? navigator.geolocation : null)){
  if (!quelle){ setGps('Kein GPS', 'off'); return null; }

  stopGeo();
  geoQuelle = quelle;

  geoWatchId = quelle.watchPosition(
    p => {
      const first = !state.pos;
      state.pos = { lat:p.coords.latitude, lon:p.coords.longitude, acc:p.coords.accuracy };
      setGps('GPS ±' + Math.round(p.coords.accuracy) + 'm', 'ok');
      clearBanner('gps');
      recompute();
      // Beim ersten Fix (oder größerer Bewegung) Daten laden
      onFix(first);
    },
    err => {
      if (err.code === err.PERMISSION_DENIED){
        setGps('Standort blockiert', 'warn');
        showBanner('gps', 'error', gpsHelpHtml('Standortzugriff ist blockiert.'));
      } else if (err.code === err.POSITION_UNAVAILABLE){
        setGps('Standort n/a', 'warn');
        showBanner('gps', 'warn', gpsHelpHtml('Kein Standort verfügbar – ist GPS eingeschaltet?'));
      } else { // TIMEOUT
        setGps('Standort langsam', 'warn');
        showBanner('gps', 'warn', `<b>Standort dauert zu lange.</b><br>Am besten im Freien erneut versuchen.
          <br><button class="btn" data-action="retry">Erneut versuchen</button>`);
      }
    },
    { enableHighAccuracy:true, maximumAge:5000, timeout:20000 }
  );
  return geoWatchId;
}

/* ---------- Kompass ---------- */
let headingSmooth = null;
let hasAbsolute = false;   // haben wir schon nordbezogene (absolute) Werte gesehen?

export function onOrientation(e){
  let h = null;
  let absolute = false;
  if (typeof e.webkitCompassHeading === 'number'){
    h = e.webkitCompassHeading;                  // iOS: bereits 0=N im Uhrzeigersinn
    absolute = true;
  } else if (typeof e.alpha === 'number'){
    h = (360 - e.alpha);                         // Android
    absolute = (e.absolute === true) || e.type === 'deviceorientationabsolute';
  }
  if (h == null || Number.isNaN(h)) return;

  // Nordbezogene Werte bevorzugen: sobald es die gibt, relative Ereignisse
  // ignorieren. Sonst kämpfen absoluter und relativer Kompass gegeneinander
  // → „Zappeln".
  if (absolute) hasAbsolute = true;
  if (hasAbsolute && !absolute) return;

  // Bildschirm-Drehung berücksichtigen
  const so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  h = (h + so + 360) % 360;

  // Glätten (zirkulär) – stärkere Glättung gegen Magnetometer-Rauschen
  const rad = toRad(h);
  const vx = Math.cos(rad), vy = Math.sin(rad);
  if (!headingSmooth) headingSmooth = { x:vx, y:vy };
  const k = 0.12;
  headingSmooth.x += (vx - headingSmooth.x) * k;
  headingSmooth.y += (vy - headingSmooth.y) * k;
  const sh = (toDeg(Math.atan2(headingSmooth.y, headingSmooth.x)) + 360) % 360;

  state.rawHeading = sh;
  state.heading = (sh + state.settings.decl + 360) % 360;
  setHead('Kompass', 'ok');
  clearBanner('compass');
  updateSortOptions();
  renderHeading();
  if (state.currentView === 'radar') planeRadar();
}

/* ---------- Anschalten ---------- */
let orientationBound = false;
let compassTimer = null;

export async function enableSensors(){
  // iOS 13+: explizite Kompass-Erlaubnis (nur per Nutzer-Geste möglich)
  let iosDenied = false;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'){
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') iosDenied = true;
    }
  } catch {
    // Wirft u. a., wenn „Bewegung & Ausrichtung" in den iOS-Safari-Einstellungen aus ist
    iosDenied = true;
  }
  if (iosDenied){
    setHead('Kompass gesperrt', 'warn');
    showBanner('compass', 'error', compassHelpHtml('Kompass ist vom System gesperrt.'));
  }

  // Orientierungs-Listener nur einmal binden
  if (!orientationBound){
    window.addEventListener('deviceorientationabsolute', onOrientation, true);
    window.addEventListener('deviceorientation', onOrientation, true);
    orientationBound = true;
  }

  startGeo();

  // Kompass-Timeout: kommen keine Daten, klaren Hinweis zeigen
  // (ohne einen bereits sichtbaren GPS-Fehler zu überschreiben)
  clearTimeout(compassTimer);
  compassTimer = setTimeout(() => {
    if (state.heading == null && !iosDenied){
      setHead('Kompass?', 'warn');
      if (!bannerSichtbar()){
        showBanner('compass', 'warn', compassHelpHtml('Kompass liefert noch keine Daten.'));
      }
    }
  }, 4000);
}
