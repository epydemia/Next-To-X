import { getDirezioneUtente } from './geoutils.js';

export let userMarker = null;

let mapRotationMode = localStorage.getItem('mapRotationMode') || 'north'; // 'north' | 'heading'

export function getMapRotationMode() {
  return mapRotationMode;
}

export function setMapRotationMode(mode) {
  mapRotationMode = mode;
  localStorage.setItem('mapRotationMode', mode);
}

export function aggiornaUserMarker(lat, lon, heading) {
  if (window.leafletMap) {
    if (!userMarker) {
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

    // Il plugin leaflet-rotate ruota internamente le tile e il marker pane.
    // La freccia deve compensare: ruota di (heading - bearing) per puntare
    // nella direzione di marcia. In modalità "heading" bearing = heading → 0°
    // (freccia sempre su). In "north" bearing = 0 → heading gradi (normale).
    const bearing = mapRotationMode === 'heading' ? heading : 0;
    window.leafletMap.setBearing(bearing);

    const arrow = userMarker._icon?.querySelector('.freccia');
    if (arrow) {
      arrow.style.transform = `rotate(${heading - bearing}deg)`;
    }
  }
}

export function aggiornaIndicatoreDirezione(heading, isStimato) {
  const direzioneDiv = document.getElementById("direzione");
  if (direzioneDiv) {
    direzioneDiv.innerText = `🧭 ${heading.toFixed(0)}°${isStimato ? '*' : ''} (${getDirezioneUtente(heading)})`;
  }
}