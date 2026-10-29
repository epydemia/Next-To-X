// Configurazione condivisa da tutte le pagine.

export const CARTELLA_DATI = './data/';

// Una voce per ogni file JSON di aree di servizio. La chiave identifica la
// sorgente nell'editor (badge, filtri, colore dei marker).
export const SORGENTI_DATI = {
  ftx:  { file: 'free_to_x_reverse.json',     label: 'Free To X' },
  a22:  { file: 'a22_brennero_geocoded.json', label: 'A22 Brennero' },
  test: { file: 'test.json',                  label: 'Test' },
  // Generato da tools/Download_OSM_Colonnine.py
  ionity: { file: 'ionity_osm.json',          label: 'IONITY' },
};

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
// Strade (Nominatim) e colonnine IONITY provengono da OpenStreetMap (licenza ODbL)
const ESRI_ATTRIBUTION = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> · Dati &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const TILE_GUIDA = {
  url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  options: { attribution: ESRI_ATTRIBUTION, maxZoom: 16 },
};

export const TILE_EDITOR = {
  url: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
  options: { attribution: ESRI_ATTRIBUTION, maxZoom: 18 },
};

export const CENTRO_ITALIA = { lat: 41.9, lon: 12.5 };
export const ZOOM_GUIDA = 15;

// Stazioni oltre questo raggio vengono ignorate (salvo "Mostra tutte")
export const RAGGIO_STAZIONI_KM = 100;

// Reverse geocoding (Nominatim): al massimo una chiamata ogni N ms o ogni N km percorsi
export const REVERSE_GEOCODING_INTERVALLO_MS = 10000;
export const REVERSE_GEOCODING_DISTANZA_KM = 0.1;

// Sotto questo spostamento l'heading stimato non viene ricalcolato (rumore GPS a veicolo fermo)
export const HEADING_SPOSTAMENTO_MINIMO_KM = 0.01;

export const ATTESA_GPS_MS = 15000;

// La simulazione riproduce le tracce CSV N volte più veloce del tempo reale
export const SIMULAZIONE_ACCELERAZIONE = 10;
export const SIMULAZIONE_PASSO_MINIMO_MS = 500;
