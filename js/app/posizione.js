import { distanzaKm, bearing } from '../core/geo.js';
import { codiceDaNomeStrada, estraiCodice } from '../core/autostrade.js';
import { avviaSimulazione } from './simulazione.js';
import {
  REVERSE_GEOCODING_INTERVALLO_MS,
  REVERSE_GEOCODING_DISTANZA_KM,
  REVERSE_GEOCODING_PAUSA_MINIMA_MS,
  HEADING_SPOSTAMENTO_MINIMO_KM,
} from '../config.js';

/**
 * Stato della posizione dell'utente, unica fonte di verità per il resto dell'app.
 * headingStimato: true se calcolato dallo spostamento, false se fornito dal dispositivo.
 */
const stato = {
  coords: null,
  heading: 0,
  headingStimato: true,
  strada: '',
  codiceAutostrada: null,
  paese: null,
};

let gpsNegato = false;
let onAggiornamento = () => {};

export function getStato() {
  return stato;
}

/**
 * Avvia il tracciamento: GPS reale oppure simulazione.
 * onAggiornamento(stato) viene chiamato a ogni nuova posizione e quando il
 * reverse geocoding identifica una nuova strada.
 */
export function avviaPosizione({ simulazione, onAggiornamento: callback }) {
  onAggiornamento = callback;

  if (simulazione) {
    avviaSimulazione((lat, lon, salto) => {
      if (salto) dimenticaTraccia();
      nuovaPosizione(lat, lon, null);
    });
    return;
  }

  if (!('geolocation' in navigator)) {
    console.warn('Geolocalizzazione non supportata dal browser.');
    gpsNegato = true;
    return;
  }

  navigator.geolocation.watchPosition(
    pos => nuovaPosizione(pos.coords.latitude, pos.coords.longitude, pos.coords.heading),
    err => {
      console.warn('Errore geolocalizzazione:', err);
      if (err.code === err.PERMISSION_DENIED) gpsNegato = true;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

/**
 * Attende la prima posizione disponibile. Restituisce null se il permesso
 * è negato o se non arriva nulla entro timeoutMs.
 */
export function attendiPrimaPosizione(timeoutMs) {
  const scadenza = Date.now() + timeoutMs;
  return new Promise(resolve => {
    const controlla = () => {
      if (stato.coords) resolve(stato.coords);
      else if (gpsNegato || Date.now() >= scadenza) resolve(null);
      else setTimeout(controlla, 200);
    };
    controlla();
  });
}

function nuovaPosizione(lat, lon, headingDispositivo) {
  stato.coords = { lat, lon };
  aggiornaHeading(lat, lon, headingDispositivo);
  aggiornaStradaSeNecessario(lat, lon);
  onAggiornamento(stato);
}

/**
 * Dopo un salto della simulazione nulla della traccia precedente vale più: l'heading
 * calcolato tra i due punti, la strada riconosciuta e le risposte di Nominatim in arrivo.
 */
function dimenticaTraccia() {
  ultimaPosizioneHeading = null;
  ultimoReverse = { ...ultimoReverse, pos: null };
  generazioneReverse++;
  Object.assign(stato, { strada: '', codiceAutostrada: null, paese: null });
}

let ultimaPosizioneHeading = null;

function aggiornaHeading(lat, lon, headingDispositivo) {
  if (headingDispositivo != null && !isNaN(headingDispositivo)) {
    stato.heading = headingDispositivo;
    stato.headingStimato = false;
    ultimaPosizioneHeading = { lat, lon };
    return;
  }

  if (ultimaPosizioneHeading) {
    const { lat: lat0, lon: lon0 } = ultimaPosizioneHeading;
    if (distanzaKm(lat0, lon0, lat, lon) < HEADING_SPOSTAMENTO_MINIMO_KM) return;
    stato.heading = bearing(lat0, lon0, lat, lon);
  }
  stato.headingStimato = true;
  ultimaPosizioneHeading = { lat, lon };
}

let ultimoReverse = { pos: null, quando: 0 };
// Le risposte possono arrivare in disordine: si applica solo la più recente, e mai una
// partita prima dell'ultimo salto della simulazione (generazione diversa)
let generazioneReverse = 0;
let ultimaRichiesta = 0;
let ultimaApplicata = 0;

// Throttling per rispettare i limiti d'uso di Nominatim
function aggiornaStradaSeNecessario(lat, lon) {
  const { pos, quando } = ultimoReverse;
  if (Date.now() - quando < REVERSE_GEOCODING_PAUSA_MINIMA_MS) return;
  const necessario = !pos
    || Date.now() - quando > REVERSE_GEOCODING_INTERVALLO_MS
    || distanzaKm(pos.lat, pos.lon, lat, lon) > REVERSE_GEOCODING_DISTANZA_KM;
  if (!necessario) return;

  ultimoReverse = { pos: { lat, lon }, quando: Date.now() };
  const richiesta = ++ultimaRichiesta;
  const generazione = generazioneReverse;
  reverseGeocode(lat, lon).then(risultato => {
    if (!risultato || generazione !== generazioneReverse || richiesta < ultimaApplicata) return;
    ultimaApplicata = richiesta;
    // La sigla OSM ("A14", "A 7") funziona in ogni paese; i nomi italiani restano come riserva
    const codiceAutostrada = estraiCodice(risultato.sigla) ?? codiceDaNomeStrada(risultato.strada);
    const cambiata = risultato.strada !== stato.strada
      || codiceAutostrada !== stato.codiceAutostrada
      || risultato.paese !== stato.paese;
    Object.assign(stato, { strada: risultato.strada, codiceAutostrada, paese: risultato.paese });
    if (cambiata) onAggiornamento(stato);
  });
}

/** { strada, sigla, paese } della strada più vicina secondo Nominatim, oppure null in caso di errore. */
async function reverseGeocode(lat, lon) {
  try {
    // zoom=17: restituisce la strada (non l'edificio); namedetails include la sigla (ref)
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&namedetails=1&lat=${lat}&lon=${lon}`);
    const data = await res.json();
    const strada = data.address?.road || data.name || data.display_name;
    if (!strada) return null;
    const sigla = data.category === 'highway' ? data.namedetails?.ref ?? null : null;
    return { strada, sigla, paese: data.address?.country_code?.toUpperCase() ?? null };
  } catch (err) {
    console.warn('Reverse geocoding fallito:', err);
    return null;
  }
}
