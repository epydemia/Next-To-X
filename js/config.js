// Configurazione condivisa da tutte le pagine.

export const CARTELLA_DATI = './data/';

// Tutte le aree, unite e nel formato unico: generato da tools/Compila_Aree.py
// a partire dai file delle singole fonti (free_to_x_reverse.json, ionity_osm.json…)
export const FILE_AREE = 'aree.json';

// Fonti possibili nel campo "fonti" di un'area: etichetta e classe CSS nell'editor
export const FONTI = {
  free_to_x: { label: 'Free To X',       classe: 'ftx' },
  a22:       { label: 'A22 Brennero',    classe: 'a22' },
  test:      { label: 'Test',            classe: 'test' },
  ionity:    { label: 'IONITY',          classe: 'ionity' },
  osm:       { label: 'Altri operatori', classe: 'osm' },
};

// Decisioni della revisione manuale fatta nell'editor stazioni
export const FILE_REVISIONI = 'revisioni.json';

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

export const TILE_SATELLITE = {
  url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
  options: { attribution: ESRI_ATTRIBUTION, maxZoom: 19 },
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
