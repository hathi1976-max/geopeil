import { gruppe, test, gleich, nahe, wahr, falsch } from './lauf.js';
import { haversine, bearing, angleDiff, cardinal, fmtDist, arrowFor, imBlickfeld }
  from '../js/geo.js';

/* Alle Sollwerte sind von Hand bzw. mit einer UNABHAENGIGEN Formel gerechnet,
   nicht mit der Implementierung selbst:
   - Ein Breitengrad = R * pi/180 = 6371 * 0,0174532925 = 111,19492664 km.
   - Halber Erdumfang = R * pi = 20015,0868 km.
   - Entfernungen gegengerechnet mit dem Kosinussatz der sphaerischen
     Trigonometrie (acos(sin.sin + cos.cos.cos dl)) statt mit Haversine.
   - Peilungen aus geschlossenen Faellen: entlang Meridian 0/180 Grad, entlang
     Aequator 90/270 Grad, (0,0)->(45,45) = atan(1/sqrt 2) = 35,26438968 Grad. */
const GRAD_KM = 111.19492664455873;
const HALBER_UMFANG_KM = 20015.086796020572;

gruppe('haversine', () => {
  test('gleicher Punkt ergibt 0', () => {
    gleich(haversine(52.5, 13.4, 52.5, 13.4), 0);
  });

  test('ein Breitengrad = 111,195 km, unabhaengig von der Laenge', () => {
    nahe(haversine(0, 0, 1, 0), GRAD_KM, 1e-9);
    nahe(haversine(52, 13, 53, 13), GRAD_KM, 1e-9);
    nahe(haversine(-10, 170, -9, 170), GRAD_KM, 1e-9);
  });

  test('ein Laengengrad am Aequator = ein Breitengrad', () => {
    nahe(haversine(0, 0, 0, 1), GRAD_KM, 1e-9);
  });

  test('ein Laengengrad bei 60 Grad Nord = halb so lang', () => {
    // cos(60 Grad) = 0,5 exakt
    nahe(haversine(60, 0, 60, 1), GRAD_KM / 2, 0.01);
  });

  test('Gegenpunkt = halber Erdumfang', () => {
    nahe(haversine(0, 0, 0, 180), HALBER_UMFANG_KM, 1e-6);
    nahe(haversine(-90, 0, 90, 0), HALBER_UMFANG_KM, 1e-6);
  });

  test('Richtung spielt keine Rolle', () => {
    nahe(haversine(52, 13, 48, 11), haversine(48, 11, 52, 13), 1e-12);
  });

  test('Berlin - Muenchen = 504,34 km', () => {
    // Kosinussatz-Gegenrechnung: 504,33790 km
    nahe(haversine(52.520, 13.405, 48.137, 11.575), 504.3379, 0.01);
  });

  test('Datumsgrenze wird nicht zum Umweg', () => {
    // 179 Grad Ost nach 179 Grad West sind 2 Grad, nicht 358
    nahe(haversine(0, 179, 0, -179), 2 * GRAD_KM, 1e-9);
  });
});

gruppe('bearing', () => {
  test('entlang des Meridians: Nord = 0, Sued = 180', () => {
    nahe(bearing(0, 0, 1, 0), 0, 1e-9);
    nahe(bearing(0, 0, -1, 0), 180, 1e-9);
    nahe(bearing(50, 8, 51, 8), 0, 1e-9);
    nahe(bearing(51, 8, 50, 8), 180, 1e-9);
  });

  test('entlang des Aequators: Ost = 90, West = 270', () => {
    nahe(bearing(0, 0, 0, 1), 90, 1e-9);
    nahe(bearing(0, 0, 0, -1), 270, 1e-9);
  });

  test('(0,0) nach (45,45) = atan(1/sqrt 2) = 35,2644 Grad', () => {
    nahe(bearing(0, 0, 45, 45), 35.264389682754654, 1e-9);
  });

  test('Grosskreis ist nicht die Loxodrome', () => {
    // 60 Grad Nord, 10 Grad nach Osten: der kuerzeste Weg startet noerdlicher
    // als 90 Grad. Gegenrechnung: 85,66713 Grad.
    nahe(bearing(60, 0, 60, 10), 85.66713, 1e-4);
  });

  test('Rueckpeilung Berlin/Muenchen weicht um 1,4 Grad von 180 ab', () => {
    // Meridiankonvergenz: 195,63416 Grad hin, 14,22450 Grad zurueck
    nahe(bearing(52.520, 13.405, 48.137, 11.575), 195.63416, 1e-4);
    nahe(bearing(48.137, 11.575, 52.520, 13.405), 14.22450, 1e-4);
  });

  test('Ergebnis liegt immer in 0 bis unter 360', () => {
    for (const [a, b] of [[0, -1], [-45, -90], [10, -170], [-80, 179]]){
      const w = bearing(0, 0, a, b);
      wahr(w >= 0 && w < 360, `bearing(0,0,${a},${b}) = ${w}`);
    }
  });
});

gruppe('angleDiff', () => {
  test('Nulldurchgang wird kurz herum gerechnet', () => {
    gleich(angleDiff(350, 10), -20);
    gleich(angleDiff(10, 350), 20);
    gleich(angleDiff(359, 1), -2);
    gleich(angleDiff(1, 359), 2);
  });

  test('ohne Nulldurchgang die schlichte Differenz', () => {
    gleich(angleDiff(0, 0), 0);
    gleich(angleDiff(90, 0), 90);
    gleich(angleDiff(0, 90), -90);
    gleich(angleDiff(179, 0), 179);
  });

  test('genaue Gegenrichtung ergibt -180 (dokumentierter Rand)', () => {
    gleich(angleDiff(180, 0), -180);
    gleich(angleDiff(0, 180), -180);
  });

  test('Ergebnis liegt immer in -180 bis 180', () => {
    for (let a = 0; a < 360; a += 7){
      for (let b = 0; b < 360; b += 13){
        const d = angleDiff(a, b);
        wahr(d > -180.0001 && d <= 180, `angleDiff(${a},${b}) = ${d}`);
      }
    }
  });
});

gruppe('cardinal', () => {
  test('die acht Sektormitten', () => {
    gleich(cardinal(0), 'N');
    gleich(cardinal(45), 'NO');
    gleich(cardinal(90), 'O');
    gleich(cardinal(135), 'SO');
    gleich(cardinal(180), 'S');
    gleich(cardinal(225), 'SW');
    gleich(cardinal(270), 'W');
    gleich(cardinal(315), 'NW');
  });

  test('Nord laeuft ueber die Null hinweg zusammen', () => {
    gleich(cardinal(359), 'N');
    gleich(cardinal(360), 'N');
  });

  test('Sektorgrenzen werden aufgerundet', () => {
    // Math.round(7.5) = 8 -> zurueck auf N. Der Review nannte fuer 337,5
    // "NW"; das gilt erst knapp darunter.
    gleich(cardinal(337.4), 'NW');
    gleich(cardinal(337.5), 'N');
    gleich(cardinal(22.4), 'N');
    gleich(cardinal(22.5), 'NO');
  });
});

gruppe('fmtDist', () => {
  test('unter 1 km metergenau', () => {
    gleich(fmtDist(0), '0 m');
    gleich(fmtDist(0.5), '500 m');
    gleich(fmtDist(0.0004), '0 m');
    gleich(fmtDist(0.9994), '999 m');
  });

  test('1 bis 10 km mit einer Nachkommastelle', () => {
    gleich(fmtDist(1), '1.0 km');
    gleich(fmtDist(5.25), '5.3 km');
    gleich(fmtDist(9.99), '10.0 km');
  });

  test('ab 10 km auf ganze Kilometer', () => {
    gleich(fmtDist(10), '10 km');
    gleich(fmtDist(120), '120 km');
    gleich(fmtDist(120.4), '120 km');
    gleich(fmtDist(120.5), '121 km');
  });
});

gruppe('arrowFor', () => {
  test('Pfeil ist relativ zur Blickrichtung', () => {
    gleich(arrowFor(0, 0), '↑');
    gleich(arrowFor(90, 0), '→');
    gleich(arrowFor(180, 0), '↓');
    gleich(arrowFor(270, 0), '←');
    gleich(arrowFor(45, 0), '↗');
  });

  test('dieselbe Peilung zeigt bei gedrehtem Blick woanders hin', () => {
    gleich(arrowFor(0, 90), '←');
    gleich(arrowFor(0, 180), '↓');
    gleich(arrowFor(0, 270), '→');
  });

  test('knapp vor Nord zeigt weiter geradeaus', () => {
    gleich(arrowFor(350, 0), '↑');
    gleich(arrowFor(10, 0), '↑');
  });
});

gruppe('imBlickfeld', () => {
  test('geradeaus ist im Blickfeld, quer nicht', () => {
    wahr(imBlickfeld(0, 0, 25));
    wahr(imBlickfeld(20, 0, 25));
    falsch(imBlickfeld(30, 0, 25));
    falsch(imBlickfeld(180, 0, 25));
  });

  test('der Rand zaehlt noch dazu', () => {
    wahr(imBlickfeld(25, 0, 25));
    wahr(imBlickfeld(335, 0, 25));
    falsch(imBlickfeld(25.001, 0, 25));
  });

  test('funktioniert ueber den Nulldurchgang', () => {
    wahr(imBlickfeld(355, 10, 25));
    wahr(imBlickfeld(10, 355, 25));
    falsch(imBlickfeld(340, 10, 25));
  });

  test('ohne Kompasswert ist nichts im Blickfeld', () => {
    falsch(imBlickfeld(0, null, 25));
    falsch(imBlickfeld(123, undefined, 60));
  });

  test('breites Blickfeld nimmt mehr auf', () => {
    falsch(imBlickfeld(50, 0, 25));
    wahr(imBlickfeld(50, 0, 60));
  });
});
