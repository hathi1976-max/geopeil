/* ============================================================
   Geometrie – reine Funktionen, kein DOM, kein Zustand.
   Der mathematische Kern der App und damit der Teil, der Tests
   bekommt (tests/geo.test.js).
   ============================================================ */

export const ERDRADIUS_KM = 6371;

export const toRad = d => d * Math.PI / 180;
export const toDeg = r => r * 180 / Math.PI;

/* Großkreis-Entfernung in km (Haversine, Kugelmodell).
   Auf der Kugel statt WGS84-Ellipsoid: bis ~0,3 % Abweichung, für
   „welcher Berg ist das?" mehr als genug. */
export function haversine(lat1, lon1, lat2, lon2){
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * ERDRADIUS_KM * Math.asin(Math.sqrt(a));
}

/* Anfangspeilung (Grad, 0 = Nord, im Uhrzeigersinn) auf dem Großkreis.
   Achtung: das ist nicht der Kurswinkel der Loxodrome – auf längeren
   Ost-West-Strecken in unseren Breiten weicht beides sichtbar ab
   (60°N, 10° Länge: 85,7° statt 90°). Für die Peilung zum Ziel ist die
   Anfangspeilung die richtige Größe. */
export function bearing(lat1, lon1, lat2, lon2){
  const f1 = toRad(lat1), f2 = toRad(lat2), dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/* Kleinster Winkelabstand a-b, Ergebnis in (-180 … 180].
   Genau 180° Gegenrichtung liefert -180. */
export function angleDiff(a, b){ return ((a - b + 540) % 360) - 180; }

export const CARDINALS = ['N','NO','O','SO','S','SW','W','NW'];

/* Himmelsrichtung in 45°-Sektoren. Grenzen liegen bei 22,5° + n·45° und
   werden aufgerundet (Math.round): 337,4° → NW, 337,5° → N. */
export function cardinal(deg){ return CARDINALS[Math.round(deg/45) % 8]; }

export const ARROWS = ['↑','↗','→','↘','↓','↙','←','↖'];

/* Pfeil relativ zur Blickrichtung: ↑ heißt „geradeaus". */
export function arrowFor(brg, heading){
  const rel = ((brg - heading) % 360 + 360) % 360;
  return ARROWS[Math.round(rel/45) % 8];
}

/* Liegt die Peilung im Blickfeld ±fov um die Blickrichtung? */
export function imBlickfeld(brg, heading, fov){
  if (heading == null) return false;
  return Math.abs(angleDiff(brg, heading)) <= fov;
}

/* Entfernungstext: unter 1 km metergenau, unter 10 km mit einer
   Nachkommastelle, darüber auf ganze Kilometer. */
export function fmtDist(km){
  if (km < 1)  return Math.round(km*1000) + ' m';
  if (km < 10) return km.toFixed(1) + ' km';
  return Math.round(km) + ' km';
}
