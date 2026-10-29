import { SORGENTI_DATI as SOURCES, TILE_EDITOR, TILE_SATELLITE, FILE_REVISIONI } from '../config.js';
import { caricaSorgenti, caricaRevisioni, haCoordinate, idArea } from '../core/dati.js';

const ESITI = {
  area_servizio: '🅿️ In area di servizio',
  uscita:        '⚠️ Fuori, richiede uscita',
  esclusa:       '🚫 Non autostradale',
};

// --- State ---
let map;
let allAree      = [];    // flat array of all loaded areas
let filteredAree = [];
const markers    = new Map();  // codice → L.Marker
let selectedCodice = null;
let currentFilter  = 'all';
let currentSearch  = '';

// Per-file data tracking (needed for saving back to correct JSON)
const areasByFile = {};   // filename → area[] (same object refs as allAree)
const jsonByFile  = {};   // filename → original JSON, to keep its other fields on save
const areaSourceKey = new Map(); // codice → source key ('ftx'|'a22'|'test')

// Manual review: idArea → { esito, data }; saved to data/revisioni.json
let revisioni = {};
let layerStrade, layerSatellite;

// Edit state
let moveMode    = false;
let moveCodice  = null;
let dirHandle   = null;  // File System Access API directory handle
const pendingChanges = new Set(); // filenames with unsaved edits

// --- Data loading (per file, so edits can be saved back to the right JSON) ---
async function loadData() {
  const [sorgenti, rev] = await Promise.all([caricaSorgenti(), caricaRevisioni()]);
  revisioni = rev;
  for (const { chiave, file, aree, json } of sorgenti) {
    areasByFile[file] = aree;
    jsonByFile[file] = json;
    aree.forEach(a => areaSourceKey.set(idArea(a), chiave));
    allAree.push(...aree.filter(haCoordinate));
  }
}

// --- Review helpers ---
function esito(area) {
  return revisioni[idArea(area)]?.esito ?? (area.exitRequired ? 'uscita' : 'area_servizio');
}

function inAttesa(area) {
  return !!area.daVerificare && !revisioni[idArea(area)];
}

// --- Map ---
function initMap() {
  map = L.map('map', { zoomControl: true }).setView([43.5, 12.5], 6);
  layerStrade = L.tileLayer(TILE_EDITOR.url, TILE_EDITOR.options).addTo(map);
  layerSatellite = L.tileLayer(TILE_SATELLITE.url, TILE_SATELLITE.options);
  L.control.layers({ 'Mappa': layerStrade, 'Satellite': layerSatellite }).addTo(map);

  // Close context menu when clicking on map (not a marker)
  map.on('click', () => closeContextMenu());
}

function mostraSatellite() {
  if (map.hasLayer(layerSatellite)) return;
  map.removeLayer(layerStrade);
  layerSatellite.addTo(map);
}

// --- Marker icons ---
function createIcon(codice, state = 'default') {
  // state: 'default' | 'selected' | 'moving'
  const area = allAree.find(a => idArea(a) === codice);
  const sourceKey = areaSourceKey.get(codice) ?? 'ftx';
  const cls = state === 'selected' ? 'marker-selected'
            : state === 'moving'   ? 'marker-moving'
            : area && esito(area) === 'esclusa' ? 'marker-esclusa'
            : area && inAttesa(area) ? 'marker-verifica'
            : `marker-${sourceKey in SOURCES ? sourceKey : 'ftx'}`;
  const size = state !== 'default' ? 22 : 14;
  return L.divIcon({
    className: '',
    html: `<div class="${cls}"></div>`,
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function setMarkerState(codice, state) {
  markers.get(codice)?.setIcon(createIcon(codice, state));
}

// --- Render all markers ---
function renderMarkers() {
  markers.forEach(m => m.remove());
  markers.clear();

  allAree.forEach(area => {
    if (!area.lat || !area.lon) return;
    const marker = L.marker([area.lat, area.lon], { icon: createIcon(idArea(area)) })
      .addTo(map)
      .on('click',        () => selectStation(idArea(area)))
      .on('contextmenu',  (e) => onMarkerRightClick(e, idArea(area)));
    markers.set(idArea(area), marker);
  });
}

// --- Selection ---
function selectStation(codice) {
  if (moveMode) return; // ignore clicks during move mode

  if (selectedCodice && selectedCodice !== codice) {
    setMarkerState(selectedCodice, 'default');
  }
  selectedCodice = codice;
  setMarkerState(codice, 'selected');

  const area = allAree.find(a => idArea(a) === codice);
  if (!area) return;

  // In revisione serve vedere l'area di servizio da vicino
  if (currentFilter === 'verifica') map.setView([area.lat, area.lon], 17);
  else map.panTo([area.lat, area.lon]);

  document.querySelectorAll('.station-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.codice === codice);
  });

  showDetail(area);

  const listItem = document.querySelector(`.station-item[data-codice="${CSS.escape(codice)}"]`);
  listItem?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function deselectStation() {
  document.getElementById('detail-panel').classList.remove('open');
  if (selectedCodice) {
    setMarkerState(selectedCodice, 'default');
    selectedCodice = null;
  }
  document.querySelectorAll('.station-item').forEach(el => el.classList.remove('selected'));
}

// --- Detail panel ---
function showDetail(area) {
  const srcKey = areaSourceKey.get(idArea(area)) ?? 'ftx';
  const srcLabel = SOURCES[srcKey]?.label ?? srcKey;
  const totalConn = (area.colonnine || []).reduce((s, c) => s + (c.connettori?.length || 0), 0);

  const chargersHtml = (area.colonnine || []).map(c => {
    const connectors = (c.connettori || []).map(cn =>
      `<span class="connector-pill">${cn.modello}</span>`
    ).join('');
    const fault = c.guasti ? `<div class="fault-badge">⚠ ${c.guasti}</div>` : '';
    const activation = c.dataAttivazione
      ? `<span style="color:#999;font-size:11px;margin-left:4px;">dal ${new Date(c.dataAttivazione).toLocaleDateString('it-IT')}</span>`
      : '';
    return `
      <div class="charger-item">
        <div class="charger-model">${c.modello || c.codice}${activation}</div>
        <div>${connectors}</div>${fault}
      </div>`;
  }).join('');

  document.getElementById('detail-content').innerHTML = `
    <div id="detail-header">
      <div>
        <div id="detail-title">${area.nome}</div>
        <span class="source-badge ${srcKey}">${srcLabel}</span>
      </div>
      <button id="detail-close" title="Chiudi">✕</button>
    </div>
    <div class="detail-row">
      <span class="detail-label">Autostrada</span>
      <span class="detail-value">${area.strada || '–'}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Direzione</span>
      <span class="detail-value">${area.direzione || '–'}</span>
    </div>
    ${area.km != null ? `<div class="detail-row"><span class="detail-label">Km</span><span class="detail-value">${area.km}</span></div>` : ''}
    ${area.paese ? `<div class="detail-row"><span class="detail-label">Paese</span><span class="detail-value">${area.paese}</span></div>` : ''}
    ${area.direzione_geografica ? `<div class="detail-row"><span class="detail-label">Carreggiata</span><span class="detail-value">${area.direzione_geografica}</span></div>` : ''}
    ${area.traE ? `<div class="detail-row"><span class="detail-label">Tratta</span><span class="detail-value">${area.traE}</span></div>` : ''}
    <div class="detail-row">
      <span class="detail-label">Coordinate</span>
      <span class="detail-value">${area.lat.toFixed(5)}, ${area.lon.toFixed(5)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Connettori</span>
      <span class="detail-value">${totalConn} (${area.colonnine?.length || 0} colonnine)</span>
    </div>
    ${revisioneHtml(area)}
    <div class="detail-section-title">Colonnine</div>
    ${chargersHtml || '<div style="color:#aaa;font-size:12px;">Nessuna colonnina registrata</div>'}
  `;

  document.getElementById('detail-panel').classList.add('open');
  document.getElementById('detail-close').addEventListener('click', deselectStation);
  document.querySelectorAll('.review-btn').forEach(btn =>
    btn.addEventListener('click', () => decidi(area, btn.dataset.esito)));
  document.getElementById('review-reset')?.addEventListener('click', () => decidi(area, null));
}

function revisioneHtml(area) {
  const rev = revisioni[idArea(area)];
  const attuale = esito(area);
  const pulsanti = Object.entries(ESITI).map(([chiave, label]) =>
    `<button class="review-btn${chiave === attuale ? ' active' : ''}" data-esito="${chiave}">${label}</button>`
  ).join('');
  return `
    <div class="detail-section-title">Classificazione</div>
    <div class="detail-row">
      <span class="detail-label">Esito</span>
      <span class="detail-value">${ESITI[attuale]} <span style="color:#999;">(${rev ? `revisione del ${rev.data}` : 'automatico'})</span></span>
    </div>
    ${area.distanzaAutostradaM != null ? `<div class="detail-row"><span class="detail-label">Autostrada</span><span class="detail-value">a ${area.distanzaAutostradaM} m</span></div>` : ''}
    ${inAttesa(area) ? `<div class="review-reason">❓ Da verificare: ${area.motivo}</div>` : ''}
    <div class="review-buttons">${pulsanti}</div>
    ${rev ? '<button id="review-reset">Annulla revisione</button>' : ''}`;
}

function decidi(area, nuovoEsito) {
  const id = idArea(area);
  if (nuovoEsito) revisioni[id] = { esito: nuovoEsito, data: new Date().toISOString().slice(0, 10) };
  else delete revisioni[id];
  pendingChanges.add(FILE_REVISIONI);
  updateSaveBar();
  setMarkerState(id, 'selected');

  if (currentFilter !== 'verifica') {
    showDetail(area);
    renderList();
    return;
  }
  // In revisione si passa direttamente al prossimo caso da verificare
  applyFilters();
  setMarkerState(id, 'default');
  if (filteredAree.length) selectStation(idArea(filteredAree[0]));
  else { deselectStation(); showToast('Revisione completata — ricordati di salvare'); }
}

// --- Context menu ---
function onMarkerRightClick(e, codice) {
  L.DomEvent.preventDefault(e.originalEvent);
  closeContextMenu();

  const area = allAree.find(a => idArea(a) === codice);
  if (!area) return;

  const menu = document.getElementById('context-menu');
  document.getElementById('ctx-station-name').textContent = area.nome;

  // Position menu near cursor, keeping it inside viewport
  const x = e.originalEvent.clientX;
  const y = e.originalEvent.clientY;
  const menuW = 200, menuH = 90;
  menu.style.left = `${Math.min(x, window.innerWidth  - menuW - 10)}px`;
  menu.style.top  = `${Math.min(y, window.innerHeight - menuH - 10)}px`;
  menu.style.display = 'block';

  document.getElementById('ctx-move').onclick = () => enterMoveMode(codice);
}

function closeContextMenu() {
  document.getElementById('context-menu').style.display = 'none';
}

// Close context menu on outside click
document.addEventListener('click', (e) => {
  if (!document.getElementById('context-menu').contains(e.target)) {
    closeContextMenu();
  }
});

// --- Move mode ---
function enterMoveMode(codice) {
  closeContextMenu();
  moveMode   = true;
  moveCodice = codice;

  // Deselect current selection visually, mark moving marker orange
  if (selectedCodice && selectedCodice !== codice) setMarkerState(selectedCodice, 'default');
  setMarkerState(codice, 'moving');
  selectedCodice = null;
  document.querySelectorAll('.station-item').forEach(el => el.classList.remove('selected'));
  document.getElementById('detail-panel').classList.remove('open');

  // UI feedback
  const area = allAree.find(a => idArea(a) === codice);
  document.getElementById('move-status-name').textContent = area?.nome ?? codice;
  document.getElementById('move-status').classList.add('visible');
  map.getContainer().style.cursor = 'crosshair';

  map.once('click', onMapClickForMove);
}

function cancelMoveMode() {
  if (!moveMode) return;
  map.off('click', onMapClickForMove);

  setMarkerState(moveCodice, 'default');

  moveMode   = false;
  moveCodice = null;
  map.getContainer().style.cursor = '';
  document.getElementById('move-status').classList.remove('visible');
}

function onMapClickForMove(e) {
  if (!moveMode) return;

  const codice    = moveCodice;
  const { lat, lng } = e.latlng;
  const area      = allAree.find(a => idArea(a) === codice);
  if (!area) { cancelMoveMode(); return; }

  // Update area object in place (same ref as areasByFile entry)
  area.lat = lat;
  area.lon = lng;

  // Move marker
  markers.get(codice)?.setLatLng([lat, lng]);
  setMarkerState(codice, 'default');

  // Track which file needs saving
  const srcKey   = areaSourceKey.get(codice) ?? 'ftx';
  const filename = SOURCES[srcKey].file;
  pendingChanges.add(filename);

  // Refresh detail if this station was open
  if (selectedCodice === codice) showDetail(area);

  cancelMoveMode();
  updateSaveBar();
  showToast(`Posizione aggiornata — ${pendingChanges.size} file con modifiche non salvate`);
}

// ESC key to cancel move mode
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (moveMode) cancelMoveMode();
    else closeContextMenu();
  }
});

// --- Save bar ---
function updateSaveBar() {
  const bar = document.getElementById('save-bar');
  if (pendingChanges.size === 0) {
    bar.classList.remove('visible');
    return;
  }
  const files = [...pendingChanges].join(', ');
  document.getElementById('save-label').textContent = `Modifiche non salvate: ${files}`;
  bar.classList.add('visible');
}

// --- Save via File System Access API ---
async function saveChanges() {
  const fsaSupported = 'showDirectoryPicker' in window;

  if (!fsaSupported) {
    downloadPendingFiles();
    return;
  }

  try {
    if (!dirHandle) {
      showToast('Seleziona la cartella data/ del progetto…');
      dirHandle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
    }

    for (const filename of pendingChanges) {
      const contenuto = contenutoFile(filename);
      if (!contenuto) continue;

      const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      const writable   = await fileHandle.createWritable();
      await writable.write(contenuto);
      await writable.close();
    }

    pendingChanges.clear();
    updateSaveBar();
    showToast('File salvati con successo!');
  } catch (err) {
    if (err.name === 'AbortError') return; // user cancelled picker
    console.error('Errore salvataggio:', err);
    // If the directory handle is stale or wrong folder, reset it
    dirHandle = null;
    showToast(`Errore: ${err.message} — riprova e seleziona la cartella data/`);
  }
}

function contenutoFile(filename) {
  if (filename === FILE_REVISIONI) return JSON.stringify({ revisioni }, null, 2) + '\n';
  const aree = areasByFile[filename];
  return aree ? JSON.stringify({ ...jsonByFile[filename], listaAree: aree }, null, 2) : null;
}

// --- Download fallback ---
function downloadPendingFiles() {
  pendingChanges.forEach(filename => {
    const contenuto = contenutoFile(filename);
    if (!contenuto) return;
    const blob = new Blob([contenuto], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
  });
  pendingChanges.clear();
  updateSaveBar();
  showToast('File scaricati — sostituisci quelli nella cartella data/');
}

// --- Toast ---
let toastTimeout;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

// --- Filtering ---
function applyFilters() {
  const search = currentSearch.toLowerCase();
  filteredAree = allAree.filter(area => {
    const srcKey = areaSourceKey.get(idArea(area)) ?? 'ftx';
    if (currentFilter === 'verifica' ? !inAttesa(area) : currentFilter !== 'all' && srcKey !== currentFilter) return false;
    if (search && !area.nome?.toLowerCase().includes(search) && !area.strada?.toLowerCase().includes(search)) return false;
    return true;
  });

  markers.forEach((marker, codice) => {
    const visible = filteredAree.some(a => idArea(a) === codice);
    if (visible  && !map.hasLayer(marker)) marker.addTo(map);
    if (!visible &&  map.hasLayer(marker)) marker.remove();
  });

  const daVerificare = allAree.filter(inAttesa).length;
  document.querySelector('.filter-btn.verifica').textContent = `❓ Da verificare (${daVerificare})`;
  renderList();
}

// --- Station list ---
function renderList() {
  const container = document.getElementById('stations-list');
  document.getElementById('stations-count').textContent = `${filteredAree.length} stazioni`;

  if (filteredAree.length === 0) {
    container.innerHTML = '<div style="padding:24px;text-align:center;color:#aaa;">Nessuna stazione trovata</div>';
    return;
  }

  container.innerHTML = filteredAree.map(area => {
    const srcKey   = areaSourceKey.get(idArea(area)) ?? 'ftx';
    const srcLabel = SOURCES[srcKey]?.label ?? srcKey;
    const nChargers = area.colonnine?.length || 0;
    const isSelected = idArea(area) === selectedCodice;
    return `
      <div class="station-item${isSelected ? ' selected' : ''}" data-codice="${idArea(area)}">
        <div class="station-item-name">${area.nome}</div>
        <div class="station-item-meta">
          <span class="source-badge ${srcKey}">${srcLabel}</span>
          ${inAttesa(area) ? '<span class="verifica-badge">❓ da verificare</span>' : ''}
          ${esito(area) === 'uscita' ? '<span class="exit-badge">⚠️ uscita</span>' : ''}
          ${esito(area) === 'esclusa' ? '<span class="exit-badge">🚫 esclusa</span>' : ''}
          <span>${area.strada || ''}</span>
          ${area.direzione ? `<span>→ ${area.direzione}</span>` : ''}
          ${area.km != null ? `<span>km ${area.km}</span>` : ''}
          <span>⚡ ${nChargers}</span>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.station-item').forEach(el => {
    el.addEventListener('click', () => selectStation(el.dataset.codice));
  });
}

// --- Init ---
async function init() {
  initMap();

  await loadData();
  renderMarkers();
  applyFilters();

  // Search
  document.getElementById('search-input').addEventListener('input', e => {
    currentSearch = e.target.value;
    applyFilters();
  });

  // Source filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.source;
      applyFilters();
      if (currentFilter === 'verifica') {
        mostraSatellite();
        if (filteredAree.length) selectStation(idArea(filteredAree[0]));
      }
    });
  });

  // Save bar buttons
  document.getElementById('btn-save').addEventListener('click', saveChanges);
  document.getElementById('btn-download').addEventListener('click', downloadPendingFiles);
  document.getElementById('move-status-cancel').addEventListener('click', cancelMoveMode);
}

init();
