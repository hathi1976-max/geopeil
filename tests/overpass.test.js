import { gruppe, test, gleich, tiefGleich, wahr, falsch, wirftAsync } from './lauf.js';
import { buildQuery, classify, parseElements, dedupe, locKey, overpassAbfrage }
  from '../js/overpass.js';

/* WICHTIG: hier laeuft kein einziger echter Netzabruf. overpassAbfrage nimmt
   fetchImpl/timeoutMs/endpoints entgegen; Overpass ist ein fremder, gedrosselter
   Dienst und wird von Tests nicht angefasst. */

const ALLE_KATEGORIEN = { peak:true, water:true, place:true, sight:true };

gruppe('buildQuery', () => {
  test('Kopf und Fuss stehen fest', () => {
    const q = buildQuery(52.5, 13.4, 60000, ALLE_KATEGORIEN);
    wahr(q.startsWith('[out:json][timeout:30];('), q);
    wahr(q.endsWith(');out center tags;'), q);
  });

  test('Radius und Koordinaten stehen in jedem Teil', () => {
    const q = buildQuery(52.5, 13.4, 60000, { peak:true });
    gleich((q.match(/around:60000,52\.5,13\.4/g) || []).length, 2, 'peak + volcano');
  });

  test('abgewaehlte Kategorien tauchen nicht auf', () => {
    const q = buildQuery(0, 0, 1000, { peak:true });
    wahr(q.includes('"natural"="peak"'));
    falsch(q.includes('"place"'));
    falsch(q.includes('"historic"'));
    falsch(q.includes('"waterway"'));
  });

  test('ohne Kategorie bleibt eine leere, gueltige Abfrage', () => {
    gleich(buildQuery(0, 0, 1000, {}), '[out:json][timeout:30];();out center tags;');
    gleich(buildQuery(0, 0, 1000, null), '[out:json][timeout:30];();out center tags;');
  });

  test('Orte sind auf die fuenf sinnvollen Typen begrenzt', () => {
    const q = buildQuery(0, 0, 1000, { place:true });
    wahr(q.includes('^(city|town|village|hamlet|suburb)$'), q);
  });
});

gruppe('classify', () => {
  test('erkennt die vier Arten', () => {
    gleich(classify({ natural:'peak' }), 'peak');
    gleich(classify({ natural:'volcano' }), 'peak');
    gleich(classify({ natural:'water' }), 'water');
    gleich(classify({ waterway:'river' }), 'water');
    gleich(classify({ place:'town' }), 'place');
    gleich(classify({ tourism:'viewpoint' }), 'sight');
    gleich(classify({ historic:'castle' }), 'sight');
  });

  test('Unbekanntes und Leeres ergibt null', () => {
    gleich(classify({ amenity:'cafe' }), null);
    gleich(classify({}), null);
    gleich(classify(null), null);
  });

  test('Berg schlaegt Ort, wenn beides getaggt ist', () => {
    gleich(classify({ natural:'peak', place:'hamlet' }), 'peak');
  });
});

gruppe('parseElements', () => {
  test('Knoten mit Namen und Hoehe', () => {
    const [o] = parseElements([
      { type:'node', id:1, lat:47.42, lon:10.98, tags:{ natural:'peak', name:'Zugspitze', ele:'2962' } },
    ]);
    tiefGleich(o, { id:'node/1', name:'Zugspitze', kind:'peak', lat:47.42, lon:10.98, elev:2962, sub:'' });
  });

  test('Weg nimmt die Mittelpunkt-Koordinate', () => {
    const [o] = parseElements([
      { type:'way', id:7, center:{ lat:52.5, lon:13.4 }, tags:{ waterway:'river', name:'Spree' } },
    ]);
    gleich(o.id, 'way/7');
    gleich(o.lat, 52.5);
    gleich(o.sub, 'Fluss');
  });

  test('ohne Namen, ohne Koordinate oder ohne bekannte Art wird verworfen', () => {
    const out = parseElements([
      { type:'node', id:1, lat:1, lon:1, tags:{ natural:'peak' } },              // kein Name
      { type:'node', id:2, tags:{ natural:'peak', name:'Ohne Ort' } },           // keine Koordinate
      { type:'node', id:3, lat:1, lon:1, tags:{ amenity:'cafe', name:'Cafe' } }, // keine Art
      { type:'node', id:4, lat:1, lon:1 },                                       // gar keine Tags
      { type:'node', id:5, lat:1, lon:1, tags:{ place:'village', name:'Bleibt' } },
    ]);
    gleich(out.length, 1);
    gleich(out[0].name, 'Bleibt');
  });

  test('name:de springt ein, wenn name fehlt', () => {
    const [o] = parseElements([
      { type:'node', id:9, lat:1, lon:1, tags:{ place:'city', 'name:de':'Prag' } },
    ]);
    gleich(o.name, 'Prag');
    gleich(o.sub, 'city');
  });

  test('Hoehenangaben aus OSM sind unsauber', () => {
    const hoehe = (ele) => parseElements([
      { type:'node', id:1, lat:1, lon:1, tags:{ natural:'peak', name:'X', ele } },
    ])[0].elev;
    gleich(hoehe('1838'), 1838);
    gleich(hoehe('1838.4'), 1838);
    gleich(hoehe('1838,5'), 1839);   // Komma als Dezimaltrenner
    gleich(hoehe('1838 m'), 1838);   // Einheit angehaengt
    gleich(hoehe('ungefaehr'), null);
    gleich(hoehe(''), null);         // leerer String zaehlt als "keine Angabe"
  });

  test('leere oder fehlende Eingabe faellt nicht um', () => {
    tiefGleich(parseElements([]), []);
    tiefGleich(parseElements(null), []);
    tiefGleich(parseElements(undefined), []);
  });
});

gruppe('dedupe', () => {
  test('gleiche OSM-ID nur einmal, der erste gewinnt', () => {
    const out = dedupe([
      { id:'node/1', name:'zuerst' },
      { id:'node/1', name:'spaeter' },
      { id:'way/1',  name:'anderer Typ, gleiche Zahl' },
    ]);
    gleich(out.length, 2);
    gleich(out[0].name, 'zuerst');
  });
});

gruppe('locKey', () => {
  test('rundet auf zwei Nachkommastellen (~1 km)', () => {
    gleich(locKey(52.5194, 13.4053), '52.52,13.41');
    gleich(locKey(52.5203, 13.4149), '52.52,13.41');
  });

  test('enthaelt den Umkreis NICHT', () => {
    // Sonst loeste jede Radiusaenderung beim naechsten GPS-Fix eine Abfrage aus
    // (Befund A2); der geladene Umkreis steht getrennt in state.loadedRadius.
    falsch(locKey(52.5, 13.4).includes('60'));
    gleich(locKey(52.5, 13.4), locKey(52.5, 13.4));
  });

  test('negative Koordinaten behalten ihr Vorzeichen', () => {
    gleich(locKey(-33.8688, 151.2093), '-33.87,151.21');
  });
});

/* ---------- Netzweg mit Attrappen ---------- */
function antwort(json, ok = true, status = 200){
  return { ok, status, json: async () => json };
}
/* Endpunkt, der nie antwortet – bis der AbortController zuschlaegt. */
function haengenderEndpunkt(protokoll){
  return (url, init) => new Promise((_, reject) => {
    protokoll?.push({ url, signal: init.signal });
    init.signal.addEventListener('abort', () => {
      const e = new Error('The user aborted a request.');
      e.name = 'AbortError';
      reject(e);
    });
  });
}

gruppe('overpassAbfrage', () => {
  test('POST mit data=-Nutzlast', async () => {
    let gesehen = null;
    await overpassAbfrage('node["x"];', {
      endpoints: ['https://beispiel.test/api'],
      fetchImpl: (url, init) => { gesehen = { url, ...init }; return Promise.resolve(antwort({ elements: [] })); },
    });
    gleich(gesehen.url, 'https://beispiel.test/api');
    gleich(gesehen.method, 'POST');
    gleich(gesehen.body, 'data=' + encodeURIComponent('node["x"];'));
  });

  test('Erfolg beim ersten Endpunkt fragt den zweiten nicht mehr', async () => {
    let aufrufe = 0;
    const data = await overpassAbfrage('q', {
      endpoints: ['erster', 'zweiter'],
      fetchImpl: () => { aufrufe++; return Promise.resolve(antwort({ elements: [{ id: 1 }] })); },
    });
    gleich(aufrufe, 1);
    gleich(data.elements.length, 1);
  });

  test('HTTP-Fehler schaltet auf den naechsten Endpunkt weiter', async () => {
    const benutzt = [];
    const data = await overpassAbfrage('q', {
      endpoints: ['ueberlastet', 'frei'],
      fetchImpl: (url) => {
        benutzt.push(url);
        return Promise.resolve(url === 'ueberlastet' ? antwort(null, false, 429) : antwort({ elements: [] }));
      },
    });
    tiefGleich(benutzt, ['ueberlastet', 'frei']);
    tiefGleich(data, { elements: [] });
  });

  test('letzter HTTP-Fehler wird gemeldet', async () => {
    const e = await wirftAsync(() => overpassAbfrage('q', {
      endpoints: ['nur einer'],
      fetchImpl: () => Promise.resolve(antwort(null, false, 429)),
    }));
    gleich(e.message, 'HTTP 429');
  });

  test('haengender Endpunkt wird nach timeoutMs abgebrochen', async () => {
    const e = await wirftAsync(() => overpassAbfrage('q', {
      endpoints: ['haengt'],
      timeoutMs: 30,
      fetchImpl: haengenderEndpunkt(),
    }));
    wahr(e.message.includes('Zeit'), 'Meldung war: ' + e.message);
  });

  test('das durchgereichte signal ist nach dem Abbruch aborted', async () => {
    const protokoll = [];
    await wirftAsync(() => overpassAbfrage('q', {
      endpoints: ['haengt'],
      timeoutMs: 30,
      fetchImpl: haengenderEndpunkt(protokoll),
    }));
    gleich(protokoll.length, 1);
    gleich(protokoll[0].signal.aborted, true);
  });

  test('haengender erster Endpunkt: der zweite uebernimmt', async () => {
    const benutzt = [];
    const haengt = haengenderEndpunkt();
    const data = await overpassAbfrage('q', {
      endpoints: ['haengt', 'frei'],
      timeoutMs: 30,
      fetchImpl: (url, init) => {
        benutzt.push(url);
        return url === 'haengt' ? haengt(url, init) : Promise.resolve(antwort({ elements: [{ id: 2 }] }));
      },
    });
    tiefGleich(benutzt, ['haengt', 'frei']);
    gleich(data.elements[0].id, 2);
  });

  test('ohne jeden Endpunkt gibt es eine klare Meldung', async () => {
    const e = await wirftAsync(() => overpassAbfrage('q', { endpoints: [] }));
    gleich(e.message, 'Kein Endpunkt erreichbar');
  });
});
