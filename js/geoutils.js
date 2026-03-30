/**
 * Calcola la distanza in km tra due punti geografici usando la formula dell'Haversine.
 * L'Haversine è preferita alla formula euclidea perché tiene conto della curvatura
 * della Terra, necessario per distanze superiori a qualche decina di metri.
 */
export function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raggio medio della Terra in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    // c è l'angolo centrale (in radianti) sotteso dall'arco tra i due punti
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

/**
 * Calcola il bearing (angolo di rotta) da un punto a un altro.
 * Usa la formula del bearing geodetico iniziale, che dà l'angolo rispetto
 * al Nord geografico in senso orario, nell'intervallo [0°, 360°).
 *
 * Nota: il bearing calcolato è quello "iniziale" — su grandi distanze
 * la rotta curva (ortodromica), ma per le distanze in gioco (< 200 km)
 * l'approssimazione è trascurabile.
 */
export function calcolaAngoloTraDuePunti(lat1, lon1, lat2, lon2) {
    const toRad = deg => deg * Math.PI / 180;
    const toDeg = rad => rad * 180 / Math.PI;

    const dLon = toRad(lon2 - lon1);
    lat1 = toRad(lat1);
    lat2 = toRad(lat2);

    // Componenti cartesiane del vettore di rotta sulla sfera
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
              Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    let brng = Math.atan2(y, x);
    brng = toDeg(brng);
    // Normalizza in [0, 360): atan2 restituisce valori in [-180, 180]
    return (brng + 360) % 360;
  }

/**
 * Converte un heading numerico (0-360°) in una delle quattro direzioni cardinali.
 * Usata principalmente per la UI (es. "🧭 45° EST").
 */
export function getDirezioneUtente(heading) {
    if (heading >= 315 || heading < 45) return "NORD";
    if (heading >= 45 && heading < 135) return "EST";
    if (heading >= 135 && heading < 225) return "SUD";
    return "OVEST";
  }

/**
 * Determina se una stazione di ricarica è "davanti" all'utente rispetto alla
 * sua direzione di marcia. Calcola il bearing utente→stazione e lo confronta
 * con l'heading corrente: se la differenza angolare è < 90°, la stazione è
 * nel semicerchio anteriore (davanti) e quindi raggiungibile senza inversione.
 *
 * Tricky: la differenza angolare va calcolata su un cerchio (modulo 360),
 * quindi si usa il trucco (+540) % 360 - 180 per ottenere un valore in [-180, 180].
 */
export function isStazioneAvanti(userLat, userLon, userHeading, stazLat, stazLon) {
    const bearing = calcolaAngoloTraDuePunti(userLat, userLon, stazLat, stazLon);
    const diff = ((bearing - userHeading + 540) % 360) - 180;
    return Math.abs(diff) < 90;
  }

/**
 * Verifica se la direzione geografica di una stazione è compatibile con
 * la direzione di marcia dell'utente, per identificare la carreggiata corretta.
 *
 * Esempio: su A14 (asse NORD-SUD), una stazione con direzione_geografica=NORD
 * si trova sulla carreggiata verso Bologna; se l'utente viaggia verso Sud
 * (heading ≈ 180°), quella stazione non è sulla sua carreggiata → filtrata.
 *
 * Se direzione_geografica è "ND" o non riconosciuta, la funzione restituisce
 * true per non escludere stazioni con dati mancanti.
 *
 * Usa la stessa logica angolare di isStazioneAvanti per la tolleranza ±90°.
 */
export function matchDirezioneGeografica(direzioneGeo, userHeading) {
    const angleMap = {
      'NORD':     0,
      'NORDEST':  45,
      'EST':      90,
      'SUDEST':   135,
      'SUD':      180,
      'SUDOVEST': 225,
      'OVEST':    270,
      'NORDOVEST':315,
    };
    const angle = angleMap[direzioneGeo?.toUpperCase()];
    if (angle === undefined) return true; // ND o sconosciuto: non filtrare
    const diff = ((angle - userHeading + 540) % 360) - 180;
    return Math.abs(diff) < 90;
  }
