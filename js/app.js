/* ============================================================
   GeoPeil – Berge, Flüsse & Orte per Kompass finden
   Einstiegspunkt: Ladeschicht (Overpass) und Verdrahtung der Oberfläche.

   Aufteilung (siehe CODEREVIEW.md, Befund C3):
     geo.js      reine Geometrie (getestet in tests/)
     overpass.js Abfrage bauen/abschicken/auswerten, ohne Zustand
     store.js    Zustand, localStorage, abgeleitete Werte
     sensors.js  GPS und Kompass
     ui.js       Rendering, Radar, Detail-Sheet
     app.js      diese Datei
   ============================================================ */

import { buildQuery, parseElements, dedupe, locKey, overpassAbfrage } from './overpass.js';
import { state, APP_VERSION, recompute, saveSettings, isSaved, toggleSaved } from './store.js';
import { setzeFixRueckruf, enableSensors } from './sensors.js';
import { $, $$, setDataHint, setGps, clearBanner, render, renderList,
         renderHeading, resizeRadar, drawRadar, updateSortOptions, sortAuswahlGeaendert,
         closeSheet, aktuellesSheetObjekt } from './ui.js';

/* ============================================================
   Daten laden
   ============================================================ */
async function fetchObjects(){
  if (!state.pos || state.loading) return;
  const { lat, lon } = state.pos;
  const r = state.settings.radius;
  const key = locKey(lat, lon);

  // Ladeschlüssel sofort beanspruchen, damit ein später eintreffendes Ergebnis
  // erkennen kann, ob es noch zum aktuellen Ort gehört.
  state.loadedFor = key;
  state.loadedRadius = r;
  state.loading = true;
  setDataHint('Lade Objekte …');

  try {
    const data = await overpassAbfrage(buildQuery(lat, lon, r*1000, state.settings.cats));
    // Gehört die Antwort noch zum aktuellen Ort? Sonst verwerfen, statt die
    // Liste mit Objekten von woanders zu überschreiben.
    if (state.loadedFor !== key) return;

    state.objects = dedupe(parseElements(data.elements || []));
    // Frische Daten = wieder alles zeigen. Sonst blieben gelöschte Objekte
    // wegen stabiler OSM-IDs für immer weg („kein neuer Ort mehr").
    state.entfernt.clear();
    setDataHint(state.objects.length + ' Objekte geladen.');
    recompute();
    render();
    drawRadar();
  } catch(err){
    // Schlüssel zurücknehmen: sonst gilt der Ort als geladen und maybeReload
    // probiert es hier nie wieder – die App bliebe nach einem Netzfehler leer.
    if (state.loadedFor === key){ state.loadedFor = null; state.loadedRadius = 0; }
    setDataHint('Fehler beim Laden: ' + ((err && err.message) || '?'));
  } finally {
    state.loading = false;
  }
}

/* Lädt nach, wenn der Ort gewechselt hat oder der Umkreis über das hinausgeht,
   was zuletzt geladen wurde. Ein KLEINERER Umkreis braucht keine Abfrage – die
   Objekte sind in den vorhandenen Daten schon enthalten und recompute() blendet
   den Rest aus. Das spart Anfragen an einen fremden, gedrosselten Dienst. */
function maybeReload(force){
  if (!state.pos) return;
  const key = locKey(state.pos.lat, state.pos.lon);
  if (force || key !== state.loadedFor || state.settings.radius > state.loadedRadius){
    fetchObjects();
  }
}

/* ============================================================
   Verdrahtung
   ============================================================ */
async function starteSensoren(){
  $('#permGate').hidden = true;
  $('#app').hidden = false;
  resizeRadar();          // erst jetzt hat der Canvas eine messbare Breite
  await enableSensors();
}

function retrySensors(){
  clearBanner();
  setGps('GPS…', 'off');
  starteSensoren();
}

function switchView(v){
  state.currentView = v;
  $$('.tab').forEach(t => t.classList.toggle('tab-active', t.dataset.view === v));
  $$('.view').forEach(s => s.hidden = s.id !== 'view-' + v);
  if (v === 'radar'){ resizeRadar(); drawRadar(); }
  render();
}

function bindUI(){
  $('#btnEnable').addEventListener('click', starteSensoren);
  $('#banner').addEventListener('click', e => {
    if (e.target.closest('[data-action="retry"]')) retrySensors();
  });
  $$('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));

  $('#sheetClose').addEventListener('click', closeSheet);
  $('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
  $('#sheetSave').addEventListener('click', () => {
    const o = aktuellesSheetObjekt();
    if (!o) return;
    toggleSaved(o);
    $('#sheetSave').textContent = isSaved(o.id) ? '★ Gespeichert' : '☆ Speichern';
    render();   // baut die Blickfeld-Liste neu auf, damit der ★ mitkommt
  });

  $('#search').addEventListener('input', renderList);
  $('#sortBy').addEventListener('change', () => { sortAuswahlGeaendert(); renderList(); });
  $('#btnReload').addEventListener('click', () => maybeReload(true));

  // Einstellungs-Schieberegler
  const s = state.settings;
  const bind = (id, key, valId, after) => {
    const el = $('#'+id); el.value = s[key];
    if (valId) $('#'+valId).textContent = s[key];
    el.addEventListener('input', () => {
      s[key] = Number(el.value);
      if (valId) $('#'+valId).textContent = el.value;
      saveSettings();
      if (after) after();
    });
  };
  const neuZeichnen = () => { recompute(); render(); drawRadar(); };

  bind('radius', 'radius', 'radiusVal', neuZeichnen);
  // Ein größerer Umkreis braucht neue Daten – recompute() blendet nur aus, was
  // ohnehin schon geladen ist. Erst beim Loslassen ('change'), sonst löste jede
  // Zwischenstufe des Reglers eine eigene Overpass-Abfrage aus.
  $('#radius').addEventListener('change', () => maybeReload(false));

  bind('minElev', 'minElev', 'minElevVal', neuZeichnen);
  bind('fov', 'fov', 'fovVal', neuZeichnen);
  bind('decl', 'decl', 'declVal', () => {
    if (state.rawHeading != null){
      state.heading = (state.rawHeading + s.decl + 360) % 360;
      renderHeading();
    }
    neuZeichnen();
  });

  // Kategorien: andere Auswahl = andere Abfrage, hier hilft nur neu laden
  $$('.cat').forEach(cb => {
    cb.checked = !!s.cats[cb.value];
    cb.addEventListener('change', () => {
      s.cats[cb.value] = cb.checked;
      saveSettings();
      maybeReload(true);
    });
  });

  const versionEl = $('#appVersion');
  if (versionEl) versionEl.textContent = APP_VERSION;
  updateSortOptions();
  resizeRadar();

  const onResize = () => { resizeRadar(); drawRadar(); };
  window.addEventListener('resize', onResize);
  screen.orientation && screen.orientation.addEventListener('change', onResize);
}

/* ---------- Start ---------- */
setzeFixRueckruf(maybeReload);
bindUI();

// Service Worker (Pfad relativ zum Dokument, nicht zu diesem Modul)
if ('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
