// Calcola la distanza in km tra due coordinate geografiche usando la formula dell'haversine
export function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raggio della Terra in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
  
  export function calcolaAngoloTraDuePunti(lat1, lon1, lat2, lon2) {
    const toRad = deg => deg * Math.PI / 180;
    const toDeg = rad => rad * 180 / Math.PI;
  
    const dLon = toRad(lon2 - lon1);
    lat1 = toRad(lat1);
    lat2 = toRad(lat2);
  
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
              Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  
    let brng = Math.atan2(y, x);
    brng = toDeg(brng);
    return (brng + 360) % 360;
  }
  
  export function getDirezioneUtente(heading) {
    if (heading >= 315 || heading < 45) return "NORD";
    if (heading >= 45 && heading < 135) return "EST";
    if (heading >= 135 && heading < 225) return "SUD";
    return "OVEST";
  }

  // Restituisce true se la stazione è "avanti" rispetto alla direzione di marcia dell'utente.
  // Controlla che il bearing utente→stazione sia entro ±90° dall'heading dell'utente.
  export function isStazioneAvanti(userLat, userLon, userHeading, stazLat, stazLon) {
    const bearing = calcolaAngoloTraDuePunti(userLat, userLon, stazLat, stazLon);
    const diff = ((bearing - userHeading + 540) % 360) - 180;
    return Math.abs(diff) < 90;
  }

  // Restituisce true se la direzione_geografica della stazione è compatibile con
  // l'heading dell'utente. Questo identifica la carreggiata: ad es. su A14,
  // direzione_geografica=NORD corrisponde alla carreggiata EST (verso Bologna),
  // SUD alla carreggiata OVEST (verso Bari). Con ND (non determinato) si lascia passare.
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