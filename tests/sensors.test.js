import { gruppe, test, gleich, tiefGleich, wahr } from './lauf.js';
import { startGeo, stopGeo, aktiverWatcher, setzeFixRueckruf } from '../js/sensors.js';
import { state } from '../js/store.js';

/* Befund A1: jeder Klick auf „Erneut versuchen" registrierte einen weiteren
   GPS-Watcher, weil die Rueckgabe von watchPosition verworfen wurde. Geprueft
   wird das mit einer Attrappe statt mit echtem GPS – startGeo nimmt die
   geolocation-Quelle als Parameter. */
function gpsAttrappe(){
  return {
    gestartet: 0,
    abgemeldet: [],
    naechsteId: 0,
    erfolg: null,
    fehler: null,
    optionen: null,
    watchPosition(ok, err, opts){
      this.gestartet++;
      this.erfolg = ok; this.fehler = err; this.optionen = opts;
      return ++this.naechsteId;
    },
    clearWatch(id){ this.abgemeldet.push(id); },
  };
}

gruppe('startGeo', () => {
  test('ein einzelner Aufruf startet genau einen Watcher', () => {
    stopGeo();
    const g = gpsAttrappe();
    const id = startGeo(g);
    gleich(g.gestartet, 1);
    tiefGleich(g.abgemeldet, []);
    gleich(aktiverWatcher(), id);
    stopGeo();
  });

  test('drei Neuversuche hinterlassen trotzdem nur einen Watcher', () => {
    stopGeo();
    const g = gpsAttrappe();
    startGeo(g); startGeo(g); startGeo(g);
    gleich(g.gestartet, 3, 'Registrierungen');
    // Vor der Behebung: [] – die IDs 1 und 2 liefen einfach weiter.
    tiefGleich(g.abgemeldet, [1, 2], 'Abmeldungen in der Reihenfolge');
    gleich(aktiverWatcher(), 3, 'nur der juengste Watcher laeuft noch');
    stopGeo();
  });

  test('stopGeo meldet auch den letzten Watcher ab', () => {
    stopGeo();
    const g = gpsAttrappe();
    startGeo(g);
    stopGeo();
    tiefGleich(g.abgemeldet, [1]);
    gleich(aktiverWatcher(), null);
    // Zweimal stoppen darf nicht doppelt abmelden
    stopGeo();
    tiefGleich(g.abgemeldet, [1]);
  });

  test('Wechsel der Quelle meldet beim alten Anbieter ab', () => {
    stopGeo();
    const alt = gpsAttrappe(), neu = gpsAttrappe();
    startGeo(alt);
    startGeo(neu);
    tiefGleich(alt.abgemeldet, [1], 'die alte Quelle raeumt ihren eigenen Watcher ab');
    tiefGleich(neu.abgemeldet, []);
    gleich(neu.gestartet, 1);
    stopGeo();
  });

  test('ohne Standortdienst entsteht kein Watcher', () => {
    stopGeo();
    gleich(startGeo(null), null);
    gleich(aktiverWatcher(), null);
  });

  test('hohe Genauigkeit ist angefordert', () => {
    stopGeo();
    const g = gpsAttrappe();
    startGeo(g);
    gleich(g.optionen.enableHighAccuracy, true);
    wahr(g.optionen.timeout > 0);
    stopGeo();
  });
});

gruppe('GPS-Fix', () => {
  test('erster Fix setzt state.pos und meldet „neu" an die Ladeschicht', () => {
    stopGeo();
    const vorherPos = state.pos;
    state.pos = null;

    const gemeldet = [];
    setzeFixRueckruf(first => gemeldet.push(first));

    const g = gpsAttrappe();
    startGeo(g);
    g.erfolg({ coords: { latitude: 47.42, longitude: 10.98, accuracy: 12 } });
    tiefGleich(state.pos, { lat: 47.42, lon: 10.98, acc: 12 });
    tiefGleich(gemeldet, [true], 'erster Fix');

    g.erfolg({ coords: { latitude: 47.43, longitude: 10.99, accuracy: 9 } });
    tiefGleich(gemeldet, [true, false], 'jeder weitere Fix ist kein erster mehr');
    gleich(state.pos.acc, 9);

    setzeFixRueckruf(() => {});
    state.pos = vorherPos;
    stopGeo();
  });
});
