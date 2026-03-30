import { getDistanceFromLatLonInKm, calcolaAngoloTraDuePunti } from './geoutils.js';
import { aggiornaUserMarker, aggiornaIndicatoreDirezione } from './mappaUI.js';

// Coordinate e heading correnti dell'utente, aggiornati ad ogni posizione GPS ricevuta
let userCoordinates = null;
let userHeading = 0;
// Flag che indica se il heading è stato calcolato geometricamente (stimato)
// o letto direttamente dal sensore del dispositivo (più preciso)
let isHeadingStimato = true;
// Ultima posizione nota, usata per calcolare il heading stimato per differenza
let lastUserCoordinates = null;

// Waypoint caricati da CSV per la modalità debug (simulazione percorso)
let csvWaypoints = [];
// Callback da invocare ad ogni aggiornamento di posizione
let debugCallback = null;
// Timer del loop di simulazione debug
let debugTimer = null;
// Fattore di accelerazione della simulazione: i timestamp del CSV vengono divisi per questo valore
const DEBUG_SPEED_MULTIPLIER = 10;

// Mappa dei codici autostrada italiani con i nomi ufficiali e alternativi.
// Usata per riconoscere se l'utente è su un'autostrada a partire dal nome
// restituito dal reverse geocoding (Nominatim può restituire nomi in varie forme).
const autostradeMap = {
  "A1": ["Milano Napoli", "Autostrada del Sole"],
  "A2": ["Salerno Reggio Calabria", "Autostrada del Mediterraneo"],
  "A3": ["Napoli Salerno"],
  "A4": ["Torino Trieste", "Serenissima"],
  "A5": ["Torino Aosta Monte Bianco"],
  "A6": ["Torino Savona"],
  "A7": ["Milano Genova", "Autostrada dei Giovi"],
  "A8": ["Milano Varese", "Autostrada dei Laghi"],
  "A9": ["Lainate Chiasso", "Autostrada dei Laghi"],
  "A10": ["Genova Ventimiglia", "Autostrada dei Fiori"],
  "A11": ["Firenze Pisa", "Firenze Mare"],
  "A12": ["Genova Roma", "Autostrada Tirrenica"],
  "A13": ["Bologna Padova"],
  "A14": ["Bologna Taranto", "Autostrada Adriatica"],
  "A15": ["Parma La Spezia", "Autostrada della Cisa"],
  "A16": ["Napoli Canosa", "Autostrada dei Due Mari"],
  "A17": ["Bari Napoli (storica)"],
  "A18": ["Messina Catania", "Siracusa Rosolini"],
  "A19": ["Palermo Catania"],
  "A20": ["Messina Palermo"],
  "A21": ["Torino Brescia", "Autostrada dei Vini"],
  "A22": ["Modena Brennero", "Autostrada del Brennero"],
  "A23": ["Palmanova Tarvisio"],
  "A24": ["Roma Teramo", "Autostrada dei Parchi"],
  "A25": ["Torano Pescara", "Autostrada dei Parchi"],
  "A26": ["Voltri Gravellona Toce", "Autostrada dei Trafori"],
  "A27": ["Mestre Belluno"],
  "A28": ["Portogruaro Conegliano"],
  "A29": ["Palermo Mazara del Vallo", "Autostrada del Sale"]
};

/**
 * Cerca se il nome di una strada (proveniente da reverse geocoding) corrisponde
 * a una delle autostrade note. Il confronto è case-insensitive e usa includes()
 * perché Nominatim può restituire nomi parziali o in ordine diverso.
 * @returns {string|null} Il codice autostrada (es. "A1") oppure null
 */
function trovaCodiceAutostrada(nomeStrada) {
  const normalized = nomeStrada.toLowerCase();
  for (const [codice, nomi] of Object.entries(autostradeMap)) {
    if (nomi.some(n => normalized.includes(n.toLowerCase()))) {
      return codice;
    }
  }
  return null;
}

export function getUserCoordinates() {
  return userCoordinates;
}

export function getUserHeading() {
  return userHeading;
}

/**
 * Reverse geocoding tramite Nominatim (OpenStreetMap).
 * Restituisce il nome della strada o, in mancanza, il display_name completo.
 * La Promise non rigetta mai: in caso di errore restituisce una stringa descrittiva,
 * così i chiamanti possono usare .then() senza dover gestire .catch().
 */
export function reverseGeocode(lat, lon) {
  return fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`)
    .then(response => response.json())
    .then(data => data.address?.road || data.display_name || "Strada non trovata")
    .catch(err => {
      console.warn("Reverse geocoding fallito:", err);
      return "Errore: " + (err?.message || err?.toString() || "sconosciuto");
    });
}

/**
 * Parser CSV che gestisce correttamente i campi tra virgolette (RFC 4180).
 * Necessario perché i nomi delle strade possono contenere virgole
 * (es. "Via Roma, 1") e un semplice split(',') spezzerebbe il campo.
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      // Toggle dello stato "dentro virgolette": il prossimo ',' non sarà separatore
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  // Ultimo campo (non seguito da ',')
  result.push(current.trim());
  return result;
}

/**
 * Carica un file CSV di waypoint per la modalità debug.
 * Il CSV deve avere almeno le colonne "Latitude" e "Longitude".
 * La colonna "Timestamp (CEST)" è opzionale: se assente, si assume un intervallo
 * fisso di 30 secondi tra i punti.
 *
 * Se il CSV è valido e debugCallback è già stato impostato (cioè initGeolocation
 * è già stato chiamato in modalità debug), avvia subito il loop di simulazione.
 * @returns {boolean} true se almeno un punto è stato caricato con successo
 */
export function caricaCSVDebug(testo) {
  const righe = testo.trim().split('\n');
  if (righe.length < 2) return false;

  const header = parseCSVLine(righe[0]);
  const iTs  = header.findIndex(h => h === 'Timestamp (CEST)');
  const iLat = header.findIndex(h => h === 'Latitude');
  const iLon = header.findIndex(h => h === 'Longitude');

  if (iLat === -1 || iLon === -1) {
    console.error('CSV: colonne Latitude/Longitude non trovate');
    return false;
  }

  csvWaypoints = [];
  for (let i = 1; i < righe.length; i++) {
    if (!righe[i].trim()) continue;
    const campi = parseCSVLine(righe[i]);
    const lat = parseFloat(campi[iLat]);
    const lon = parseFloat(campi[iLon]);
    if (isNaN(lat) || isNaN(lon)) continue;

    // Se il timestamp è disponibile, lo converte in millisecondi Unix.
    // La sostituzione di ' ' con 'T' rende il formato accettato da Date() su tutti i browser.
    const ts = iTs !== -1
      ? new Date(campi[iTs].replace(' ', 'T')).getTime()
      : i * 30000;
    csvWaypoints.push({ lat, lon, ts });
  }

  console.log(`📂 CSV caricato: ${csvWaypoints.length} punti`);
  if (csvWaypoints.length > 0 && debugCallback) {
    avviaDebugLoop(csvWaypoints, debugCallback);
  }
  return csvWaypoints.length > 0;
}

/**
 * Avvia il loop di simulazione GPS su un array di waypoint.
 * Ogni "passo" aggiorna la posizione dell'utente come se arrivasse dal GPS reale,
 * poi pianifica il passo successivo con un delay proporzionale al delta di
 * timestamp tra i punti (scalato da DEBUG_SPEED_MULTIPLIER).
 *
 * Il reverse geocoding viene eseguito al massimo ogni 10 secondi reali
 * o ogni 100 m percorsi, per non sovraccaricare le API di Nominatim.
 *
 * Il loop è circolare: arrivati all'ultimo waypoint, ricomincia dal primo.
 */
function avviaDebugLoop(punti, callback) {
  // Cancella un eventuale loop precedente prima di avviarne uno nuovo
  if (debugTimer) clearTimeout(debugTimer);

  let ultimaPosizioneReverse = null;
  let ultimoReverse = 0;

  function passo(index) {
    const { lat, lon } = punti[index];
    userCoordinates = { lat, lon };

    const coordsDiv = document.getElementById("coords");
    if (coordsDiv) coordsDiv.innerText = `Latitudine: ${lat}\nLongitudine: ${lon}`;

    // Throttling del reverse geocoding: si chiama solo se sono passati più di 10s
    // oppure se ci si è spostati di più di 100m dall'ultima chiamata.
    const ora = Date.now();
    const distanzaDaUltima = ultimaPosizioneReverse
      ? getDistanceFromLatLonInKm(ultimaPosizioneReverse.lat, ultimaPosizioneReverse.lon, lat, lon)
      : Infinity;
    const eseguiReverse = !ultimaPosizioneReverse || (ora - ultimoReverse > 10000) || distanzaDaUltima > 0.1;

    if (eseguiReverse) {
      ultimaPosizioneReverse = { lat, lon };
      ultimoReverse = ora;
      reverseGeocode(lat, lon).then(strada => {
        window.stradaUtenteReverse = strada;
        window.codiceAutostradaUtente = trovaCodiceAutostrada(strada);
        // true se l'utente è su un'autostrada riconosciuta
        window.modalitaAutostrada = !!window.codiceAutostradaUtente;
        const stradaDiv = document.getElementById("strada");
        if (stradaDiv) {
          if (window.codiceAutostradaUtente) {
            const nomi = autostradeMap[window.codiceAutostradaUtente].join(" / ");
            stradaDiv.innerText = `🛣️ ${window.codiceAutostradaUtente} – ${nomi}`;
          } else {
            stradaDiv.innerText = `🛣️ ${strada}`;
          }
        }
      });
    }

    updateHeading(lat, lon, null);
    aggiornaIndicatoreDirezione(userHeading, isHeadingStimato);
    aggiornaUserMarker(lat, lon, userHeading);
    callback(lat, lon);

    // Calcola il delay per il prossimo passo in base ai timestamp del CSV.
    // Il modulo (%) fa sì che dopo l'ultimo waypoint si torni al primo.
    const prossimo = (index + 1) % punti.length;
    const deltaTs = punti.length > 1
      ? Math.abs(punti[(index + 1) % punti.length].ts - punti[index].ts)
      : 30000;
    // Almeno 500ms anche se il CSV ha punti molto ravvicinati
    const delay = Math.max(deltaTs / DEBUG_SPEED_MULTIPLIER, 500);
    debugTimer = setTimeout(() => passo(prossimo), delay);
  }

  passo(0);
}

/**
 * Punto di ingresso per la geolocalizzazione.
 * - In modalità debug: simula il movimento su waypoint predefiniti o da CSV.
 * - In produzione: usa la Geolocation API del browser (watchPosition).
 *
 * @param {function} callback - Invocata con (lat, lon) ad ogni aggiornamento
 * @param {boolean} debug - Se true, usa la simulazione invece del GPS reale
 */
export function initGeolocation(callback, debug = false) {
  if (debug) {
    debugCallback = callback;
    // Percorso di default usato se non è stato caricato un CSV (zona Foggia-Incoronata)
    const defaultCoords = [
      { lat: 41.638756, lon: 15.453696, ts: 0 },
      { lat: 41.64647,  lon: 15.446288, ts: 30000 },
      { lat: 41.653435, lon: 15.437314, ts: 60000 },
      { lat: 41.660397, lon: 15.428341, ts: 90000 },
      { lat: 41.67748,  lon: 15.416491, ts: 120000 },
      { lat: 41.686028, lon: 15.411482, ts: 150000 },
      { lat: 41.693935, lon: 15.406848, ts: 180000 },
      { lat: 41.70322,  lon: 15.405508, ts: 210000 },
      { lat: 41.712616, lon: 15.40863,  ts: 240000 },
      { lat: 41.72199,  lon: 15.411748, ts: 270000 }
    ];
    const punti = csvWaypoints.length > 0 ? csvWaypoints : defaultCoords;
    avviaDebugLoop(punti, callback);

  } else if ("geolocation" in navigator) {
    let ultimaPosizioneReverse = null;
    let ultimoReverse = 0;

    navigator.geolocation.watchPosition(
      (position) => {
        // toFixed(6) + parseFloat elimina la precisione millimetrica superflua
        // che causerebbe aggiornamenti continui della UI senza valore reale
        const lat = parseFloat(position.coords.latitude.toFixed(6));
        const lon = parseFloat(position.coords.longitude.toFixed(6));
        const deviceHeading = position.coords.heading;

        userCoordinates = { lat, lon };
        const coordsDiv = document.getElementById("coords");
        if (coordsDiv) {
          coordsDiv.innerText = `Latitudine: ${lat}\nLongitudine: ${lon}`;
        }

        // Stesso throttling del loop debug: evita di bombardare Nominatim
        const ora = Date.now();
        const distanzaDaUltima = ultimaPosizioneReverse
          ? getDistanceFromLatLonInKm(ultimaPosizioneReverse.lat, ultimaPosizioneReverse.lon, lat, lon)
          : Infinity;
        const eseguiReverse = !ultimaPosizioneReverse || (ora - ultimoReverse > 10000) || distanzaDaUltima > 0.1;

        if (eseguiReverse) {
          ultimaPosizioneReverse = { lat, lon };
          ultimoReverse = ora;

          reverseGeocode(lat, lon).then(strada => {
            window.stradaUtenteReverse = strada;
            window.codiceAutostradaUtente = trovaCodiceAutostrada(strada);
            window.modalitaAutostrada = !!window.codiceAutostradaUtente;
            console.log("🛣️ Modalità autostrada:", window.modalitaAutostrada);
            const stradaDiv = document.getElementById("strada");
            if (stradaDiv) {
              stradaDiv.innerText = `🛣️ ${strada}`;
            }
            const autostradaDiv = document.getElementById("autostrada");
            if (autostradaDiv && window.codiceAutostradaUtente) {
              const nomi = autostradeMap[window.codiceAutostradaUtente].join(" / ");
              autostradaDiv.innerText = `🛣️ ${window.codiceAutostradaUtente} – ${nomi}`;
            }
          });
        }

        updateHeading(lat, lon, deviceHeading);
        aggiornaIndicatoreDirezione(userHeading, isHeadingStimato);
        aggiornaUserMarker(lat, lon, userHeading);
        callback(lat, lon);
      },
      (error) => {
        console.warn("Errore nella geolocalizzazione:", error);
      },
      {
        enableHighAccuracy: true, // Usa GPS hardware invece del Wi-Fi/IP
        timeout: 10000,           // Abbandona se non risponde entro 10s
        maximumAge: 0             // Non usare posizioni in cache: vuoi sempre dati freschi
      }
    );
  } else {
    console.warn("⚠️ Geolocalizzazione non supportata dal browser.");
  }
}

/**
 * Aggiorna il heading (direzione di marcia) dell'utente.
 *
 * Strategia a due livelli:
 * 1. Se il dispositivo fornisce un heading nativo (bussola/GPS), lo usa direttamente.
 * 2. Altrimenti, lo calcola geometricamente dalla differenza tra la posizione
 *    attuale e quella precedente — ma solo se ci si è spostati di almeno 10 metri,
 *    per evitare rumore da piccole oscillazioni GPS a veicolo fermo.
 *
 * Tricky: calcolaAngoloTraDuePunti restituisce un angolo cartesiano (0° = Est,
 * senso antiorario), quindi sottrae 90° per convertirlo in bearing geografico
 * (0° = Nord, senso orario), poi lo normalizza in [0, 360) con il modulo.
 */
function updateHeading(lat, lon, heading = null) {
  if (heading !== null && !isNaN(heading)) {
    // Heading nativo disponibile: usalo e memorizza la posizione per usi futuri
    userHeading = heading;
    lastUserCoordinates = { lat, lon };
    isHeadingStimato = false;
    return;
  }

  let angle = -90;
  let aggiorna = true;

  if (lastUserCoordinates) {
    const distanza = getDistanceFromLatLonInKm(lastUserCoordinates.lat, lastUserCoordinates.lon, lat, lon);
    if (distanza * 1000 < 10) {
      // Spostamento < 10m: non aggiornare per evitare heading instabile da rumore GPS
      aggiorna = false;
    } else {
      // Converte l'angolo cartesiano in bearing geografico
      angle = calcolaAngoloTraDuePunti(lastUserCoordinates.lat, lastUserCoordinates.lon, lat, lon) - 90;
    }
  }

  if (aggiorna) {
    // +90 e % 360 normalizzano il risultato nell'intervallo [0, 360)
    userHeading = (angle + 90 + 360) % 360;
    lastUserCoordinates = { lat, lon };
    isHeadingStimato = true;
  }
}

/**
 * Restituisce la posizione GPS corrente dell'utente.
 * Se le coordinate non sono ancora disponibili (primo avvio), attende
 * in polling ogni 200ms fino a quando non vengono popolate da watchPosition
 * o dal loop di debug. Utile per i moduli che hanno bisogno della posizione
 * una tantum senza dover sottoscrivere il callback continuo.
 */
export async function getUserPosition() {
    console.log("getUserPosition");
  if (userCoordinates) return userCoordinates;

  return new Promise(resolve => {
    const check = () => {
      if (userCoordinates) {
        resolve(userCoordinates);
      } else {
        setTimeout(check, 200);
      }
    };
    check();
  });
}
