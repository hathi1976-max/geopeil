'use strict';

/* ============================================================
   GeoPeil – Berge, Flüsse & Orte per Kompass finden
   ============================================================ */

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------- Plattform ---------- */
const UA = navigator.userAgent;
const isIOS = /iP(hone|ad|od)/.test(UA) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
const isAndroid = /Android/.test(UA);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;

/* ---------- Diagnose-Banner ---------- */
// cat: 'gps' | 'compass' – damit der jeweilige Hinweis wieder verschwindet,
// sobald das zugehörige Signal doch kommt.
function showBanner(cat, kind, html){
  const el = $('#banner');
  el.dataset.cat = cat;
  el.className = 'banner '+kind;
  el.innerHTML = html;
  el.hidden = false;
}
function clearBanner(cat){
  const el = $('#banner');
  if (!el.hidden && (!cat || el.dataset.cat===cat)){ el.hidden = true; el.innerHTML=''; }
}
function gpsHelpHtml(title){
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
function compassHelpHtml(title){
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

/* ---------- Zustand ---------- */
const state = {
  pos: null,            // {lat, lon, acc}
  heading: null,        // Grad, 0=Nord, im Uhrzeigersinn (true north, korrigiert)
  rawHeading: null,     // ohne Korrektur (fürs Debug)
  objects: [],          // geladene Objekte mit berechneter Distanz/Peilung
  saved: loadSaved(),
  hidden: loadHidden(), // ausgeblendete Objekt-IDs (Set), bleiben über Neuladen weg
  loadedFor: null,      // Schlüssel des letzten Overpass-Ladevorgangs
  loading: false,
  settings: loadSettings(),
  currentView: 'radar',
};

/* ---------- Einstellungen ---------- */
function defaultSettings(){
  return { radius:60, minElev:0, fov:25, decl:0,
           cats:{ peak:true, water:true, place:true, sight:false } };
}
function loadSettings(){
  try { return Object.assign(defaultSettings(), JSON.parse(localStorage.getItem('geo.settings')||'{}')); }
  catch { return defaultSettings(); }
}
function saveSettings(){ localStorage.setItem('geo.settings', JSON.stringify(state.settings)); }

/* ---------- Favoriten ---------- */
function loadSaved(){
  try { return JSON.parse(localStorage.getItem('geo.saved')||'[]'); } catch { return []; }
}
function persistSaved(){ localStorage.setItem('geo.saved', JSON.stringify(state.saved)); }
function isSaved(id){ return state.saved.some(o => o.id === id); }
function toggleSaved(obj){
  const i = state.saved.findIndex(o => o.id === obj.id);
  if (i >= 0) state.saved.splice(i,1);
  else state.saved.push({ id:obj.id, name:obj.name, kind:obj.kind, lat:obj.lat, lon:obj.lon, elev:obj.elev, sub:obj.sub });
  persistSaved();
}

/* ---------- Ausgeblendete Objekte (aus der Liste gelöscht) ---------- */
function loadHidden(){
  try { return new Set(JSON.parse(localStorage.getItem('geo.hidden')||'[]')); } catch { return new Set(); }
}
function persistHidden(){ localStorage.setItem('geo.hidden', JSON.stringify([...state.hidden])); }
function isHidden(id){ return state.hidden.has(id); }
function hideObject(id){ state.hidden.add(id); persistHidden(); }
function hideAllVisible(){ visibleObjects().forEach(o => state.hidden.add(o.id)); persistHidden(); }
function unhideAll(){ state.hidden.clear(); persistHidden(); }

/* ---------- Geometrie ---------- */
const R = 6371; // km
const toRad = d => d*Math.PI/180;
const toDeg = r => r*180/Math.PI;

function haversine(lat1,lon1,lat2,lon2){
  const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function bearing(lat1,lon1,lat2,lon2){
  const φ1=toRad(lat1), φ2=toRad(lat2), Δλ=toRad(lon2-lon1);
  const y=Math.sin(Δλ)*Math.cos(φ2);
  const x=Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return (toDeg(Math.atan2(y,x))+360)%360;
}
// kleinster Winkelabstand -180..180
function angleDiff(a,b){ let d=((a-b+540)%360)-180; return d; }
const CARDINALS=['N','NO','O','SO','S','SW','W','NW'];
function cardinal(deg){ return CARDINALS[Math.round(deg/45)%8]; }
function fmtDist(km){
  if (km < 1) return Math.round(km*1000)+' m';
  if (km < 10) return km.toFixed(1)+' km';
  return Math.round(km)+' km';
}

/* ============================================================
   Sensoren: GPS + Kompass
   ============================================================ */
function startGeo(){
  if (!('geolocation' in navigator)){ setGps('Kein GPS', 'off'); return; }
  navigator.geolocation.watchPosition(
    p => {
      const first = !state.pos;
      state.pos = { lat:p.coords.latitude, lon:p.coords.longitude, acc:p.coords.accuracy };
      setGps('GPS ±'+Math.round(p.coords.accuracy)+'m', 'ok');
      clearBanner('gps');
      recompute();
      // Beim ersten Fix (oder größerer Bewegung) Daten laden
      maybeReload(first);
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
}

let headingSmooth = null;
let hasAbsolute = false;   // haben wir schon nordbezogene (absolute) Werte gesehen?

function onOrientation(e){
  let h = null;
  let absolute = false;
  if (typeof e.webkitCompassHeading === 'number'){
    h = e.webkitCompassHeading;                 // iOS: bereits 0=N im Uhrzeigersinn
    absolute = true;
  } else if (typeof e.alpha === 'number'){
    h = (360 - e.alpha);                         // Android
    absolute = (e.absolute === true) || e.type === 'deviceorientationabsolute';
  }
  if (h == null || Number.isNaN(h)) return;

  // Nordbezogene Werte bevorzugen: sobald es die gibt, relative Events ignorieren.
  // Sonst kämpfen absoluter und relativer Kompass gegeneinander → „Zappeln".
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
  headingSmooth.x += (vx - headingSmooth.x)*k;
  headingSmooth.y += (vy - headingSmooth.y)*k;
  const sh = (toDeg(Math.atan2(headingSmooth.y, headingSmooth.x))+360)%360;

  state.rawHeading = sh;
  state.heading = (sh + state.settings.decl + 360) % 360;
  setHead('Kompass', 'ok');
  clearBanner('compass');
  renderHeading();
  if (state.currentView === 'radar') drawRadar();
}

let orientationBound = false;
let compassTimer = null;

async function enableSensors(){
  $('#permGate').hidden = true;
  $('#app').hidden = false;

  // iOS 13+: explizite Kompass-Erlaubnis (nur per Nutzer-Geste möglich)
  let iosDenied = false;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'){
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') iosDenied = true;
    }
  } catch(err){
    // Wirft u.a., wenn "Bewegung & Ausrichtung" in den iOS-Safari-Einstellungen aus ist
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

  // Kompass-Timeout: kommen keine Daten, klaren Hinweis zeigen (kein Overwrite eines GPS-Fehlers)
  clearTimeout(compassTimer);
  compassTimer = setTimeout(() => {
    if (state.heading == null && !iosDenied){
      setHead('Kompass?', 'warn');
      if ($('#banner').hidden){
        showBanner('compass', 'warn', compassHelpHtml('Kompass liefert noch keine Daten.'));
      }
    }
  }, 4000);
}

// Von „Erneut versuchen" ausgelöst
function retrySensors(){
  clearBanner();
  setGps('GPS…', 'off');
  enableSensors();
}

function setGps(txt,kind){ const el=$('#gpsState'); el.textContent=txt; el.className='pill pill-'+kind; }
function setHead(txt,kind){ const el=$('#headState'); el.textContent=txt; el.className='pill pill-'+kind; }

/* ============================================================
   Datenabruf: Overpass / OpenStreetMap
   ============================================================ */
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function buildQuery(lat, lon, radiusM){
  const c = state.settings.cats;
  const parts = [];
  if (c.peak)  parts.push(`node["natural"="peak"](around:${radiusM},${lat},${lon});`);
  if (c.peak)  parts.push(`node["natural"="volcano"](around:${radiusM},${lat},${lon});`);
  if (c.water){
    parts.push(`node["natural"="water"](around:${radiusM},${lat},${lon});`);
    parts.push(`way["natural"="water"]["name"](around:${radiusM},${lat},${lon});`);
    parts.push(`way["waterway"="river"]["name"](around:${radiusM},${lat},${lon});`);
  }
  if (c.place) parts.push(`node["place"~"^(city|town|village|hamlet|suburb)$"]["name"](around:${radiusM},${lat},${lon});`);
  if (c.sight){
    parts.push(`node["tourism"~"^(attraction|viewpoint|museum)$"]["name"](around:${radiusM},${lat},${lon});`);
    parts.push(`node["historic"]["name"](around:${radiusM},${lat},${lon});`);
    parts.push(`way["historic"]["name"](around:${radiusM},${lat},${lon});`);
  }
  return `[out:json][timeout:30];(${parts.join('')});out center tags;`;
}

function classify(tags){
  if (!tags) return null;
  if (tags.natural==='peak' || tags.natural==='volcano') return 'peak';
  if (tags.natural==='water' || tags.waterway) return 'water';
  if (tags.place) return 'place';
  if (tags.tourism || tags.historic) return 'sight';
  return null;
}
const KIND_ICON = { peak:'⛰️', water:'💧', place:'🏘️', sight:'🏰' };

function parseElements(elements){
  const out = [];
  for (const el of elements){
    const lat = el.lat ?? (el.center && el.center.lat);
    const lon = el.lon ?? (el.center && el.center.lon);
    if (lat == null || lon == null) continue;
    const tags = el.tags || {};
    const name = tags.name || tags['name:de'];
    if (!name) continue;
    const kind = classify(tags);
    if (!kind) continue;
    let elev = null;
    if (tags.ele){ const n = parseFloat(String(tags.ele).replace(',','.')); if (!Number.isNaN(n)) elev = Math.round(n); }
    let sub = '';
    if (kind==='place') sub = tags.place;
    else if (kind==='water') sub = tags.waterway ? 'Fluss' : 'Gewässer';
    else if (kind==='sight') sub = tags.historic || tags.tourism || '';
    out.push({ id:`${el.type}/${el.id}`, name, kind, lat, lon, elev, sub });
  }
  return out;
}

function locKey(lat,lon,r){ return `${lat.toFixed(2)},${lon.toFixed(2)},${r}`; }

async function fetchObjects(){
  if (!state.pos || state.loading) return;
  const { lat, lon } = state.pos;
  const r = state.settings.radius;
  const key = locKey(lat,lon,r);
  state.loadedFor = key;
  state.loading = true;
  setDataHint('Lade Objekte …');

  const q = buildQuery(lat, lon, r*1000);
  let data = null, lastErr = null;
  for (const ep of OVERPASS){
    try {
      const resp = await fetch(ep, { method:'POST', body:'data='+encodeURIComponent(q) });
      if (!resp.ok) throw new Error('HTTP '+resp.status);
      data = await resp.json();
      break;
    } catch(err){ lastErr = err; }
  }
  state.loading = false;
  if (!data){ setDataHint('Fehler beim Laden: '+(lastErr&&lastErr.message||'?')); return; }

  const parsed = parseElements(data.elements||[]);
  // Duplikate zusammenführen (gleiche id)
  const seen = new Map();
  for (const o of parsed) if (!seen.has(o.id)) seen.set(o.id, o);
  state.objects = Array.from(seen.values());
  setDataHint(state.objects.length+' Objekte geladen.');
  recompute();
  render();
}

function maybeReload(force){
  if (!state.pos) return;
  const key = locKey(state.pos.lat, state.pos.lon, state.settings.radius);
  if (force || key !== state.loadedFor) fetchObjects();
}

/* ============================================================
   Ableitungen: Distanz & Peilung
   ============================================================ */
function recompute(){
  if (!state.pos) return;
  const { lat, lon } = state.pos;
  for (const o of state.objects){
    o.dist = haversine(lat, lon, o.lat, o.lon);
    o.brg  = bearing(lat, lon, o.lat, o.lon);
  }
  // Nur Objekte über Mindesthöhe (Berge) und innerhalb Radius
  state.objects.forEach(o => {
    o.hidden = (o.kind==='peak' && state.settings.minElev>0 && (o.elev==null || o.elev < state.settings.minElev))
            || (o.dist > state.settings.radius);
  });
}

function visibleObjects(){ return state.objects.filter(o => !o.hidden && !state.hidden.has(o.id)); }

function inView(o){
  if (state.heading == null) return false;
  return Math.abs(angleDiff(o.brg, state.heading)) <= state.settings.fov;
}

/* ============================================================
   Rendering
   ============================================================ */
function itemEl(o, opts){
  const div = document.createElement('div');
  div.className = 'item '+o.kind;
  const arrow = state.heading!=null ? arrowFor(o.brg) : '';
  const dir = cardinal(o.brg);
  const subParts = [dir];
  if (o.sub) subParts.push(escapeHtml(o.sub));
  if (o.elev!=null) subParts.push(o.elev+' m');
  const del = (opts && opts.deletable)
    ? '<button class="item-del" title="Aus der Liste entfernen" aria-label="Entfernen">✕</button>' : '';
  div.innerHTML = `
    <div class="ico">${KIND_ICON[o.kind]}</div>
    <div class="body">
      <div class="name">${escapeHtml(o.name)} ${isSaved(o.id)?'<span class="saved-star">★</span>':''}</div>
      <div class="sub">${subParts.join(' · ')}</div>
    </div>
    <div class="dist">${fmtDist(o.dist)}<div class="arrow">${arrow}</div></div>
    ${del}`;
  div.addEventListener('click', () => openSheet(o));
  if (opts && opts.deletable){
    div.querySelector('.item-del').addEventListener('click', ev => {
      ev.stopPropagation();          // nicht das Detail-Sheet öffnen
      hideObject(o.id);
      recompute();
      render();
      drawRadar();
    });
  }
  return div;
}
const ARROWS=['↑','↗','→','↘','↓','↙','←','↖'];
function arrowFor(brg){
  const rel = ((brg - state.heading)%360+360)%360;
  return ARROWS[Math.round(rel/45)%8];
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function renderHeading(){
  if (state.heading==null) return;
  $('#headingDeg').textContent = Math.round(state.heading);
  $('#headingCard').textContent = cardinal(state.heading);
}

function renderFov(){
  const box = $('#fovList');
  if (state.heading==null){ box.innerHTML='<p class="muted">Kompass wird kalibriert … bewege das Handy in einer 8.</p>'; return; }
  const inv = visibleObjects().filter(inView).sort((a,b)=>a.dist-b.dist).slice(0,12);
  box.innerHTML='';
  if (!inv.length){ box.innerHTML='<p class="muted">Nichts direkt in Blickrichtung. Dreh dich langsam.</p>'; return; }
  inv.forEach(o => box.appendChild(itemEl(o)));
}

function renderList(){
  const box = $('#allList');
  const q = $('#search').value.trim().toLowerCase();
  const sort = $('#sortBy').value;
  let list = visibleObjects();
  if (q) list = list.filter(o => o.name.toLowerCase().includes(q));
  list = list.slice();
  if (sort==='dist') list.sort((a,b)=>a.dist-b.dist);
  else if (sort==='elev') list.sort((a,b)=>(b.elev||-1)-(a.elev||-1));
  else list.sort((a,b)=>{
    const av=inView(a)?0:1, bv=inView(b)?0:1;
    if (av!==bv) return av-bv;
    return a.dist-b.dist;
  });
  box.innerHTML='';
  list.slice(0,300).forEach(o => box.appendChild(itemEl(o, { deletable:true })));
  if (!list.length && !q) box.innerHTML='<p class="muted">Keine Objekte. Radius erhöhen oder Daten neu laden.</p>';
  else if (!list.length) box.innerHTML='<p class="muted">Nichts gefunden für „'+escapeHtml(q)+'".</p>';

  // Fußzeile: ganze Liste leeren / Ausgeblendete zurückholen
  const foot = document.createElement('div');
  foot.className = 'list-foot';
  const parts = [];
  if (list.length) parts.push('<button class="btn small" data-act="clearList">🗙 Liste leeren</button>');
  if (state.hidden.size) parts.push('<button class="btn small" data-act="unhide">↺ Ausgeblendete zurückholen ('+state.hidden.size+')</button>');
  if (parts.length){
    foot.innerHTML = parts.join('');
    foot.querySelector('[data-act="clearList"]')?.addEventListener('click', () => {
      hideAllVisible(); recompute(); render(); drawRadar();
    });
    foot.querySelector('[data-act="unhide"]')?.addEventListener('click', () => {
      unhideAll(); recompute(); render(); drawRadar();
    });
    box.appendChild(foot);
  }
}

function renderSaved(){
  const box = $('#savedList');
  box.innerHTML='';
  if (!state.saved.length){ box.innerHTML='<p class="muted">Noch nichts gespeichert. Tippe auf ein Objekt → ☆ Speichern.</p>'; return; }
  const list = state.saved.map(s => {
    const o = Object.assign({}, s);
    if (state.pos){ o.dist=haversine(state.pos.lat,state.pos.lon,o.lat,o.lon); o.brg=bearing(state.pos.lat,state.pos.lon,o.lat,o.lon); }
    else { o.dist=0; o.brg=0; }
    return o;
  }).sort((a,b)=>a.dist-b.dist);
  list.forEach(o => box.appendChild(itemEl(o)));
}

function render(){
  renderFov();
  if (state.currentView==='list') renderList();
  if (state.currentView==='saved') renderSaved();
}

/* ---------- Radar-Canvas ---------- */
function drawRadar(){
  const cv = $('#radar'); if (!cv) return;
  const ctx = cv.getContext('2d');
  const W=cv.width, H=cv.height, cx=W/2, cy=H/2, rad=Math.min(cx,cy)-30;
  ctx.clearRect(0,0,W,H);

  const heading = state.heading ?? 0;
  const maxD = state.settings.radius;

  // Ringe
  ctx.strokeStyle='#30363d'; ctx.fillStyle='#8b949e'; ctx.lineWidth=2;
  for (let i=1;i<=3;i++){
    ctx.beginPath(); ctx.arc(cx,cy,rad*i/3,0,Math.PI*2); ctx.stroke();
  }
  ctx.font='20px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(Math.round(maxD/3)+'km', cx, cy-rad/3);
  ctx.fillText(Math.round(maxD)+'km', cx, cy-rad+2);

  // Blickfeld-Keil (immer nach oben = Blickrichtung)
  const fov = toRad(state.settings.fov);
  ctx.beginPath(); ctx.moveTo(cx,cy);
  ctx.arc(cx,cy, rad, -Math.PI/2 - fov, -Math.PI/2 + fov);
  ctx.closePath();
  ctx.fillStyle='rgba(74,168,255,.12)'; ctx.fill();

  // Himmelsrichtungen (relativ, oben=Blickrichtung)
  const labels=[['N',0],['O',90],['S',180],['W',270]];
  ctx.fillStyle='#e6edf3'; ctx.font='bold 22px system-ui';
  for (const [lab,deg] of labels){
    const rel = toRad(deg - heading) - Math.PI/2;
    const x=cx+Math.cos(rel)*(rad+16), y=cy+Math.sin(rel)*(rad+16);
    ctx.fillStyle = lab==='N' ? '#f0883e' : '#8b949e';
    ctx.fillText(lab,x,y);
  }

  // Objekte
  const colors={peak:'#f0883e',water:'#4aa8ff',place:'#a371f7',sight:'#db61a2'};
  const objs = visibleObjects().slice().sort((a,b)=>b.dist-a.dist);
  for (const o of objs){
    const rel = toRad(o.brg - heading) - Math.PI/2;
    const rr = Math.min(o.dist/maxD,1)*rad;
    const x=cx+Math.cos(rel)*rr, y=cy+Math.sin(rel)*rr;
    const focused = Math.abs(angleDiff(o.brg,heading))<=state.settings.fov;
    ctx.beginPath();
    ctx.arc(x,y, focused?7:4, 0, Math.PI*2);
    ctx.fillStyle=colors[o.kind]||'#8b949e';
    ctx.globalAlpha = focused?1:0.5;
    ctx.fill(); ctx.globalAlpha=1;
  }

  // Zentrum (Betrachter)
  ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
}

/* ---------- Detail-Sheet ---------- */
let sheetObj=null;
function openSheet(o){
  sheetObj=o;
  $('#sheetName').textContent=o.name;
  const rows=[];
  rows.push(['Art', {peak:'Berg/Gipfel',water:'Gewässer',place:'Ort',sight:'Sehenswürdigkeit'}[o.kind]]);
  if (o.dist!=null) rows.push(['Luftlinie', fmtDist(o.dist)]);
  if (o.brg!=null)  rows.push(['Richtung', Math.round(o.brg)+'° '+cardinal(o.brg)]);
  if (o.elev!=null) rows.push(['Höhe', o.elev+' m']);
  if (o.sub) rows.push(['Info', o.sub]);
  rows.push(['Koordinaten', o.lat.toFixed(5)+', '+o.lon.toFixed(5)]);
  $('#sheetMeta').innerHTML = rows.map(([k,v])=>`<div><span class="k">${k}</span><span>${escapeHtml(String(v))}</span></div>`).join('');
  $('#sheetSave').textContent = isSaved(o.id)?'★ Gespeichert':'☆ Speichern';
  $('#sheetMap').href = `https://www.openstreetmap.org/?mlat=${o.lat}&mlon=${o.lon}#map=13/${o.lat}/${o.lon}`;
  $('#sheet').hidden=false;
}
function closeSheet(){ $('#sheet').hidden=true; sheetObj=null; }

/* ============================================================
   UI-Verdrahtung
   ============================================================ */
function switchView(v){
  state.currentView=v;
  $$('.tab').forEach(t => t.classList.toggle('tab-active', t.dataset.view===v));
  $$('.view').forEach(s => s.hidden = s.id !== 'view-'+v);
  if (v==='radar') drawRadar();
  render();
}

function bindUI(){
  $('#btnEnable').addEventListener('click', enableSensors);
  $('#banner').addEventListener('click', e => {
    if (e.target.closest('[data-action="retry"]')) retrySensors();
  });
  $$('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));

  $('#sheetClose').addEventListener('click', closeSheet);
  $('#sheet').addEventListener('click', e => { if (e.target.id==='sheet') closeSheet(); });
  $('#sheetSave').addEventListener('click', () => {
    if (!sheetObj) return;
    toggleSaved(sheetObj);
    $('#sheetSave').textContent = isSaved(sheetObj.id)?'★ Gespeichert':'☆ Speichern';
    render();
  });

  $('#search').addEventListener('input', renderList);
  $('#sortBy').addEventListener('change', renderList);
  $('#btnReload').addEventListener('click', () => maybeReload(true));

  // Einstellungs-Slider
  const s = state.settings;
  const bind = (id, key, valId, after) => {
    const el=$('#'+id); el.value=s[key];
    if (valId) $('#'+valId).textContent=s[key];
    el.addEventListener('input', () => {
      s[key]=Number(el.value);
      if (valId) $('#'+valId).textContent=el.value;
      saveSettings();
      if (after) after();
    });
  };
  bind('radius','radius','radiusVal', () => { recompute(); render(); drawRadar(); });
  bind('minElev','minElev','minElevVal', () => { recompute(); render(); drawRadar(); });
  bind('fov','fov','fovVal', () => { render(); drawRadar(); });
  bind('decl','decl','declVal', () => {
    if (state.rawHeading!=null){ state.heading=(state.rawHeading+s.decl+360)%360; renderHeading(); }
    render(); drawRadar();
  });

  // Kategorien
  $$('.cat').forEach(cb => {
    cb.checked = !!s.cats[cb.value];
    cb.addEventListener('change', () => {
      s.cats[cb.value]=cb.checked; saveSettings();
      maybeReload(true);
    });
  });

  window.addEventListener('resize', drawRadar);
  screen.orientation && screen.orientation.addEventListener('change', drawRadar);
}

function setDataHint(t){ const el=$('#dataHint'); if (el) el.textContent=t; }

/* ---------- Start ---------- */
bindUI();

// Service Worker
if ('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}
