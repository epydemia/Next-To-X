const toRad = deg => deg * Math.PI / 180;
const toDeg = rad => rad * 180 / Math.PI;

/** Distanza in km tra due punti (formula dell'Haversine). */
export function distanzaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Bearing iniziale da un punto all'altro: gradi da Nord in senso orario, in [0, 360). */
export function bearing(lat1, lon1, lat2, lon2) {
  const dLon = toRad(lon2 - lon1);
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const y = Math.sin(dLon) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Differenza angolare con segno in [-180, 180). */
export function differenzaAngolare(a, b) {
  return ((a - b + 540) % 360) - 180;
}

/** "NORD" | "EST" | "SUD" | "OVEST" per un heading in gradi. */
export function puntoCardinale(heading) {
  if (heading >= 315 || heading < 45) return 'NORD';
  if (heading < 135) return 'EST';
  if (heading < 225) return 'SUD';
  return 'OVEST';
}

/** True se il punto è nel semicerchio davanti a chi viaggia con l'heading dato. */
export function isDavanti(lat, lon, heading, latPunto, lonPunto) {
  return Math.abs(differenzaAngolare(bearing(lat, lon, latPunto, lonPunto), heading)) < 90;
}

const ANGOLI_DIREZIONE = {
  NORD: 0, NORDEST: 45, EST: 90, SUDEST: 135,
  SUD: 180, SUDOVEST: 225, OVEST: 270, NORDOVEST: 315,
};

/**
 * True se la carreggiata di una stazione ("NORD", "SUDEST", …) è compatibile con
 * l'heading dell'utente (±90°). Direzioni mancanti o "ND" non escludono la stazione.
 */
export function stessaDirezione(direzioneGeografica, heading) {
  const angolo = ANGOLI_DIREZIONE[direzioneGeografica?.toUpperCase()];
  if (angolo === undefined) return true;
  return Math.abs(differenzaAngolare(angolo, heading)) < 90;
}
