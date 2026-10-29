import { caricaAree } from '../core/dati.js';
import { filtraStazioni, tutteLeStazioni } from '../core/filtroStazioni.js';
import { avviaPosizione, attendiPrimaPosizione, getStato } from './posizione.js';
import { caricaTracciaCSV } from './simulazione.js';
import { creaMappa, aggiornaUtente, disegnaStazioni, mostraPanoramicaItalia } from './mappa.js';
import { collegaPannelli, mostraStrada, mostraDirezione, mostraAvvisoGps, aggiornaPannelli } from './hud.js';
import { ATTESA_GPS_MS, CENTRO_ITALIA } from '../config.js';

const CHIAVE_SIMULAZIONE = 'debugPosizione';

let aree = [];
let mostraTutte = false;

function aggiorna(stato) {
  if (!stato.coords) return;
  aggiornaUtente(stato.coords, stato.heading);
  mostraStrada(stato);
  mostraDirezione(stato);

  const { heading, strada, codiceAutostrada } = stato;
  const stazioni = filtraStazioni(aree, { ...stato.coords, heading, strada, codiceAutostrada, mostraTutte });
  disegnaStazioni(stazioni);
  aggiornaPannelli(stazioni);
}

function collegaImpostazioni(simulazione) {
  const toggleSimulazione = document.getElementById('toggleDebug');
  toggleSimulazione.checked = simulazione;
  // Cambiare sorgente di posizione richiede di reinizializzare tutto: si ricarica la pagina
  toggleSimulazione.addEventListener('change', e => {
    localStorage.setItem(CHIAVE_SIMULAZIONE, e.target.checked ? '1' : '0');
    location.reload();
  });

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

  aree = await caricaAree();
  avviaPosizione({ simulazione, onAggiornamento: aggiorna });

  if (!(await attendiPrimaPosizione(ATTESA_GPS_MS))) {
    mostraAvvisoGps();
    mostraPanoramicaItalia();
    const stazioni = tutteLeStazioni(aree, CENTRO_ITALIA);
    disegnaStazioni(stazioni);
    aggiornaPannelli(stazioni);
  }
});
