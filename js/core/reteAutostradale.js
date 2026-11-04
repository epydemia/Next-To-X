import { differenzaAngolare } from './geo.js';
import { codiceDaNomeStrada } from './autostrade.js';
import { CARTELLA_DATI, FILE_AUTOSTRADE, AUTOSTRADA_DISTANZA_MAX_M, AUTOSTRADA_ANGOLO_MAX } from '../config.js';

// Riconoscimento locale dell'autostrada: la posizione viene confrontata con il tracciato
// scaricato da OpenStreetMap (data/autostrade.json, generato da tools/Download_OSM_Autostrade.py,
// formato descritto in cima a quello script), senza chiamate di rete durante la guida.

const SCALA = 100_000;
const CELLA_GRADI = 0.01;  // griglia dell'indice spaziale (~1 km)
const M_PER_GRADO_LAT = 110540;
const M_PER_GRADO_LON_EQUATORE = 111320;

let strade = [];
// "riga,colonna" → segmenti che attraversano la cella: [strada, sensoUnico, lat1, lon1, lat2, lon2]
const griglia = new Map();
// Indice di strada → tracciati della stessa autostrada, per evidenziarla sulla mappa
const tracciati = new Map();
let caricamento = null;

const cella = (lat, lon) => `${Math.floor(lat / CELLA_GRADI)},${Math.floor(lon / CELLA_GRADI)}`;

/** Scarica e indicizza la rete; le chiamate successive riusano lo stesso caricamento. */
export function caricaReteAutostradale() {
  caricamento ??= fetch(CARTELLA_DATI + FILE_AUTOSTRADE)
    .then(res => {
      if (!res.ok) throw new Error(`${FILE_AUTOSTRADE}: HTTP ${res.status}`);
      return res.json();
    })
    .then(dati => {
      strade = dati.strade;
      dati.linee.forEach(indicizzaLinea);
      raggruppaTracciati(dati.linee);
    });
  return caricamento;
}

function indicizzaLinea([strada, sensoUnico, lat0, lon0, ...differenze]) {
  let lat = lat0 / SCALA, lon = lon0 / SCALA;
  for (let i = 0; i < differenze.length; i += 2) {
    const lat2 = lat + differenze[i] / SCALA, lon2 = lon + differenze[i + 1] / SCALA;
    const segmento = [strada, sensoUnico, lat, lon, lat2, lon2];
    // Il segmento va in tutte le celle del suo rettangolo: i tratti dritti semplificati sono lunghi
    for (let r = Math.floor(Math.min(lat, lat2) / CELLA_GRADI); r <= Math.floor(Math.max(lat, lat2) / CELLA_GRADI); r++) {
      for (let c = Math.floor(Math.min(lon, lon2) / CELLA_GRADI); c <= Math.floor(Math.max(lon, lon2) / CELLA_GRADI); c++) {
        const chiave = `${r},${c}`;
        if (!griglia.has(chiave)) griglia.set(chiave, []);
        griglia.get(chiave).push(segmento);
      }
    }
    lat = lat2;
    lon = lon2;
  }
}

// Le strade con lo stesso paese e la stessa sigla sono un'unica autostrada: in OSM l'A1, per
// esempio, è spezzata in più tratte con nomi diversi. Alcune tratte non hanno la sigla ma solo
// il nome (l'A14 tra Castel San Pietro e Imola è solo "Autostrada Adriatica"): la sigla si
// ricava da un'altra tratta con lo stesso nome o, in Italia, dalla tabella delle autostrade.
function raggruppaTracciati(linee) {
  const siglaPerNome = new Map();
  strade.forEach(({ paese, codice, nome }) => {
    if (codice && nome && !siglaPerNome.has(`${paese}|${nome}`)) siglaPerNome.set(`${paese}|${nome}`, codice);
  });
  const chiave = ({ paese, codice, nome }) => {
    const sigla = codice || siglaPerNome.get(`${paese}|${nome}`) || (paese === 'IT' ? codiceDaNomeStrada(nome) : null);
    return `${paese}|${sigla || 'nome:' + nome}`;
  };
  const perChiave = new Map();
  for (const [strada, , lat0, lon0, ...differenze] of linee) {
    const punti = [[lat0 / SCALA, lon0 / SCALA]];
    for (let i = 0; i < differenze.length; i += 2) {
      const [lat, lon] = punti[punti.length - 1];
      punti.push([lat + differenze[i] / SCALA, lon + differenze[i + 1] / SCALA]);
    }
    const k = chiave(strade[strada]);
    if (!perChiave.has(k)) perChiave.set(k, []);
    perChiave.get(k).push(punti);
  }
  strade.forEach((s, i) => tracciati.set(i, perChiave.get(chiave(s)) ?? []));
}

/** Tracciati (liste di [lat, lon]) dell'autostrada a cui appartiene la strada indicata. */
export function tracciatoAutostrada(indice) {
  return tracciati.get(indice) ?? [];
}

/**
 * Autostrada su cui si trova il punto: { paese, codice, nome, indice, distanzaM }, oppure null
 * (fuori autostrada o rete non ancora caricata). Con heading noto si scartano le carreggiate
 * percorse nel verso opposto e le strade che incrociano: evita di agganciare un'altra
 * autostrada a uno svincolo o la carreggiata opposta.
 */
export function autostradaInPosizione(lat, lon, heading) {
  const [r, c] = cella(lat, lon).split(',').map(Number);
  const mPerGradoLon = M_PER_GRADO_LON_EQUATORE * Math.cos(lat * Math.PI / 180);
  let migliore = null;

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      for (const [strada, sensoUnico, lat1, lon1, lat2, lon2] of griglia.get(`${r + dr},${c + dc}`) ?? []) {
        // Piano locale in metri con origine nel punto
        const ax = (lon1 - lon) * mPerGradoLon, ay = (lat1 - lat) * M_PER_GRADO_LAT;
        const bx = (lon2 - lon) * mPerGradoLon, by = (lat2 - lat) * M_PER_GRADO_LAT;
        const dx = bx - ax, dy = by - ay;
        const lunghezza2 = dx * dx + dy * dy;
        const t = lunghezza2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lunghezza2)) : 0;
        const distanzaM = Math.hypot(ax + t * dx, ay + t * dy);
        if (distanzaM > AUTOSTRADA_DISTANZA_MAX_M || (migliore && distanzaM >= migliore.distanzaM)) continue;

        if (heading != null && lunghezza2) {
          const direzione = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
          const scarto = Math.abs(differenzaAngolare(direzione, heading));
          if ((sensoUnico ? scarto : Math.min(scarto, 180 - scarto)) > AUTOSTRADA_ANGOLO_MAX) continue;
        }
        migliore = { ...strade[strada], indice: strada, distanzaM };
      }
    }
  }
  return migliore;
}
