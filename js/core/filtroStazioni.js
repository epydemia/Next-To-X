import { distanzaKm, isDavanti, stessaDirezione } from './geo.js';
import { estraiCodice } from './autostrade.js';
import { nomeStrada } from './dati.js';
import { RAGGIO_STAZIONI_KM } from '../config.js';

/**
 * Stazione pronta per la UI:
 * { nome, strada, direzione, operatore, lat, lon, distanza, colonnine, exitRequired,
 *   isAvanti: raggiungibile proseguendo sulla strada attuale,
 *   isNearest: la più vicina tra quelle avanti }
 */
function versoStazione(area, lat, lon) {
  return {
    nome: area.nome,
    strada: nomeStrada(area) || area.indirizzo || 'Strada sconosciuta',
    direzione: area.destinazione ?? '',
    operatore: (area.operatori ?? []).join(', '),
    lat: area.lat,
    lon: area.lon,
    distanza: distanzaKm(lat, lon, area.lat, area.lon),
    colonnine: area.colonnine ?? [],
    // Fuori dal casello (o fuori autostrada) si raggiunge da entrambe le direzioni
    exitRequired: area.accesso !== 'area_servizio',
    isAvanti: false,
    isNearest: false,
  };
}

/** Tutte le stazioni ordinate per distanza, senza alcun filtro (es. GPS non disponibile). */
export function tutteLeStazioni(aree, { lat, lon }) {
  return aree.map(a => versoStazione(a, lat, lon)).sort((a, b) => a.distanza - b.distanza);
}

/**
 * Stazioni entro RAGGIO_STAZIONI_KM ordinate per distanza, con isAvanti calcolato da:
 * 1. strada compatibile: codice autostrada (es. "A14") se noto, altrimenti
 *    confronto testuale col nome restituito dal reverse geocoding;
 * 2. stessa carreggiata (salvo stazioni fuori dal casello, raggiungibili da entrambe);
 * 3. stazione davanti rispetto all'heading, non già superata.
 * Con mostraTutte nessun filtro viene applicato e tutte risultano "avanti".
 */
export function filtraStazioni(aree, { lat, lon, heading, strada, codiceAutostrada, paese, mostraTutte }) {
  const stradaUtente = normalizza(strada);

  const stazioni = aree
    .map(area => {
      const stazione = versoStazione(area, lat, lon);
      if (!mostraTutte && stazione.distanza > RAGGIO_STAZIONI_KM) return null;

      stazione.isAvanti = mostraTutte || (
        stradaCompatibile(area, codiceAutostrada, stradaUtente, paese) &&
        (stazione.exitRequired || heading == null || stessaDirezione(area.carreggiata, heading)) &&
        (heading == null || isDavanti(lat, lon, heading, area.lat, area.lon))
      );
      return stazione;
    })
    .filter(Boolean)
    .sort((a, b) => a.distanza - b.distanza);

  const prossima = stazioni.find(s => s.isAvanti);
  if (prossima) prossima.isNearest = true;
  return stazioni;
}

function stradaCompatibile(area, codiceAutostrada, stradaUtente, paese) {
  // La stessa sigla indica strade diverse in paesi diversi (A5 in Germania e in Svizzera)
  if (paese && area.paese !== paese) return false;
  if (codiceAutostrada) return estraiCodice(area.autostrada) === codiceAutostrada;
  const stradaArea = normalizza(area.indirizzo);
  if (!stradaUtente || !stradaArea) return false;
  return stradaArea.includes(stradaUtente) || stradaUtente.includes(stradaArea);
}

function normalizza(s) {
  return s?.toLowerCase().trim() ?? '';
}
