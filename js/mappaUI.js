import { getDirezioneUtente } from './geoutils.js';

export let userMarker = null;

// Rotazione accumulata della mappa (evita il salto 359°→0°)
let currentMapRotation = 0;
let mapRotationMode = localStorage.getItem('mapRotationMode') || 'north'; // 'north' | 'heading'

export function getMapRotationMode() {
  return mapRotationMode;
}

export function setMapRotationMode(mode) {
  mapRotationMode = mode;
  localStorage.setItem('mapRotationMode', mode);
}

// Applica la rotazione CSS alla mappa percorrendo sempre il cammino più corto
function applyMapRotation(heading) {
  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  const target = mapRotationMode === 'heading' ? -heading : 0;
  const delta = ((target - currentMapRotation + 540) % 360) - 180;
  currentMapRotation += delta;
  mapEl.style.transform = `rotate(${currentMapRotation}deg)`;
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

    const arrow = userMarker._icon?.querySelector('.freccia');
    if (arrow) {
      arrow.style.transform = `rotate(${heading}deg)`;
    }

    applyMapRotation(heading);
  }
}

export function aggiornaIndicatoreDirezione(heading, isStimato) {
  const direzioneDiv = document.getElementById("direzione");
  if (direzioneDiv) {
    direzioneDiv.innerText = `🧭 ${heading.toFixed(0)}°${isStimato ? '*' : ''} (${getDirezioneUtente(heading)})`;
  }
}