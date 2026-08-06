/* ============================================================
   Zustand + Persistenz (localStorage) + abgeleitete Werte.
   Kein DOM – wer hier etwas ändert, ruft anschließend selbst render().
   ============================================================ */

import { haversine, bearing, imBlickfeld } from './geo.js';

// Einzige Quelle für die Versionsanzeige. Muss zusammen mit CACHE in sw.js
// hochgezählt werden, sonst liefert der Service Worker alten Code aus und
// Tests laufen am falschen Stand (Freigabe-Checkliste im README.md).
export const APP_VERSION = 'v12';

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
  settings: loadSettings(),
  currentView: 'radar',
};

/* ---------- Einstellungen ---------- */
export function defaultSettings(){
  return { radius:60, minElev:0, fov:25, decl:0,
           cats:{ peak:true, water:true, place:true, sight:false } };
}
export function loadSettings(){
  try { return Object.assign(defaultSettings(), JSON.parse(localStorage.getItem('geo.settings')||'{}')); }
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
  for (const o of state.objects){
    o.dist = haversine(lat, lon, o.lat, o.lon);
    o.brg  = bearing(lat, lon, o.lat, o.lon);
    o.gefiltert = (o.kind === 'peak' && state.settings.minElev > 0
                   && (o.elev == null || o.elev < state.settings.minElev))
               || (o.dist > state.settings.radius);
  }
}

export function visibleObjects(){
  return state.objects.filter(o => !o.gefiltert && !state.entfernt.has(o.id));
}

export function inView(o){
  return imBlickfeld(o.brg, state.heading, state.settings.fov);
}
