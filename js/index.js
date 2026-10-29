import { aggiornaUserMarker } from './mappaUI.js';
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
    map = L.map('map').setView([41.9, 12.5], 15);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>',
      maxZoom: 16
    }).addTo(map);
    window.leafletMap = map;
    console.log("✅ Mappa inizializzata");

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

  // Event listeners registrati subito, PRIMA di qualsiasi await,
  // così funzionano indipendentemente dalla disponibilità del GPS.
  document.querySelector('#toggleNearest')?.addEventListener('change', () => {
    const coords = getUserCoordinates();
    const heading = getUserHeading();
    if (coords) updateColonnine(map, aree, coords.lat, coords.lon, heading);
  });

  document.querySelector('#toggleDebug')?.addEventListener('change', (e) => {
    localStorage.setItem('debugPosizione', e.target.checked ? '1' : '0');
    window.location.reload();
  });

  document.querySelector('#options-toggle')?.addEventListener('click', () => {
    document.getElementById('options-panel')?.classList.toggle('open');
  });

  document.querySelector('#options-close')?.addEventListener('click', () => {
    document.getElementById('options-panel')?.classList.remove('open');
  });

  document.querySelector('#stations-toggle-btn')?.addEventListener('click', () => {
    const list = document.getElementById('stations-list');
    const chevron = document.getElementById('stations-chevron');
    const hidden = list.hasAttribute('hidden');
    if (hidden) {
      list.removeAttribute('hidden');
      chevron.classList.add('open');
    } else {
      list.setAttribute('hidden', '');
      chevron.classList.remove('open');
    }
  });

  // Avvia la geolocalizzazione (reale o simulata).
  const debug = debugEnabled;
  initGeolocation((lat, lon) => {
    const heading = getUserHeading();
    if (lat != null && lon != null) {
      map.setView([lat, lon], map.getZoom());
      aggiornaUserMarker(lat, lon, heading);
      updateColonnine(map, aree, lat, lon, heading);
    }
  }, debug);

  // Attende la prima posizione (timeout 15s): se il GPS non è disponibile
  // mostra comunque le stazioni e un avviso nell'HUD.
  const coords = await getUserPosition();
  if (coords) {
    initColonnine(map, aree, coords);
  } else {
    const stradaDiv = document.getElementById('strada');
    if (stradaDiv) stradaDiv.innerText = '⚠️ GPS non disponibile — attiva la posizione';
    map.setView([41.9, 12.5], 6);
    initColonnine(map, aree, { lat: 41.9, lon: 12.5 });
  }
});
