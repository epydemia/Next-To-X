import { FONTI, TILE_EDITOR, TILE_SATELLITE, FILE_REVISIONI } from '../config.js';
import { creaSfondo, aggiungiAttribuzioneOsm } from '../sfondi.js';
import { contaPagina } from '../statistiche.js';
import { caricaAreeOriginali, caricaRevisioni, applicaRevisione, revisioneDi, nomeStrada } from '../core/dati.js';

// Editor delle aree: legge data/aree.json e salva ogni modifica (classificazione,
// spostamento) in data/revisioni.json. I file delle fonti non vengono mai toccati,
// così le correzioni sopravvivono a un nuovo download dei dati.

const ESITI = {
  area_servizio: '🅿️ In area di servizio',
  uscita:        '⚠️ Fuori, richiede uscita',
  esclusa:       '🚫 Non autostradale',
};
const ESITO_FUORI_AUTOSTRADA = '🛣️ Fuori autostrada';

// --- State ---
let map;
let originali    = new Map();  // id → area come esce dalle fonti
let allAree      = [];         // aree con le revisioni applicate
let filteredAree = [];
const markers    = new Map();  // id → L.Marker
let selectedId   = null;
let currentFilter = 'all';
let currentSearch = '';

let revisioni = {};
let layerStrade, layerSatellite;

// Edit state
let moveMode = false;
let moveId   = null;
let dirHandle = null;  // File System Access API directory handle
let modificheNonSalvate = false;

async function loadData() {
  const [aree, rev] = await Promise.all([caricaAreeOriginali(), caricaRevisioni()]);
  revisioni = rev;
  originali = new Map(aree.filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lon)).map(a => [a.id, a]));
  ricalcola();
}

/** Riapplica le revisioni correnti a tutte le aree (dopo ogni modifica). */
function ricalcola() {
  allAree = [...originali.values()].map(a => applicaRevisione(a, revisioneDi(revisioni, a)?.revisione));
}

const areaDa = id => allAree.find(a => a.id === id);

// --- Review helpers ---
function esito(area) {
  return area.esclusa ? 'esclusa' : area.accesso;
}

function inAttesa(area) {
  return !!area.verifica && !revisioneDi(revisioni, area)?.revisione.esito;
}

/** Chiave sotto cui salvare una revisione: quella già usata per l'area, altrimenti il suo id. */
function chiaveRevisione(area) {
  return revisioneDi(revisioni, area)?.chiave ?? area.id;
}

function aggiornaRevisione(area, modifica) {
  const chiave = chiaveRevisione(area);
  const nuova = { ...revisioni[chiave], ...modifica, data: new Date().toISOString().slice(0, 10) };
  Object.keys(nuova).forEach(k => nuova[k] === undefined && delete nuova[k]);
  const restaQualcosa = ['esito', 'direzione_geografica', 'lat'].some(k => nuova[k] != null);
  if (restaQualcosa) revisioni[chiave] = nuova;
  else delete revisioni[chiave];
  modificheNonSalvate = true;
  ricalcola();
  updateSaveBar();
}

function fonte(area) {
  return area.fonti[0];
}

function badgeFonti(area) {
  return area.fonti.map(f => `<span class="source-badge ${FONTI[f]?.classe ?? ''}">${FONTI[f]?.label ?? f}</span>`).join(' ');
}

// --- Map ---
function initMap() {
  map = L.map('map', { zoomControl: true }).setView([43.5, 12.5], 6);
  layerStrade = creaSfondo(TILE_EDITOR).addTo(map);
  layerSatellite = creaSfondo(TILE_SATELLITE);
  aggiungiAttribuzioneOsm(map);
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
function createIcon(id, state = 'default') {
  // state: 'default' | 'selected' | 'moving'
  const area = areaDa(id);
  const cls = state === 'selected' ? 'marker-selected'
            : state === 'moving'   ? 'marker-moving'
            : area?.esclusa ? 'marker-esclusa'
            : area && inAttesa(area) ? 'marker-verifica'
            : `marker-${FONTI[area && fonte(area)]?.classe ?? 'ftx'}`;
  const size = state !== 'default' ? 22 : 14;
  return L.divIcon({
    className: '',
    html: `<div class="${cls}"></div>`,
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function setMarkerState(id, state) {
  markers.get(id)?.setIcon(createIcon(id, state));
}

// --- Render all markers ---
function renderMarkers() {
  markers.forEach(m => m.remove());
  markers.clear();

  allAree.forEach(area => {
    const marker = L.marker([area.lat, area.lon], { icon: createIcon(area.id) })
      .addTo(map)
      .on('click',        () => selectStation(area.id))
      .on('contextmenu',  (e) => onMarkerRightClick(e, area.id));
    markers.set(area.id, marker);
  });
}

// --- Selection ---
function selectStation(id) {
  if (moveMode) return; // ignore clicks during move mode

  if (selectedId && selectedId !== id) {
    setMarkerState(selectedId, 'default');
  }
  selectedId = id;
  setMarkerState(id, 'selected');

  const area = areaDa(id);
  if (!area) return;

  // In revisione serve vedere l'area di servizio da vicino
  if (currentFilter === 'verifica') map.setView([area.lat, area.lon], 17);
  else map.panTo([area.lat, area.lon]);

  document.querySelectorAll('.station-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
  });

  showDetail(area);

  const listItem = document.querySelector(`.station-item[data-id="${CSS.escape(id)}"]`);
  listItem?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function deselectStation() {
  document.getElementById('detail-panel').classList.remove('open');
  if (selectedId) {
    setMarkerState(selectedId, 'default');
    selectedId = null;
  }
  document.querySelectorAll('.station-item').forEach(el => el.classList.remove('selected'));
}

// --- Detail panel ---
function riga(etichetta, valore) {
  return valore == null || valore === '' ? ''
    : `<div class="detail-row"><span class="detail-label">${etichetta}</span><span class="detail-value">${valore}</span></div>`;
}

function correzione(area, campo, formatta = v => v ?? 'ND') {
  const c = area.correzioni?.[campo];
  return c ? ` <span style="color:#999;">(corretta, era ${formatta(c.da)}${c.nota ? ` — ${c.nota}` : ''})</span>` : '';
}

function connettoreHtml(n) {
  return `<span class="connector-pill">${n.tipo}${n.potenzaKw ? ` ${n.potenzaKw} kW` : ''}</span>`;
}

function showDetail(area) {
  const totalConn = area.colonnine.reduce((s, c) => s + c.connettori.length, 0);
  const piuOperatori = area.operatori.length > 1;

  const chargersHtml = area.colonnine.map(c => {
    const fault = c.guasti ? `<div class="fault-badge">⚠ ${c.guasti}</div>` : '';
    const dettagli = [piuOperatori && c.operatore, c.attivaDal && `dal ${new Date(c.attivaDal).toLocaleDateString('it-IT')}`]
      .filter(Boolean).join(' · ');
    return `
      <div class="charger-item">
        <div class="charger-model">${c.modello || c.id}${c.potenzaKw && !String(c.modello).includes(c.potenzaKw) ? ` · ${c.potenzaKw} kW` : ''}
          ${dettagli ? `<span style="color:#999;font-size:11px;margin-left:4px;">${dettagli}</span>` : ''}</div>
        <div>${c.connettori.map(connettoreHtml).join('')}</div>${fault}
      </div>`;
  }).join('');

  const posizione = `${area.lat.toFixed(5)}, ${area.lon.toFixed(5)}` +
    correzione(area, 'posizione', da => da.map(v => v.toFixed(5)).join(', ')) +
    (revisioneDi(revisioni, area)?.revisione.lat != null ? ' <button id="reset-posizione" class="link-btn">ripristina</button>' : '');

  document.getElementById('detail-content').innerHTML = `
    <div id="detail-header">
      <div>
        <div id="detail-title">${area.nome}</div>
        ${badgeFonti(area)}
      </div>
      <button id="detail-close" title="Chiudi">✕</button>
    </div>
    ${riga('Autostrada', nomeStrada(area) || '–')}
    ${riga('Direzione', area.destinazione || '–')}
    ${riga('Km', area.km)}
    ${riga('Paese', area.paese)}
    ${riga('Operatori', area.operatori.join(', '))}
    ${area.carreggiata || area.correzioni?.carreggiata ? riga('Carreggiata', (area.carreggiata ?? 'ND') + correzione(area, 'carreggiata')) : ''}
    ${riga('Coordinate', posizione)}
    ${riga('Indirizzo', area.indirizzo)}
    ${riga('Connettori', `${totalConn} (${area.colonnine.length} colonnine)`)}
    ${revisioneHtml(area)}
    <div class="detail-section-title">Colonnine</div>
    ${chargersHtml || '<div style="color:#aaa;font-size:12px;">Nessuna colonnina registrata</div>'}
  `;

  document.getElementById('detail-panel').classList.add('open');
  document.getElementById('detail-close').addEventListener('click', deselectStation);
  document.querySelectorAll('.review-btn').forEach(btn =>
    btn.addEventListener('click', () => decidi(area, btn.dataset.esito)));
  document.getElementById('review-reset')?.addEventListener('click', () => decidi(area, null));
  document.getElementById('reset-posizione')?.addEventListener('click', () => {
    aggiornaRevisione(area, { lat: undefined, lon: undefined });
    const ripristinata = areaDa(area.id);
    markers.get(area.id)?.setLatLng([ripristinata.lat, ripristinata.lon]);
    showDetail(ripristinata);
  });
}

function revisioneHtml(area) {
  const rev = revisioneDi(revisioni, area)?.revisione;
  const manuale = rev?.esito ? rev : null;
  const attuale = esito(area);
  const pulsanti = Object.entries(ESITI).map(([chiave, label]) =>
    `<button class="review-btn${chiave === attuale ? ' active' : ''}" data-esito="${chiave}">${label}</button>`
  ).join('');
  return `
    <div class="detail-section-title">Classificazione</div>
    ${riga('Esito', `${ESITI[attuale] ?? ESITO_FUORI_AUTOSTRADA} <span style="color:#999;">(${manuale ? `revisione del ${manuale.data}` : 'automatico'})</span>`)}
    ${area.distanzaAutostradaM != null ? riga('Autostrada', `a ${area.distanzaAutostradaM} m`) : ''}
    ${inAttesa(area) ? `<div class="review-reason">❓ Da verificare: ${area.verifica}</div>` : ''}
    <div class="review-buttons">${pulsanti}</div>
    ${manuale ? '<button id="review-reset">Annulla revisione</button>' : ''}`;
}

function decidi(area, nuovoEsito) {
  aggiornaRevisione(area, { esito: nuovoEsito ?? undefined });
  setMarkerState(area.id, 'selected');

  if (currentFilter !== 'verifica') {
    showDetail(areaDa(area.id));
    renderList();
    return;
  }
  // In revisione si passa direttamente al prossimo caso da verificare
  applyFilters();
  setMarkerState(area.id, 'default');
  if (filteredAree.length) selectStation(filteredAree[0].id);
  else { deselectStation(); showToast('Revisione completata — ricordati di salvare'); }
}

// --- Context menu ---
function onMarkerRightClick(e, id) {
  L.DomEvent.preventDefault(e.originalEvent);
  closeContextMenu();

  const area = areaDa(id);
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

  document.getElementById('ctx-move').onclick = () => enterMoveMode(id);
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
function enterMoveMode(id) {
  closeContextMenu();
  moveMode = true;
  moveId   = id;

  // Deselect current selection visually, mark moving marker orange
  if (selectedId && selectedId !== id) setMarkerState(selectedId, 'default');
  setMarkerState(id, 'moving');
  selectedId = null;
  document.querySelectorAll('.station-item').forEach(el => el.classList.remove('selected'));
  document.getElementById('detail-panel').classList.remove('open');

  // UI feedback
  document.getElementById('move-status-name').textContent = areaDa(id)?.nome ?? id;
  document.getElementById('move-status').classList.add('visible');
  map.getContainer().style.cursor = 'crosshair';

  map.once('click', onMapClickForMove);
}

function cancelMoveMode() {
  if (!moveMode) return;
  map.off('click', onMapClickForMove);

  setMarkerState(moveId, 'default');

  moveMode = false;
  moveId   = null;
  map.getContainer().style.cursor = '';
  document.getElementById('move-status').classList.remove('visible');
}

function onMapClickForMove(e) {
  if (!moveMode) return;

  const id   = moveId;
  const area = areaDa(id);
  if (!area) { cancelMoveMode(); return; }

  const { lat, lng } = e.latlng;
  aggiornaRevisione(area, { lat: +lat.toFixed(6), lon: +lng.toFixed(6) });
  markers.get(id)?.setLatLng([lat, lng]);
  setMarkerState(id, 'default');

  cancelMoveMode();
  showToast('Posizione aggiornata — ricordati di salvare');
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
  if (!modificheNonSalvate) {
    bar.classList.remove('visible');
    return;
  }
  document.getElementById('save-label').textContent = `Modifiche non salvate: ${FILE_REVISIONI}`;
  bar.classList.add('visible');
}

function contenutoRevisioni() {
  return JSON.stringify({ revisioni }, null, 2) + '\n';
}

// --- Save via File System Access API ---
async function saveChanges() {
  if (!('showDirectoryPicker' in window)) {
    downloadPendingFiles();
    return;
  }

  try {
    if (!dirHandle) {
      showToast('Seleziona la cartella data/ del progetto…');
      dirHandle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
    }
    const fileHandle = await dirHandle.getFileHandle(FILE_REVISIONI, { create: true });
    const writable   = await fileHandle.createWritable();
    await writable.write(contenutoRevisioni());
    await writable.close();

    modificheNonSalvate = false;
    updateSaveBar();
    showToast('Revisioni salvate!');
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
  const blob = new Blob([contenutoRevisioni()], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: FILE_REVISIONI }).click();
  URL.revokeObjectURL(url);
  modificheNonSalvate = false;
  updateSaveBar();
  showToast(`${FILE_REVISIONI} scaricato — sostituisci quello nella cartella data/`);
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
    if (currentFilter === 'verifica' ? !inAttesa(area) : currentFilter !== 'all' && !area.fonti.includes(currentFilter)) return false;
    if (search && !area.nome.toLowerCase().includes(search) && !(nomeStrada(area) ?? '').toLowerCase().includes(search)) return false;
    return true;
  });

  const visibili = new Set(filteredAree.map(a => a.id));
  markers.forEach((marker, id) => {
    if (visibili.has(id)  && !map.hasLayer(marker)) marker.addTo(map);
    if (!visibili.has(id) &&  map.hasLayer(marker)) marker.remove();
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

  container.innerHTML = filteredAree.map(area => `
      <div class="station-item${area.id === selectedId ? ' selected' : ''}" data-id="${area.id}">
        <div class="station-item-name">${area.nome}</div>
        <div class="station-item-meta">
          ${badgeFonti(area)}
          ${inAttesa(area) ? '<span class="verifica-badge">❓ da verificare</span>' : ''}
          ${esito(area) === 'uscita' ? '<span class="exit-badge">⚠️ uscita</span>' : ''}
          ${esito(area) === 'esclusa' ? '<span class="exit-badge">🚫 esclusa</span>' : ''}
          <span>${nomeStrada(area) ?? ''}</span>
          ${area.destinazione ? `<span>→ ${area.destinazione}</span>` : ''}
          ${area.km != null ? `<span>km ${area.km}</span>` : ''}
          <span>⚡ ${area.colonnine.length}</span>
        </div>
      </div>`).join('');

  container.querySelectorAll('.station-item').forEach(el => {
    el.addEventListener('click', () => selectStation(el.dataset.id));
  });
}

// --- Init ---
async function init() {
  contaPagina('/editor', 'Editor stazioni');
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
        if (filteredAree.length) selectStation(filteredAree[0].id);
      }
    });
  });

  // Save bar buttons
  document.getElementById('btn-save').addEventListener('click', saveChanges);
  document.getElementById('btn-download').addEventListener('click', downloadPendingFiles);
  document.getElementById('move-status-cancel').addEventListener('click', cancelMoveMode);
}

init();
