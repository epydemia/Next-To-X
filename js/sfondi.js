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

/** Attribuzioni di una mappa: il link a Leaflet (senza la bandiera che Leaflet aggiunge di
 *  default dalla versione 1.8) e i dati OpenStreetMap. Una volta per mappa. */
export function preparaAttribuzioni(map) {
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
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
