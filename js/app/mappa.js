import { TILE_GUIDA, CENTRO_ITALIA, ZOOM_GUIDA } from '../config.js';
import { creaSfondo, preparaAttribuzioni } from '../sfondi.js';
import { tracciatoAutostrada } from '../core/reteAutostradale.js';

let map = null;
let markerUtente = null;
let posizioneUtente = null;
const livelloStazioni = L.layerGroup();
const livelloAutostrada = L.layerGroup();
let autostradaEvidenziata = null;

export function creaMappa(idElemento) {
  map = L.map(idElemento).setView([CENTRO_ITALIA.lat, CENTRO_ITALIA.lon], ZOOM_GUIDA);
  // Prima di aggiungere livelli: spostare il controllo lo ricrea e conterebbe due volte i
  // crediti già presenti, che poi non si potrebbero più sostituire
  compattaAttribuzioni();
  creaSfondo(TILE_GUIDA).addTo(map);
  preparaAttribuzioni(map);
  livelloAutostrada.addTo(map);
  livelloStazioni.addTo(map);

  // Dopo uno zoom Leaflet può spostare la vista: la ricentriamo sull'utente
  map.on('zoomend', () => {
    if (posizioneUtente) map.setView([posizioneUtente.lat, posizioneUtente.lon], map.getZoom());
  });
}

/**
 * Crediti in una riga in fondo, sotto il pannello della prossima stazione: sui telefoni
 * stretti il testo completo andava su più righe e copriva il nome della stazione. Quello che
 * non ci sta finisce con "…" e un tocco mostra tutto (i link restano cliccabili).
 */
function compattaAttribuzioni() {
  const crediti = map.attributionControl;
  crediti.setPosition('bottomleft');
  const elemento = crediti.getContainer();
  elemento.title = 'Crediti della mappa';
  elemento.addEventListener('click', e => {
    if (e.target.closest('a')) return;
    elemento.classList.toggle('aperta');
  });
}

/** Da chiamare quando cambia lo spazio della mappa (es. la barra distanze si sposta). */
export function aggiornaDimensioniMappa() {
  map?.invalidateSize();
}

export function mostraPanoramicaItalia() {
  map.setView([CENTRO_ITALIA.lat, CENTRO_ITALIA.lon], 6);
}

/** Sposta il marker utente, ruota la freccia secondo l'heading e centra la mappa. */
export function aggiornaUtente({ lat, lon }, heading) {
  // Se la mappa è ancora sulla panoramica (es. GPS arrivato in ritardo) torna allo zoom di guida
  const zoom = posizioneUtente ? map.getZoom() : ZOOM_GUIDA;
  posizioneUtente = { lat, lon };

  if (!markerUtente) {
    const icon = L.divIcon({
      className: 'user-heading-icon',
      html: '<div class="marker-blu"><span class="freccia"><svg viewBox="0 0 24 24"><polygon points="12,0 22,24 2,24" /></svg></span></div>',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
    markerUtente = L.marker([lat, lon], { icon }).addTo(map);
  } else {
    markerUtente.setLatLng([lat, lon]);
  }

  const freccia = markerUtente.getElement()?.querySelector('.freccia');
  if (freccia) freccia.style.transform = `rotate(${heading}deg)`;

  map.setView([lat, lon], zoom);
}

/**
 * Evidenzia l'autostrada percorsa (indice della strada nel tracciato locale, null per
 * nessuna). Si ridisegna solo quando l'autostrada cambia.
 */
export function evidenziaAutostrada(indice) {
  if (indice === autostradaEvidenziata) return;
  autostradaEvidenziata = indice;
  livelloAutostrada.clearLayers();
  if (indice == null) return;
  const tracciati = tracciatoAutostrada(indice);
  // Alone largo e linea sottile sopra: si vede sia sullo sfondo scuro sia sulle altre strade
  L.polyline(tracciati, { color: '#3b9eff', weight: 12, opacity: 0.25, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(livelloAutostrada);
  L.polyline(tracciati, { color: '#3b9eff', weight: 4, opacity: 0.9, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(livelloAutostrada);
}

export function disegnaStazioni(stazioni) {
  livelloStazioni.clearLayers();
  stazioni.forEach(s => {
    const [classe, lato] = stileMarker(s);
    const icon = L.divIcon({
      className: 'custom-marker',
      html: `<div class="${classe}"></div>`,
      iconSize: [lato, lato],
      iconAnchor: [lato / 2, lato / 2],
    });
    L.marker([s.lat, s.lon], { icon }).bindPopup(testoPopup(s)).addTo(livelloStazioni);
  });
}

function stileMarker(s) {
  if (s.isNearest) return [s.exitRequired ? 'marker-uscita-prossima' : 'marker-prossima', 20];
  if (s.isAvanti)  return [s.exitRequired ? 'marker-uscita' : 'marker-rosso', 14];
  return ['marker-grigio', 14];
}

function testoPopup(s) {
  const uscita = s.exitRequired ? '<br>⚠️ Richiede uscita dal casello' : '';
  const intestazione = s.isNearest ? '<strong>⚡ PROSSIMA COLONNINA</strong><br>' : '';
  const direzione = s.isNearest && s.direzione ? `<br>→ ${s.direzione}` : '';
  const operatore = s.operatore ? `<br>🔌 ${s.operatore}` : '';
  return `${intestazione}<strong>${s.nome}</strong><br>${s.strada}${direzione}${operatore}<br>${s.distanza.toFixed(1)} km${uscita}`;
}
