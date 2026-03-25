import { aggiornaUserMarker, getMapRotationMode, setMapRotationMode } from './mappaUI.js';
import { getAree } from './dataloader.js';
import { getUserCoordinates, getUserHeading, getUserPosition, initGeolocation } from './geolocalizzazione.js';
import { initColonnine, updateColonnine, setColonnineData } from './colonnine.js';

let map;

window.addEventListener("load", async () => {
  const aree = await getAree();
  setColonnineData(aree);

  const debugEnabled = localStorage.getItem('debugPosizione') === '1';
  document.querySelector('#toggleDebug').checked = debugEnabled;

  // Inizializza mappa se necessario
  if (window.leafletMap) {
    console.warn("⚠️ La mappa è già stata inizializzata. Salto la creazione.");
    map = window.leafletMap;
  } else {
    console.log("🗺️ Inizializzo Leaflet map...");
    map = L.map('map', { rotate: true, bearing: 0 }).setView([41.9, 12.5], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    window.leafletMap = map;
    console.log("✅ Mappa inizializzata");

    // Controllo modalità rotazione mappa
    const RotationControl = L.Control.extend({
      onAdd() {
        const btn = L.DomUtil.create('button', 'map-rotation-btn');
        const update = () => {
          const mode = getMapRotationMode();
          btn.textContent = mode === 'heading' ? '↑ Rotta' : '↑ Nord';
          btn.title = mode === 'heading' ? 'Passa a Nord in alto' : 'Passa a Direzione in alto';
          btn.classList.toggle('active', mode === 'heading');
        };
        update();
        L.DomEvent.on(btn, 'click', (e) => {
          L.DomEvent.stopPropagation(e);
          setMapRotationMode(getMapRotationMode() === 'heading' ? 'north' : 'heading');
          update();
          // Riesegui rotazione immediatamente con l'heading corrente
          const heading = getUserHeading();
          const coords = getUserCoordinates();
          if (coords) aggiornaUserMarker(coords.lat, coords.lon, heading);
        });
        return btn;
      }
    });
    new RotationControl({ position: 'topleft' }).addTo(map);

    // Listener per moveend e zoomend per aggiornare il marker utente
    map.on("zoomend", () => {
      const coords = getUserCoordinates();
      const heading = getUserHeading();
      if (coords && heading !== null) {
        map.setView([coords.lat, coords.lon], map.getZoom());
        aggiornaUserMarker(coords.lat, coords.lon, heading);
      }
    });
  }

  // Avvia geolocalizzazione e callback
  const debug = debugEnabled;
  initGeolocation((lat, lon) => {
    const heading = getUserHeading();
    if (lat != null && lon != null) {
      map.setView([lat, lon], map.getZoom());  // 💡 centramento iniziale
      aggiornaUserMarker(lat, lon, heading);
        console.log("updateColonnine", lat, lon);
      updateColonnine(map, aree, lat, lon, heading);
    }
  }, debug);
  const coords = await getUserPosition();
if (coords) {
    console.log("initColonnine", coords.lat, coords.lon);
  initColonnine(map, aree, coords);
}

  document.querySelector('#toggleNearest')?.addEventListener('change', async () => {
    const coords = getUserCoordinates();
    const heading = getUserHeading();
    if (coords) {
      updateColonnine(map, aree, coords.lat, coords.lon, heading);
    }
  });

  document.querySelector('#toggleDebug')?.addEventListener('change', (e) => {
    localStorage.setItem('debugPosizione', e.target.checked ? '1' : '0');
    window.location.reload();
  });

  // Event listener per il pannello delle opzioni
  document.querySelector('#options-toggle')?.addEventListener('click', () => {
    document.getElementById('options-panel')?.classList.toggle('open');
  });
});