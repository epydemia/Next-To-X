import { ATTRIBUZIONE_OSM } from './config.js';

/**
 * Livello di sfondo Esri con l'attribuzione completa dei fornitori. Il testo viene letto
 * dal servizio (copyrightText) perché Esri lo aggiorna; fino ad allora, o se la lettura
 * fallisce, vale quello di riserva in config.
 */
export function creaSfondo(tile) {
  const livello = L.tileLayer(`${tile.servizio}/tile/{z}/{y}/{x}`, { ...tile.options, attribution: tile.attribuzione });

  fetch(`${tile.servizio}?f=json`)
    .then(res => (res.ok ? res.json() : null))
    .then(info => {
      const testo = info?.copyrightText?.trim();
      if (testo) cambiaAttribuzione(livello, `Tiles &copy; Esri &mdash; ${testoSicuro(testo)}`);
    })
    .catch(() => {});

  return livello;
}

/** Attribuzione dei dati OpenStreetMap, una volta per mappa. */
export function aggiungiAttribuzioneOsm(map) {
  map.attributionControl.addAttribution(ATTRIBUZIONE_OSM);
}

function cambiaAttribuzione(livello, nuova) {
  const mappa = livello._map;
  if (mappa) mappa.attributionControl.removeAttribution(livello.options.attribution);
  livello.options.attribution = nuova;
  if (mappa) mappa.attributionControl.addAttribution(nuova);
}

// Il testo arriva da un servizio esterno e Leaflet lo inserisce come HTML
function testoSicuro(testo) {
  const div = document.createElement('div');
  div.textContent = testo;
  return div.innerHTML;
}
