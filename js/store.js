/* ============================================================
   Zustand + Persistenz (localStorage) + abgeleitete Werte.
   Kein DOM – wer hier etwas ändert, ruft anschließend selbst render().
   ============================================================ */

import { haversine, bearing, imBlickfeld } from './geo.js';

// Einzige Quelle für die Versionsanzeige. Muss zusammen mit CACHE in sw.js
// hochgezählt werden, sonst liefert der Service Worker alten Code aus und
// Tests laufen am falschen Stand (Freigabe-Checkliste im README.md).
export const APP_VERSION = 'v14';

// Gipfel bekommen einen eigenen, größeren Umkreis als Orte/Gewässer: Berge sind
// aus 100 km sichtbar und anpeilbar, ein Dorf nicht. Jenseits des normalen
// Umkreises (state.settings.radius) zählen nur Berge ab FERN_GIPFEL_MIN_ELE,
// sonst überschwemmen tausende benannte Mittelgebirgshügel Abfrage und Radar.
export const BERG_REICHWEITE_KM = 100;
export const FERN_GIPFEL_MIN_ELE = 800;

export const state = {
  pos: null,            // {lat, lon, acc}
  heading: null,        // Grad, 0=Nord, im Uhrzeigersinn (korrigiert)
  rawHeading: null,     // ohne Kompass-Korrektur
  objects: [],          // geladene Objekte mit berechneter Distanz/Peilung
  saved: loadSaved(),
  entfernt: loadEntfernt(),  // vom Nutzer aus der Liste gelöschte Objekt-IDs
  loadedFor: null,      // Ortsschlüssel des letzten Overpass-Ladevorgangs
  loadedRadius: 0,      // Umkreis (km), für den zuletzt geladen wurde
  loading: false,
  radarMax: 0,          // km-Reichweite, auf die der Radar gerade skaliert
  settings: loadSettings(),
  currentView: 'radar',
};

/* Reichweite nur für Gipfel: mindestens der eingestellte Umkreis, sonst die
   Bergreichweite. */
export function gipfelRadius(){ return Math.max(state.settings.radius, BERG_REICHWEITE_KM); }

/* ---------- Einstellungen ---------- */
export function defaultSettings(){
  // 40 km statt früher 60: 60 km lieferte im Ballungsraum ~7000 Objekte / 1,7 MB
  // und lief regelmäßig in den Overpass-Timeout. Anpeilbar ist so weit ohnehin
  // fast nichts außer Bergen.
  return { radius:40, minElev:0, fov:25, decl:0,
           cats:{ peak:true, water:true, place:true, sight:false } };
}
export function loadSettings(){
  try {
    const s = Object.assign(defaultSettings(), JSON.parse(localStorage.getItem('geo.settings')||'{}'));
    // Auf den Regelbereich klemmen: ein früher gespeicherter Umkreis (bis 300 km)
    // läge sonst über der neuen Obergrenze und der Schieberegler zeigte etwas
    // anderes als der wirksame Wert.
    s.radius = Math.min(150, Math.max(5, Number(s.radius) || 40));
    return s;
  }
  catch { return defaultSettings(); }
}
export function saveSettings(){
  try { localStorage.setItem('geo.settings', JSON.stringify(state.settings)); } catch {}
}

/* ---------- Favoriten ----------
   Gespeichert wird eine Kopie des Objekts, nicht nur die OSM-ID: so bleibt der
   Favorit auch ohne Netz und außerhalb des geladenen Umkreises anzeigbar.
   Preis: ändert sich die Position in OSM, altert der Eintrag (steht im README). */
export function loadSaved(){
  try { return JSON.parse(localStorage.getItem('geo.saved')||'[]'); } catch { return []; }
}
export function persistSaved(){
  try { localStorage.setItem('geo.saved', JSON.stringify(state.saved)); } catch {}
}
export function isSaved(id){ return state.saved.some(o => o.id === id); }
export function toggleSaved(obj){
  const i = state.saved.findIndex(o => o.id === obj.id);
  if (i >= 0) state.saved.splice(i, 1);
  else state.saved.push({ id:obj.id, name:obj.name, kind:obj.kind, lat:obj.lat,
                          lon:obj.lon, elev:obj.elev, sub:obj.sub });
  persistSaved();
}

/* ---------- Vom Nutzer entfernte Objekte (aus der Liste gelöscht) ----------
   Nur für die laufende Sitzung: „Daten neu laden", ein neuer Standort oder ein
   App-Neustart zeigen wieder die volle Liste. Sonst blieben gelöschte Objekte
   wegen stabiler OSM-IDs dauerhaft weg.
   Nicht verwechseln mit o.gefiltert – das ist der Radius-/Höhenfilter. */
export function loadEntfernt(){
  // Migration seit 08.2026: bis v9 wurde dauerhaft ausgeblendet, der alte
  // Schlüssel wird beim Start entsorgt. Kann ab ca. 11.2026 raus.
  try { localStorage.removeItem('geo.hidden'); } catch {}
  return new Set();
}
export function entferneObjekt(id){ state.entfernt.add(id); }
export function entferneAlleSichtbaren(){ visibleObjects().forEach(o => state.entfernt.add(o.id)); }
export function zeigeAlleWieder(){ state.entfernt.clear(); }

/* ---------- Ableitungen ---------- */
/* Entfernung und Peilung neu rechnen und den Radius-/Höhenfilter setzen.
   o.gefiltert = von den Einstellungen ausgeschlossen (heißt bewusst nicht
   „hidden", das war früher mit state.entfernt verwechselbar). */
export function recompute(){
  if (!state.pos) return;
  const { lat, lon } = state.pos;
  const nahRadius = state.settings.radius;
  const bergRadius = gipfelRadius();
  let radarMax = nahRadius;
  for (const o of state.objects){
    o.dist = haversine(lat, lon, o.lat, o.lon);
    o.brg  = bearing(lat, lon, o.lat, o.lon);
    // Gipfel dürfen bis zur Bergreichweite stehen, alles andere nur bis zum Umkreis.
    const maxDist = o.kind === 'peak' ? bergRadius : nahRadius;
    o.gefiltert = (o.kind === 'peak' && state.settings.minElev > 0
                   && (o.elev == null || o.elev < state.settings.minElev))
               || (o.dist > maxDist);
    // Radar so weit aufziehen, dass der fernste sichtbare Gipfel noch draufpasst
    // (sonst klebten alle fernen Berge am Rand). In flachem Gelände ohne ferne
    // Berge bleibt es beim Umkreis.
    if (!o.gefiltert && o.dist > radarMax) radarMax = o.dist;
  }
  state.radarMax = radarMax;
}

export function visibleObjects(){
  return state.objects.filter(o => !o.gefiltert && !state.entfernt.has(o.id));
}

export function inView(o){
  return imBlickfeld(o.brg, state.heading, state.settings.fov);
}
