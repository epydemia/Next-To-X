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

    // leaflet-rotate applica rotate(X deg) CW al tilePane.
    // setBearing(X) → tile pane ruota CW di X° → la direzione (360-X)° appare in alto.
    // Per avere heading in alto: (360 - heading) % 360.
    //
    // Il markerPane è in norotatePane: NON eredita la rotazione CSS.
    // La freccia punta nella direzione di marcia in coord. schermo:
    //   - nord in alto:  rotate(heading deg)
    //   - rotta in alto: rotate(0deg)  ← heading è già "su"
    const arrow = userMarker._icon?.querySelector('.freccia');
    if (mapRotationMode === 'heading') {
      window.leafletMap.setBearing((360 - heading % 360) % 360);
      if (arrow) arrow.style.transform = 'rotate(0deg)';
    } else {
      window.leafletMap.setBearing(0);
      if (arrow) arrow.style.transform = `rotate(${heading}deg)`;
    }
  }
}

export function aggiornaIndicatoreDirezione(heading, isStimato) {
  const direzioneDiv = document.getElementById("direzione");
  if (direzioneDiv) {
    direzioneDiv.innerText = `🧭 ${heading.toFixed(0)}°${isStimato ? '*' : ''} (${getDirezioneUtente(heading)})`;
  }
}