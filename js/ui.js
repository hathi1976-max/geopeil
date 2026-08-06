/* ============================================================
   Oberfläche: Statusanzeigen, Diagnose-Banner, Listen, Radar, Detail-Sheet.
   Liest den Zustand, schreibt aber nur DOM – die Verdrahtung der Ereignisse
   steckt in app.js.
   ============================================================ */

import { cardinal, fmtDist, arrowFor, angleDiff, toRad, haversine, bearing } from './geo.js';
import { state, isSaved, visibleObjects, inView, recompute,
         entferneObjekt, entferneAlleSichtbaren, zeigeAlleWieder } from './store.js';

export const $  = (s) => document.querySelector(s);
export const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------- Plattform ---------- */
const UA = navigator.userAgent;
export const isIOS = /iP(hone|ad|od)/.test(UA)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/.test(UA);

/* ---------- Statusanzeigen ----------
   Alle DOM-Setzer vertragen fehlende Elemente: die Sensorschicht wird auch aus
   tests/test.html geladen, wo es die Oberfläche nicht gibt. */
function setPill(sel, txt, kind){
  const el = $(sel); if (!el) return;
  el.textContent = txt;
  el.className = 'pill pill-' + kind;
}
export function setGps(txt, kind){ setPill('#gpsState', txt, kind); }
export function setHead(txt, kind){ setPill('#headState', txt, kind); }
export function setDataHint(t){ const el = $('#dataHint'); if (el) el.textContent = t; }

/* ---------- Diagnose-Banner ----------
   cat: 'gps' | 'compass' – damit der jeweilige Hinweis wieder verschwindet,
   sobald das zugehörige Signal doch kommt. */
export function showBanner(cat, kind, html){
  const el = $('#banner'); if (!el) return;
  el.dataset.cat = cat;
  el.className = 'banner ' + kind;
  el.innerHTML = html;
  el.hidden = false;
}
export function clearBanner(cat){
  const el = $('#banner'); if (!el) return;
  if (!el.hidden && (!cat || el.dataset.cat === cat)){ el.hidden = true; el.innerHTML = ''; }
}
export function bannerSichtbar(){ const el = $('#banner'); return !!el && !el.hidden; }

export function gpsHelpHtml(title){
  if (isAndroid) return `<b>${title}</b>
    <ol>
      <li>Gerät-<b>Standort/GPS</b> einschalten (von oben wischen).</li>
      <li>Einstellungen → <b>Apps → Chrome → Berechtigungen → Standort → „Zulassen"</b> (die installierte App nutzt Chrome).</li>
      <li>Die Seite in <b>Chrome</b> öffnen → <b>🔒/ⓘ</b> neben der Adresse → <b>Standort → „Zulassen"</b>.</li>
      <li>Installierte App schließen und neu öffnen.</li>
    </ol>
    <button class="btn" data-action="retry">Erneut versuchen</button>`;
  if (isIOS) return `<b>${title}</b>
    <ol>
      <li>Einstellungen → <b>Datenschutz &amp; Sicherheit → Ortungsdienste</b> → an.</li>
      <li>Darunter <b>Safari</b> → „Beim Verwenden erlauben".</li>
      <li>Seite neu laden.</li>
    </ol>
    <button class="btn" data-action="retry">Erneut versuchen</button>`;
  return `<b>${title}</b><br>Bitte den Standortzugriff im Browser erlauben und Standort/GPS am Gerät einschalten.
    <br><button class="btn" data-action="retry">Erneut versuchen</button>`;
}

export function compassHelpHtml(title){
  if (isIOS) return `<b>${title}</b>
    <ol>
      <li>Einstellungen → <b>Safari</b> → ganz unten <b>„Bewegung &amp; Ausrichtung"</b> einschalten.</li>
      <li>Seite neu laden und erneut „erlauben" tippen.</li>
    </ol>
    <button class="btn" data-action="retry">Erneut versuchen</button>`;
  return `<b>${title}</b><br>Bewege das Handy einmal in einer liegenden 8 zum Kalibrieren.
    Ohne Kompass funktionieren Liste und Luftlinie trotzdem – nur die „Blickrichtung" fehlt.
    <br><button class="btn" data-action="retry">Erneut versuchen</button>`;
}

/* ---------- Einträge ---------- */
export const KIND_ICON = { peak:'⛰️', water:'💧', place:'🏘️', sight:'🏰' };
const KIND_NAME = { peak:'Berg/Gipfel', water:'Gewässer', place:'Ort', sight:'Sehenswürdigkeit' };

export function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function itemEl(o, opts){
  const div = document.createElement('div');
  div.className = 'item ' + o.kind;
  const arrow = state.heading != null ? arrowFor(o.brg, state.heading) : '';
  const subParts = [cardinal(o.brg)];
  if (o.sub) subParts.push(escapeHtml(o.sub));
  if (o.elev != null) subParts.push(o.elev + ' m');
  const del = (opts && opts.deletable)
    ? '<button class="item-del" title="Aus der Liste entfernen" aria-label="Entfernen">✕</button>' : '';
  div.innerHTML = `
    <div class="ico">${KIND_ICON[o.kind]}</div>
    <div class="body">
      <div class="name">${escapeHtml(o.name)} ${isSaved(o.id) ? '<span class="saved-star">★</span>' : ''}</div>
      <div class="sub">${subParts.join(' · ')}</div>
    </div>
    <div class="dist">${fmtDist(o.dist)}<div class="arrow">${arrow}</div></div>
    ${del}`;
  div.addEventListener('click', () => openSheet(o));
  if (opts && opts.deletable){
    div.querySelector('.item-del').addEventListener('click', ev => {
      ev.stopPropagation();          // nicht das Detail-Sheet öffnen
      entferneObjekt(o.id);
      recompute();
      render();
      drawRadar();
    });
  }
  return div;
}

/* ---------- Sortier-Option „In Blickrichtung zuerst" ----------
   Ohne Kompasswert liefert inView() immer false und die Sortierung fiele still
   auf Distanz zurück – die Option sähe funktionslos aus. Also sperren, bis ein
   Kompasswert da ist. */
let sortDirAktiv = null;      // zuletzt gesetzter Zustand (spart Arbeit je Kompass-Ereignis)
let sortDirErsetzt = false;   // haben wir selbst auf 'dist' umgestellt?

export function sortAuswahlGeaendert(){ sortDirErsetzt = false; }

export function updateSortOptions(){
  const sel = $('#sortBy'); if (!sel) return;
  const opt = sel.querySelector('option[value="dir"]'); if (!opt) return;
  const aktiv = state.heading != null;
  if (aktiv === sortDirAktiv) return;
  sortDirAktiv = aktiv;
  opt.disabled = !aktiv;
  opt.textContent = aktiv ? 'In Blickrichtung zuerst' : 'In Blickrichtung zuerst (Kompass nötig)';
  if (!aktiv && sel.value === 'dir'){ sel.value = 'dist'; sortDirErsetzt = true; }
  // Kompass da: die erzwungene Ersatzwahl zurücknehmen, damit die Voreinstellung
  // wieder gilt. Eine eigene Auswahl des Nutzers bleibt unangetastet.
  else if (aktiv && sortDirErsetzt && sel.value === 'dist'){ sel.value = 'dir'; sortDirErsetzt = false; }
  renderList();
}

/* ---------- Rendering ---------- */
export function renderHeading(){
  if (state.heading == null) return;
  const d = $('#headingDeg'), c = $('#headingCard');
  if (d) d.textContent = Math.round(state.heading);
  if (c) c.textContent = cardinal(state.heading);
}

/* Die Blickfeld-Liste folgt der Drehung, wird aber nur neu aufgebaut, wenn sich
   am sichtbaren Ergebnis etwas ändert. Sonst würde bei 60 Kompass-Ereignissen
   pro Sekunde der DOM unter dem Finger ausgetauscht und Antippen ginge ins
   Leere. */
let fovSig = null;

export function renderFov(){
  const box = $('#fovList'); if (!box) return;
  if (state.heading == null){
    if (fovSig === 'kompass-fehlt') return;
    fovSig = 'kompass-fehlt';
    box.innerHTML = '<p class="muted">Kompass wird kalibriert … bewege das Handy in einer 8.</p>';
    return;
  }
  const inv = visibleObjects().filter(inView).sort((a,b) => a.dist - b.dist).slice(0,12);
  const sig = inv.map(o => o.id + ':' + arrowFor(o.brg, state.heading) + ':' + fmtDist(o.dist)).join('|');
  if (sig === fovSig) return;
  fovSig = sig;
  box.innerHTML = '';
  if (!inv.length){ box.innerHTML = '<p class="muted">Nichts direkt in Blickrichtung. Dreh dich langsam.</p>'; return; }
  inv.forEach(o => box.appendChild(itemEl(o)));
}

export function renderList(){
  const box = $('#allList'); if (!box) return;
  const q = $('#search').value.trim().toLowerCase();
  const sort = $('#sortBy').value;
  let list = visibleObjects();
  if (q) list = list.filter(o => o.name.toLowerCase().includes(q));
  list = list.slice();
  if (sort === 'dist') list.sort((a,b) => a.dist - b.dist);
  else if (sort === 'elev') list.sort((a,b) => (b.elev||-1) - (a.elev||-1));
  else list.sort((a,b) => {
    const av = inView(a) ? 0 : 1, bv = inView(b) ? 0 : 1;
    if (av !== bv) return av - bv;
    return a.dist - b.dist;
  });
  box.innerHTML = '';
  list.slice(0,300).forEach(o => box.appendChild(itemEl(o, { deletable:true })));
  if (!list.length && !q){
    box.innerHTML = state.loading
      ? '<p class="muted">Lade Objekte … (der OpenStreetMap-Dienst kann bis zu einer Minute brauchen)</p>'
      : '<p class="muted">Keine Objekte. Umkreis kleiner stellen und „Daten neu laden".</p>';
  }
  else if (!list.length) box.innerHTML = '<p class="muted">Nichts gefunden für „' + escapeHtml(q) + '".</p>';

  // Fußzeile: ganze Liste leeren / entfernte Einträge zurückholen
  const foot = document.createElement('div');
  foot.className = 'list-foot';
  const parts = [];
  if (list.length) parts.push('<button class="btn small" data-act="clearList">🗙 Liste leeren</button>');
  if (state.entfernt.size) parts.push('<button class="btn small" data-act="unhide">↺ Ausgeblendete zurückholen ('+state.entfernt.size+')</button>');
  if (parts.length){
    foot.innerHTML = parts.join('');
    foot.querySelector('[data-act="clearList"]')?.addEventListener('click', () => {
      entferneAlleSichtbaren(); recompute(); render(); drawRadar();
    });
    foot.querySelector('[data-act="unhide"]')?.addEventListener('click', () => {
      zeigeAlleWieder(); recompute(); render(); drawRadar();
    });
    box.appendChild(foot);
  }
}

export function renderSaved(){
  const box = $('#savedList'); if (!box) return;
  box.innerHTML = '';
  if (!state.saved.length){
    box.innerHTML = '<p class="muted">Noch nichts gespeichert. Tippe auf ein Objekt → ☆ Speichern.</p>';
    return;
  }
  // Favoriten liegen außerhalb von state.objects und werden deshalb nicht von
  // recompute() erfasst – Distanz/Peilung hier einzeln nachrechnen.
  const list = state.saved.map(s => {
    const o = Object.assign({}, s);
    if (state.pos){
      o.dist = haversine(state.pos.lat, state.pos.lon, o.lat, o.lon);
      o.brg  = bearing(state.pos.lat, state.pos.lon, o.lat, o.lon);
    } else { o.dist = 0; o.brg = 0; }
    return o;
  }).sort((a,b) => a.dist - b.dist);
  list.forEach(o => box.appendChild(itemEl(o)));
}

export function render(){
  // Ein render()-Aufruf heißt: die Daten haben sich geändert. Die Sperre gegen
  // das ständige Neuaufbauen gilt nur für den Kompass-Takt (planeRadar).
  fovSig = null;
  renderFov();
  if (state.currentView === 'list')  renderList();
  if (state.currentView === 'saved') renderSaved();
}

/* ---------- Radar-Canvas ----------
   Die Zeichenlogik rechnet in festen 600er-Einheiten; resizeRadar skaliert den
   Kontext auf die echte Pixelgröße. So bleiben alle Größenverhältnisse
   (Schrift, Punktradien, Ringabstände) unverändert, während die Fläche auf
   Geräten mit devicePixelRatio > 1 scharf wird. */
export const RADAR_UNITS = 600;

export function resizeRadar(){
  const cv = $('#radar'); if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const seite = cv.clientWidth || RADAR_UNITS;
  const px = Math.round(seite * dpr);
  if (cv.width !== px || cv.height !== px){ cv.width = cv.height = px; }
  const s = px / RADAR_UNITS;
  cv.getContext('2d').setTransform(s, 0, 0, s, 0, 0);
}

/* Kompass-Ereignisse kommen bis zu 60×/s. Zeichnen an einen Frame koppeln,
   statt pro Ereignis neu zu rendern. */
let radarPending = false;
export function planeRadar(){
  if (radarPending) return;
  radarPending = true;
  requestAnimationFrame(() => {
    radarPending = false;
    drawRadar();
    renderFov();   // die Liste „in Blickrichtung" muss der Drehung folgen
  });
}

export function drawRadar(){
  const cv = $('#radar'); if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = RADAR_UNITS, H = RADAR_UNITS, cx = W/2, cy = H/2, rad = Math.min(cx,cy) - 30;
  ctx.clearRect(0, 0, W, H);

  const heading = state.heading ?? 0;
  const maxD = state.settings.radius;

  // Ringe
  ctx.strokeStyle = '#30363d'; ctx.fillStyle = '#8b949e'; ctx.lineWidth = 2;
  for (let i = 1; i <= 3; i++){
    ctx.beginPath(); ctx.arc(cx, cy, rad*i/3, 0, Math.PI*2); ctx.stroke();
  }
  ctx.font = '20px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(maxD/3) + 'km', cx, cy - rad/3);
  ctx.fillText(Math.round(maxD) + 'km', cx, cy - rad + 2);

  // Blickfeld-Keil (immer nach oben = Blickrichtung)
  const fov = toRad(state.settings.fov);
  ctx.beginPath(); ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, rad, -Math.PI/2 - fov, -Math.PI/2 + fov);
  ctx.closePath();
  ctx.fillStyle = 'rgba(74,168,255,.12)'; ctx.fill();

  // Himmelsrichtungen (relativ, oben = Blickrichtung)
  const labels = [['N',0],['O',90],['S',180],['W',270]];
  ctx.font = 'bold 22px system-ui';
  for (const [lab, deg] of labels){
    const rel = toRad(deg - heading) - Math.PI/2;
    const x = cx + Math.cos(rel)*(rad+16), y = cy + Math.sin(rel)*(rad+16);
    ctx.fillStyle = lab === 'N' ? '#f0883e' : '#8b949e';
    ctx.fillText(lab, x, y);
  }

  // Objekte
  const colors = { peak:'#f0883e', water:'#4aa8ff', place:'#a371f7', sight:'#db61a2' };
  const objs = visibleObjects().slice().sort((a,b) => b.dist - a.dist);
  for (const o of objs){
    const rel = toRad(o.brg - heading) - Math.PI/2;
    const rr = Math.min(o.dist/maxD, 1) * rad;
    const x = cx + Math.cos(rel)*rr, y = cy + Math.sin(rel)*rr;
    const focused = Math.abs(angleDiff(o.brg, heading)) <= state.settings.fov;
    ctx.beginPath();
    ctx.arc(x, y, focused ? 7 : 4, 0, Math.PI*2);
    ctx.fillStyle = colors[o.kind] || '#8b949e';
    ctx.globalAlpha = focused ? 1 : 0.5;
    ctx.fill(); ctx.globalAlpha = 1;
  }

  // Zentrum (Betrachter)
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI*2); ctx.fillStyle = '#fff'; ctx.fill();
}

/* ---------- Detail-Sheet ---------- */
let sheetObj = null;
export function aktuellesSheetObjekt(){ return sheetObj; }

export function openSheet(o){
  sheetObj = o;
  $('#sheetName').textContent = o.name;
  const rows = [];
  rows.push(['Art', KIND_NAME[o.kind]]);
  if (o.dist != null) rows.push(['Luftlinie', fmtDist(o.dist)]);
  if (o.brg  != null) rows.push(['Richtung', Math.round(o.brg) + '° ' + cardinal(o.brg)]);
  if (o.elev != null) rows.push(['Höhe', o.elev + ' m']);
  if (o.sub) rows.push(['Info', o.sub]);
  rows.push(['Koordinaten', o.lat.toFixed(5) + ', ' + o.lon.toFixed(5)]);
  $('#sheetMeta').innerHTML = rows
    .map(([k,v]) => `<div><span class="k">${k}</span><span>${escapeHtml(String(v))}</span></div>`).join('');
  $('#sheetSave').textContent = isSaved(o.id) ? '★ Gespeichert' : '☆ Speichern';
  $('#sheetMap').href = `https://www.openstreetmap.org/?mlat=${o.lat}&mlon=${o.lon}#map=13/${o.lat}/${o.lon}`;
  $('#sheet').hidden = false;
}

export function closeSheet(){ $('#sheet').hidden = true; sheetObj = null; }
