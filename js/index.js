import { aggiornaUserMarker, getMapRotationMode, setMapRotationMode } from './mappaUI.js';
import { getAree } from './dataloader.js';
import { getUserCoordinates, getUserHeading, getUserPosition, initGeolocation, caricaCSVDebug } from './geolocalizzazione.js';
import { initColonnine, updateColonnine, setColonnineData } from './colonnine.js';

let map;

window.addEventListener("load", async () => {
  // Carica il dataset delle aree di servizio e lo rende disponibile globalmente
  const aree = await getAree();
  setColonnineData(aree);

  // Ripristina lo stato del toggle debug dalla sessione precedente
  const debugEnabled = localStorage.getItem('debugPosizione') === '1';
  document.querySelector('#toggleDebug').checked = debugEnabled;

  // Mostra la sezione di upload CSV solo in modalità debug
  if (debugEnabled) {
    document.getElementById('csv-debug-section').style.display = 'block';
  }

  // Gestione del file CSV per la simulazione debug:
  // il contenuto viene letto come testo e passato a caricaCSVDebug()
  document.querySelector('#csvInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const ok = caricaCSVDebug(ev.target.result);
      const status = document.getElementById('csvStatus');
      if (status) status.textContent = ok ? `✅ ${file.name}` : '❌ Formato non valido';
    };
    reader.readAsText(file);
  });

  // Inizializza la mappa Leaflet (con supporto rotazione via leaflet-rotate).
  // La guardia su window.leafletMap previene la doppia inizializzazione in caso
  // di hot-reload o inclusione multipla dello script.
  if (window.leafletMap) {
    console.warn("⚠️ La mappa è già stata inizializzata. Salto la creazione.");
    map = window.leafletMap;
  } else {
    console.log("🗺️ Inizializzo Leaflet map...");
    map = L.map('map', { rotate: true, bearing: 0 }).setView([41.9, 12.5], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Counter-rotate the tile pane text to keep labels upright when map rotates
    const tilePane = map.getPane('tilePane');
    map.on('rotateend', () => {
      const bearing = map.getBearing() || 0;
      if (tilePane) {
        tilePane.style.transform = `rotate(${-bearing}deg)`;
        tilePane.style.transformOrigin = 'center';
      }
    });
    window.leafletMap = map;
    console.log("✅ Mappa inizializzata");

    // Controllo personalizzato Leaflet per alternare tra "Nord in alto" e "Rotta in alto".
    // Usa L.Control.extend() per integrarsi nel sistema dei controlli Leaflet standard.
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
          L.DomEvent.stopPropagation(e); // Impedisce che il click zoomi/panni la mappa
          setMapRotationMode(getMapRotationMode() === 'heading' ? 'north' : 'heading');
          update();
          // Applica subito la nuova modalità senza aspettare il prossimo GPS tick
          const heading = getUserHeading();
          const coords = getUserCoordinates();
          if (coords) aggiornaUserMarker(coords.lat, coords.lon, heading);
        });
        return btn;
      }
    });
    new RotationControl({ position: 'topleft' }).addTo(map);

    // Dopo uno zoom, ricentra la mappa sull'utente e aggiorna il marker
    // (Leaflet può spostare la vista durante lo zoom se l'utente non è al centro)
    map.on("zoomend", () => {
      const coords = getUserCoordinates();
      const heading = getUserHeading();
      if (coords && heading !== null) {
        map.setView([coords.lat, coords.lon], map.getZoom());
        aggiornaUserMarker(coords.lat, coords.lon, heading);
      }
    });
  }

  // Avvia la geolocalizzazione (reale o simulata).
  // Il callback viene invocato ad ogni aggiornamento GPS: ricentra la mappa,
  // aggiorna il marker utente e ricalcola le colonnine rilevanti.
  const debug = debugEnabled;
  initGeolocation((lat, lon) => {
    const heading = getUserHeading();
    if (lat != null && lon != null) {
      map.setView([lat, lon], map.getZoom());
      aggiornaUserMarker(lat, lon, heading);
      console.log("updateColonnine", lat, lon);
      updateColonnine(map, aree, lat, lon, heading);
    }
  }, debug);

  // Attende la prima posizione GPS disponibile prima di fare il render iniziale
  // delle colonnine (necessario perché le distanze richiedono una posizione di partenza)
  const coords = await getUserPosition();
  if (coords) {
    console.log("initColonnine", coords.lat, coords.lon);
    initColonnine(map, aree, coords);
  }

  // Ricalcola le colonnine quando l'utente cambia il toggle "Mostra tutte"
  document.querySelector('#toggleNearest')?.addEventListener('change', async () => {
    const coords = getUserCoordinates();
    const heading = getUserHeading();
    if (coords) {
      updateColonnine(map, aree, coords.lat, coords.lon, heading);
    }
  });

  // Il toggle debug cambia modalità: ricarica la pagina per reinizializzare
  // la geolocalizzazione con il nuovo valore (reale ↔ simulata)
  document.querySelector('#toggleDebug')?.addEventListener('change', (e) => {
    localStorage.setItem('debugPosizione', e.target.checked ? '1' : '0');
    window.location.reload();
  });

  // Toggle del pannello delle opzioni (menu laterale/overlay)
  document.querySelector('#options-toggle')?.addEventListener('click', () => {
    document.getElementById('options-panel')?.classList.toggle('open');
  });
});
