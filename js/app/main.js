import { caricaAree } from '../core/dati.js';
import { filtraStazioni, tutteLeStazioni } from '../core/filtroStazioni.js';
import { avviaPosizione, attendiPrimaPosizione, getStato } from './posizione.js';
import { caricaTracciaCSV } from './simulazione.js';
import { creaMappa, aggiornaUtente, disegnaStazioni, mostraPanoramicaItalia, aggiornaDimensioniMappa } from './mappa.js';
import {
  collegaPannelli, collegaOrientamentoBarra, mostraStrada, mostraDirezione, mostraAvvisoGps, aggiornaPannelli,
} from './hud.js';
import { ATTESA_GPS_MS, CENTRO_ITALIA } from '../config.js';
import {
  contaPagina, contaEvento, slugOperatori, statisticheAttive, impostaStatistiche, segnaSimulazione,
} from '../statistiche.js';

const CHIAVE_SIMULAZIONE = 'debugPosizione';

let aree = [];
let mostraTutte = false;

// Stazioni già conteggiate come "prossima" in questa visita: ognuna una volta sola
const prossimeContate = new Set();

function contaProssima(s) {
  const chiave = `${s.nome}|${s.lat}|${s.lon}`;
  if (prossimeContate.has(chiave)) return;
  prossimeContate.add(chiave);
  contaEvento(`prossima/${s.paese}/${slugOperatori(s.operatore)}`, `Prossima stazione: ${s.operatore || 'operatore sconosciuto'} (${s.paese})`, { guida: true });
}

function aggiorna(stato) {
  if (!stato.coords) return;
  aggiornaUtente(stato.coords, stato.heading);
  mostraStrada(stato);
  mostraDirezione(stato);

  const { heading, strada, codiceAutostrada, paese } = stato;
  const stazioni = filtraStazioni(aree, { ...stato.coords, heading, strada, codiceAutostrada, paese, mostraTutte });
  disegnaStazioni(stazioni);
  aggiornaPannelli(stazioni);
  const prossima = stazioni.find(s => s.isNearest);
  if (prossima) contaProssima(prossima);
}

function collegaImpostazioni(simulazione) {
  const toggleSimulazione = document.getElementById('toggleDebug');
  toggleSimulazione.checked = simulazione;
  // Cambiare sorgente di posizione richiede di reinizializzare tutto: si ricarica la pagina
  toggleSimulazione.addEventListener('change', e => {
    localStorage.setItem(CHIAVE_SIMULAZIONE, e.target.checked ? '1' : '0');
    location.reload();
  });

  const toggleStatistiche = document.getElementById('toggleStatistiche');
  toggleStatistiche.checked = statisticheAttive();
  toggleStatistiche.addEventListener('change', e => impostaStatistiche(e.target.checked));

  document.getElementById('toggleNearest').addEventListener('change', e => {
    mostraTutte = e.target.checked;
    aggiorna(getStato());
  });

  document.getElementById('csv-debug-section').hidden = !simulazione;
  document.getElementById('csvInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const punti = caricaTracciaCSV(await file.text());
    document.getElementById('csvStatus').textContent =
      punti ? `✅ ${file.name} (${punti} punti)` : '❌ Formato non valido';
  });
}

window.addEventListener('load', async () => {
  const simulazione = localStorage.getItem(CHIAVE_SIMULAZIONE) === '1';

  // I controlli vanno collegati prima di ogni await, così rispondono anche senza GPS
  collegaPannelli();
  collegaImpostazioni(simulazione);
  creaMappa('map');
  segnaSimulazione(simulazione);
  contaPagina('/app', 'App di guida');
  collegaOrientamentoBarra(aggiornaDimensioniMappa);

  aree = await caricaAree();
  avviaPosizione({ simulazione, onAggiornamento: aggiorna });

  const posizione = await attendiPrimaPosizione(ATTESA_GPS_MS);
  contaEvento(simulazione ? 'avvio/simulazione' : posizione ? 'avvio/gps' : 'avvio/gps-non-disponibile');
  if (!posizione) {
    mostraAvvisoGps();
    mostraPanoramicaItalia();
    const stazioni = tutteLeStazioni(aree, CENTRO_ITALIA);
    disegnaStazioni(stazioni);
    aggiornaPannelli(stazioni);
  }
});
