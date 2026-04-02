// Data sources config
const SOURCES = {
  ftx:  { path: './data/free_to_x_reverse.json',    file: 'free_to_x_reverse.json',    label: 'Free To X',    cssClass: 'ftx' },
  a22:  { path: './data/a22_brennero_geocoded.json', file: 'a22_brennero_geocoded.json', label: 'A22 Brennero', cssClass: 'a22' },
  test: { path: './data/test.json',                  file: 'test.json',                 label: 'Test',         cssClass: 'test' },
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
const areaSourceKey = new Map(); // codice → source key ('ftx'|'a22'|'test')

// Edit state
let moveMode    = false;
let moveCodice  = null;
let dirHandle   = null;  // File System Access API directory handle
const pendingChanges = new Set(); // filenames with unsaved edits

// --- Data loading (independent per file to track sources) ---
async function loadData() {
  await Promise.allSettled(
    Object.entries(SOURCES).map(async ([key, src]) => {
      try {
        const res = await fetch(src.path);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const areas = data.listaAree || [];
        areasByFile[src.file] = areas;
        areas.forEach(a => {
          areaSourceKey.set(a.codice, key);
          allAree.push(a);
        });
      } catch (err) {
        console.error(`Errore caricamento ${src.file}:`, err);
        areasByFile[src.file] = [];
      }
    })
  );
  allAree = allAree.filter(a => a.lat && a.lon);
}

// --- Map ---
function initMap() {
  map = L.map('map', { zoomControl: true }).setView([43.5, 12.5], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  // Close context menu when clicking on map (not a marker)
  map.on('click', () => closeContextMenu());
}

// --- Marker icons ---
function createIcon(sourceKey, state = 'default') {
  // state: 'default' | 'selected' | 'moving'
  const cls = state === 'selected' ? 'marker-selected'
            : state === 'moving'   ? 'marker-moving'
            : `marker-${SOURCES[sourceKey]?.cssClass ?? 'ftx'}`;
  const size = state !== 'default' ? 22 : 14;
  return L.divIcon({
    className: '',
    html: `<div class="${cls}"></div>`,
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function setMarkerState(codice, state) {
  const marker = markers.get(codice);
  if (!marker) return;
  const srcKey = areaSourceKey.get(codice) ?? 'ftx';
  marker.setIcon(createIcon(srcKey, state));
}

// --- Render all markers ---
function renderMarkers() {
  markers.forEach(m => m.remove());
  markers.clear();

  allAree.forEach(area => {
    if (!area.lat || !area.lon) return;
    const srcKey = areaSourceKey.get(area.codice) ?? 'ftx';
    const marker = L.marker([area.lat, area.lon], { icon: createIcon(srcKey) })
      .addTo(map)
      .on('click',        () => selectStation(area.codice))
      .on('contextmenu',  (e) => onMarkerRightClick(e, area.codice));
    markers.set(area.codice, marker);
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

  const area = allAree.find(a => a.codice === codice);
  if (!area) return;

  map.panTo([area.lat, area.lon]);

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
  const srcKey = areaSourceKey.get(area.codice) ?? 'ftx';
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
    ${area.traE ? `<div class="detail-row"><span class="detail-label">Tratta</span><span class="detail-value">${area.traE}</span></div>` : ''}
    <div class="detail-row">
      <span class="detail-label">Coordinate</span>
      <span class="detail-value">${area.lat.toFixed(5)}, ${area.lon.toFixed(5)}</span>
    </div>
    ${area.exitRequired ? `
    <div class="detail-row">
      <span class="detail-label">Accesso</span>
      <span class="detail-value" style="color:#b45309;">⚠️ Richiede uscita dal casello — disponibile da entrambe le direzioni</span>
    </div>` : ''}
    <div class="detail-row">
      <span class="detail-label">Connettori</span>
      <span class="detail-value">${totalConn} (${area.colonnine?.length || 0} colonnine)</span>
    </div>
    <div class="detail-section-title">Colonnine</div>
    ${chargersHtml || '<div style="color:#aaa;font-size:12px;">Nessuna colonnina registrata</div>'}
  `;

  document.getElementById('detail-panel').classList.add('open');
  document.getElementById('detail-close').addEventListener('click', deselectStation);
}

// --- Context menu ---
function onMarkerRightClick(e, codice) {
  L.DomEvent.preventDefault(e.originalEvent);
  closeContextMenu();

  const area = allAree.find(a => a.codice === codice);
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
  const area = allAree.find(a => a.codice === codice);
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
  const area      = allAree.find(a => a.codice === codice);
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
      const srcData = areasByFile[filename];
      if (!srcData) continue;

      const fileHandle = await dirHandle.getFileHandle(filename);
      const writable   = await fileHandle.createWritable();
      await writable.write(JSON.stringify({ listaAree: srcData }, null, 2));
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

// --- Download fallback ---
function downloadPendingFiles() {
  pendingChanges.forEach(filename => {
    const srcData = areasByFile[filename];
    if (!srcData) return;
    const blob = new Blob([JSON.stringify({ listaAree: srcData }, null, 2)], { type: 'application/json' });
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
    const srcKey = areaSourceKey.get(area.codice) ?? 'ftx';
    if (currentFilter !== 'all' && srcKey !== currentFilter) return false;
    if (search && !area.nome?.toLowerCase().includes(search) && !area.strada?.toLowerCase().includes(search)) return false;
    return true;
  });

  markers.forEach((marker, codice) => {
    const visible = filteredAree.some(a => a.codice === codice);
    if (visible  && !map.hasLayer(marker)) marker.addTo(map);
    if (!visible &&  map.hasLayer(marker)) marker.remove();
  });

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
    const srcKey   = areaSourceKey.get(area.codice) ?? 'ftx';
    const srcLabel = SOURCES[srcKey]?.label ?? srcKey;
    const nChargers = area.colonnine?.length || 0;
    const isSelected = area.codice === selectedCodice;
    return `
      <div class="station-item${isSelected ? ' selected' : ''}" data-codice="${area.codice}">
        <div class="station-item-name">${area.nome}</div>
        <div class="station-item-meta">
          <span class="source-badge ${srcKey}">${srcLabel}</span>
          ${area.exitRequired ? '<span class="exit-badge">⚠️ uscita</span>' : ''}
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
    });
  });

  // Save bar buttons
  document.getElementById('btn-save').addEventListener('click', saveChanges);
  document.getElementById('btn-download').addEventListener('click', downloadPendingFiles);
  document.getElementById('move-status-cancel').addEventListener('click', cancelMoveMode);
}

init();
