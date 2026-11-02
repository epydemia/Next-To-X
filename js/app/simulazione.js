import { SIMULAZIONE_ACCELERAZIONE, SIMULAZIONE_PASSO_MINIMO_MS } from '../config.js';

// Percorso usato finché non viene caricata una traccia CSV (A14 zona Foggia)
const PERCORSO_DEFAULT = [
  { lat: 41.638756, lon: 15.453696, ts: 0 },
  { lat: 41.64647,  lon: 15.446288, ts: 30000 },
  { lat: 41.653435, lon: 15.437314, ts: 60000 },
  { lat: 41.660397, lon: 15.428341, ts: 90000 },
  { lat: 41.67748,  lon: 15.416491, ts: 120000 },
  { lat: 41.686028, lon: 15.411482, ts: 150000 },
  { lat: 41.693935, lon: 15.406848, ts: 180000 },
  { lat: 41.70322,  lon: 15.405508, ts: 210000 },
  { lat: 41.712616, lon: 15.40863,  ts: 240000 },
  { lat: 41.72199,  lon: 15.411748, ts: 270000 },
];

let percorso = PERCORSO_DEFAULT;
let onPunto = null;
let onProgresso = null;
let timer = null;

/**
 * Avvia la riproduzione in loop del percorso corrente; onPunto(lat, lon, salto) a ogni passo.
 * salto è true quando il punto non segue il precedente (nuova traccia, cursore, ripartenza del giro).
 */
export function avviaSimulazione(callback) {
  onPunto = callback;
  riparti();
}

/**
 * Sostituisce il percorso con una traccia CSV (formato export TeslaFi).
 * Se la simulazione è in corso, riparte dal primo punto della nuova traccia.
 * @returns {number} punti caricati (0 se il CSV non è valido)
 */
export function caricaTracciaCSV(testo) {
  const punti = parseTracciaCSV(testo);
  if (punti.length === 0) return 0;
  percorso = punti;
  if (onPunto) riparti();
  return punti.length;
}

/** onProgresso({ indice, totale, trascorsoMs, durataMs }) a ogni passo, per il cursore di riproduzione. */
export function osservaProgresso(callback) {
  onProgresso = callback;
}

/** Salta al punto i del percorso e prosegue da lì. */
export function vaiAlPunto(i) {
  if (!onPunto) return;
  clearTimeout(timer);
  passo(Math.min(Math.max(i, 0), percorso.length - 1), true);
}

function riparti() {
  clearTimeout(timer);
  passo(0, true);
}

function passo(i, salto = i === 0) {
  const { lat, lon } = percorso[i];
  onPunto(lat, lon, salto);
  onProgresso?.({
    indice: i,
    totale: percorso.length,
    trascorsoMs: percorso[i].ts - percorso[0].ts,
    durataMs: percorso.at(-1).ts - percorso[0].ts,
  });

  // Attesa proporzionale al tempo reale tra i due punti; dopo l'ultimo si torna al primo
  const prossimo = (i + 1) % percorso.length;
  const deltaTs = percorso.length > 1 ? Math.abs(percorso[prossimo].ts - percorso[i].ts) : 30000;
  const attesa = Math.max(deltaTs / SIMULAZIONE_ACCELERAZIONE, SIMULAZIONE_PASSO_MINIMO_MS);
  timer = setTimeout(() => passo(prossimo), attesa);
}

/**
 * Colonne richieste: "Latitude", "Longitude". Opzionale: "Timestamp (<fuso>)",
 * es. "Timestamp (CEST)" o "Timestamp (CET)"; se assente si assume un punto ogni 30 s.
 */
export function parseTracciaCSV(testo) {
  const righe = testo.trim().split(/\r?\n/);
  if (righe.length < 2) return [];

  const header = parseRigaCSV(righe[0]);
  // Il fuso nell'intestazione cambia con l'ora legale; contano solo gli intervalli tra i punti
  const iTs  = header.findIndex(h => /^Timestamp\b/.test(h));
  const iLat = header.indexOf('Latitude');
  const iLon = header.indexOf('Longitude');
  if (iLat === -1 || iLon === -1) {
    console.error('CSV: colonne Latitude/Longitude non trovate');
    return [];
  }

  const punti = [];
  righe.slice(1).forEach(riga => {
    if (!riga.trim()) return;
    const campi = parseRigaCSV(riga);
    const lat = parseFloat(campi[iLat]);
    const lon = parseFloat(campi[iLon]);
    if (isNaN(lat) || isNaN(lon)) return;
    // "2025-07-01 10:00:00" → "2025-07-01T10:00:00", formato accettato da Date() ovunque
    const tsLetto = iTs !== -1 ? new Date((campi[iTs] ?? '').replace(' ', 'T')).getTime() : NaN;
    // Senza timestamp leggibile: 30 s dopo il punto precedente, così non si mescola con quelli veri
    const ts = isNaN(tsLetto) ? (punti.at(-1)?.ts ?? 0) + 30000 : tsLetto;
    punti.push({ lat, lon, ts });
  });
  return punti;
}

/** Split di una riga CSV che rispetta i campi tra virgolette (es. "Via Roma, 1"). */
function parseRigaCSV(riga) {
  const campi = [];
  let corrente = '';
  let traVirgolette = false;
  for (const ch of riga) {
    if (ch === '"') traVirgolette = !traVirgolette;
    else if (ch === ',' && !traVirgolette) { campi.push(corrente.trim()); corrente = ''; }
    else corrente += ch;
  }
  campi.push(corrente.trim());
  return campi;
}
