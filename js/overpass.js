/* ============================================================
   Overpass / OpenStreetMap – Abfrage bauen, abschicken, auswerten.
   Kein Zugriff auf den App-Zustand und kein DOM, damit die Schicht
   ohne Netz und ohne Oberfläche getestet werden kann.
   ============================================================ */

export const OVERPASS_ENDPUNKTE = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// Großzügig: die öffentlichen Endpunkte brauchen unter Last real 30–60 s,
// besonders seit Gipfel bis 100 km serverseitig nach Höhe gefiltert werden.
// Mit zu knappem Limit bricht der Client die noch laufende, aber gleich fertige
// Abfrage ab („leere Liste"). Muss über dem serverseitigen [timeout:…] in
// buildQuery liegen.
export const OVERPASS_TIMEOUT_MS = 70000;

/* Baut die Overpass-QL-Abfrage. cats = {peak, water, place, sight}.
   opts (optional):
     peakRadiusM       – eigener, meist größerer Umkreis nur für Gipfel; Berge
                         sieht man aus 100 km, Dörfer nicht.
     fernGipfelMinEle  – ab diesem Höhenmeter zählen Gipfel jenseits von radiusM
                         noch mit. Ohne die Schranke zieht ein 100-km-Umkreis
                         im Mittelgebirge tausende benannte Hügel und die Abfrage
                         läuft in den Timeout. */
export function buildQuery(lat, lon, radiusM, cats, opts){
  const c = cats || {};
  const o = opts || {};
  const peakRadiusM = o.peakRadiusM || radiusM;
  const fernMin = o.fernGipfelMinEle || 0;
  const parts = [];
  // Überall ["name"]: parseElements verwirft ohnehin alles Namenlose. Ohne den
  // serverseitigen Filter kamen z. B. ~1800 namenlose Gipfel und ~1600 Teiche
  // nur mit, um gleich weggeworfen zu werden – unnötige Last und Übertragung.
  if (c.peak){
    // Nahbereich: alle benannten Gipfel/Hügel (Höhenfilter macht später die App
    // über „Min. Berghöhe").
    parts.push(`node["natural"="peak"]["name"](around:${radiusM},${lat},${lon});`);
    parts.push(`node["natural"="volcano"]["name"](around:${radiusM},${lat},${lon});`);
    // Fernbereich: nur echte Berge ab fernGipfelMinEle. Die Überlappung mit dem
    // Nahbereich fängt dedupe() ab.
    if (peakRadiusM > radiusM){
      const hoehe = fernMin > 0 ? `(if:number(t["ele"])>=${fernMin})` : '';
      parts.push(`node["natural"="peak"]["name"](around:${peakRadiusM},${lat},${lon})${hoehe};`);
      parts.push(`node["natural"="volcano"]["name"](around:${peakRadiusM},${lat},${lon})${hoehe};`);
    }
  }
  if (c.water){
    parts.push(`node["natural"="water"]["name"](around:${radiusM},${lat},${lon});`);
    parts.push(`way["natural"="water"]["name"](around:${radiusM},${lat},${lon});`);
    parts.push(`way["waterway"="river"]["name"](around:${radiusM},${lat},${lon});`);
  }
  if (c.place) parts.push(`node["place"~"^(city|town|village|hamlet|suburb)$"]["name"](around:${radiusM},${lat},${lon});`);
  if (c.sight){
    parts.push(`node["tourism"~"^(attraction|viewpoint|museum)$"]["name"](around:${radiusM},${lat},${lon});`);
    parts.push(`node["historic"]["name"](around:${radiusM},${lat},${lon});`);
    parts.push(`way["historic"]["name"](around:${radiusM},${lat},${lon});`);
  }
  // Serverseitiges Zeitlimit unter dem Client-Timeout (OVERPASS_TIMEOUT_MS):
  // so liefert der Server bei Überlast einen sauberen Fehler, statt dass der
  // Client eine noch laufende Abfrage abschneidet.
  return `[out:json][timeout:65];(${parts.join('')});out center tags;`;
}

export function classify(tags){
  if (!tags) return null;
  if (tags.natural === 'peak' || tags.natural === 'volcano') return 'peak';
  if (tags.natural === 'water' || tags.waterway) return 'water';
  if (tags.place) return 'place';
  if (tags.tourism || tags.historic) return 'sight';
  return null;
}

/* Wandelt die Overpass-Elemente in App-Objekte. Verworfen wird alles ohne
   Koordinate, ohne Namen (unbenannte Gipfel/Seen lassen sich nicht ansagen –
   steht so auch im Datenhinweis der Oberfläche) und ohne bekannte Art. */
export function parseElements(elements){
  const out = [];
  for (const el of elements || []){
    const lat = el.lat ?? (el.center && el.center.lat);
    const lon = el.lon ?? (el.center && el.center.lon);
    if (lat == null || lon == null) continue;
    const tags = el.tags || {};
    const name = tags.name || tags['name:de'];
    if (!name) continue;
    const kind = classify(tags);
    if (!kind) continue;
    let elev = null;
    if (tags.ele){
      const n = parseFloat(String(tags.ele).replace(',', '.'));
      if (!Number.isNaN(n)) elev = Math.round(n);
    }
    let sub = '';
    if (kind === 'place') sub = tags.place;
    else if (kind === 'water') sub = tags.waterway ? 'Fluss' : 'Gewässer';
    else if (kind === 'sight') sub = tags.historic || tags.tourism || '';
    out.push({ id: `${el.type}/${el.id}`, name, kind, lat, lon, elev, sub });
  }
  return out;
}

/* Entfernt Doppelte (dieselbe OSM-ID kann über mehrere Teilabfragen kommen). */
export function dedupe(objekte){
  const seen = new Map();
  for (const o of objekte) if (!seen.has(o.id)) seen.set(o.id, o);
  return Array.from(seen.values());
}

/* Ortsschlüssel auf ~1 km gerundet. Bewusst OHNE Umkreis: der Umkreis wird
   getrennt mitgeführt (state.loadedRadius), weil ein kleinerer Umkreis in
   bereits geladenen Daten schon enthalten ist und keine neue Abfrage braucht. */
export function locKey(lat, lon){ return `${lat.toFixed(2)},${lon.toFixed(2)}`; }

/* Fragt die Endpunkte der Reihe nach ab und gibt die erste brauchbare Antwort
   zurück. Eigenes Zeitlimit per AbortController, weil fetch keins hat: ein
   überlasteter Endpunkt hinge sonst minutenlang, state.loading bliebe true und
   blockierte jeden weiteren Ladeversuch – die App wirkte tot.
   opts nur für Tests: {fetchImpl, timeoutMs, endpoints}. */
export async function overpassAbfrage(query, opts){
  const o = opts || {};
  const timeoutMs = o.timeoutMs ?? OVERPASS_TIMEOUT_MS;
  const netz = o.fetchImpl || ((url, init) => fetch(url, init));
  const endpunkte = o.endpoints || OVERPASS_ENDPUNKTE;
  let lastErr = null;
  for (const ep of endpunkte){
    const ac = new AbortController();
    const t  = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const resp = await netz(ep, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        signal: ac.signal,
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return await resp.json();
    } catch(err){
      lastErr = (err && err.name === 'AbortError')
        ? new Error('Zeitüberschreitung nach ' + Math.round(timeoutMs/1000) + ' s')
        : err;
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr || new Error('Kein Endpunkt erreichbar');
}
