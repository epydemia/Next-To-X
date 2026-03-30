import { getDirezioneUtente } from './geoutils.js';

// Riferimento al marker Leaflet dell'utente; null finché non viene creato la prima volta
export let userMarker = null;

// Modalità di rotazione della mappa, persistita in localStorage tra le sessioni
let mapRotationMode = localStorage.getItem('mapRotationMode') || 'north'; // 'north' | 'heading'

export function getMapRotationMode() {
  return mapRotationMode;
}

export function setMapRotationMode(mode) {
  mapRotationMode = mode;
  localStorage.setItem('mapRotationMode', mode);
}

/**
 * Aggiorna la posizione e l'orientamento del marker utente sulla mappa.
 * Crea il marker al primo invocazione, poi si limita a spostarlo.
 *
 * Gestione della rotazione (tricky — interazione con leaflet-rotate):
 *
 * Il plugin leaflet-rotate applica un `rotate(X deg)` CSS al tilePane tramite
 * `map.setBearing(X)`. Quando il bearing è X°, il tile ruota in senso orario
 * di X° → la direzione (360-X)° appare in alto allo schermo.
 * Per avere l'heading dell'utente in alto: bearing = (360 - heading) % 360.
 *
 * Il markerPane è in `norotatePane` e NON eredita la rotazione CSS della mappa.
 * Quindi la freccia va ruotata manualmente:
 *   - Modalità "heading in alto": la mappa ruota per allineare la rotta verso
 *     l'alto, quindi la freccia punta già "su" → rotate(0deg).
 *   - Modalità "Nord in alto": la mappa non ruota, la freccia deve puntare
 *     nella direzione di marcia rispetto allo schermo → rotate(heading deg).
 */
export function aggiornaUserMarker(lat, lon, heading) {
  if (window.leafletMap) {
    if (!userMarker) {
      // Creazione iniziale del marker con icona SVG personalizzata (freccia direzionale)
      const icon = L.divIcon({
        className: 'user-heading-icon',
        html: `
          <div class="marker-blu">
            <span class="freccia">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <polygon points="12,0 22,24 2,24" />
              </svg>
            </span>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });
      userMarker = L.marker([lat, lon], { icon }).addTo(window.leafletMap);
    } else {
      userMarker.setLatLng([lat, lon]);
    }

    const arrow = userMarker._icon?.querySelector('.freccia');
    if (mapRotationMode === 'heading') {
      // Ruota la mappa in modo che l'heading sia in alto; freccia punta "su" (0°)
      window.leafletMap.setBearing((360 - heading % 360) % 360);
      if (arrow) arrow.style.transform = 'rotate(0deg)';
    } else {
      // Mappa orientata a Nord; freccia ruotata di heading° per indicare la direzione
      window.leafletMap.setBearing(0);
      if (arrow) arrow.style.transform = `rotate(${heading}deg)`;
    }
  }
}

/**
 * Aggiorna il div #direzione con il valore numerico dell'heading e la direzione
 * cardinale corrispondente. L'asterisco (*) indica che il heading è stimato
 * geometricamente (non proveniente dal sensore hardware del dispositivo).
 */
export function aggiornaIndicatoreDirezione(heading, isStimato) {
  const direzioneDiv = document.getElementById("direzione");
  if (direzioneDiv) {
    direzioneDiv.innerText = `🧭 ${heading.toFixed(0)}°${isStimato ? '*' : ''} (${getDirezioneUtente(heading)})`;
  }
}
