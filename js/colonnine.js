import { getDistanceFromLatLonInKm, isStazioneAvanti, matchDirezioneGeografica } from './geoutils.js';

let colonnineAree = [];

// Salva in memoria l'elenco completo delle colonnine
export function setColonnineData(aree) {
  colonnineAree = aree;
}

// Inizializza la mappa, la tabella e i marker grigi.
// Calcola le distanze tra l'utente e le colonnine e aggiorna l'interfaccia.
export function initColonnine(map, aree, userCoordinates) {
  console.log("📥 Inizio visualizzazione iniziale colonnine");
  document.body.style.cursor = "wait";
  //document.getElementById("coords").innerText = "⏳ Caricamento colonnine...";

  if (!userCoordinates) return null;
  const results = aree.map(area => {
    const lat = parseFloat(area.lat);
    const lon = parseFloat(area.lon);
    const distanzaRaw = getDistanceFromLatLonInKm(userCoordinates.lat, userCoordinates.lon, lat, lon);
    const distanza = typeof distanzaRaw === 'number' && !isNaN(distanzaRaw) ? distanzaRaw : Number.POSITIVE_INFINITY;

    return {
      nome: area.nome,
      strada: area.strada,
      lat,
      lon,
      distanza,
      colonnine: area.colonnine
    };
  });

  if (window.stationMarkers) {
    window.stationMarkers.forEach(m => map.removeLayer(m));
  }
  window.stationMarkers = [];

  aggiornaTabellaColonnine(results);

  results.forEach(station => {
    const markerIcon = L.divIcon({
      className: 'custom-marker',
      html: '<div class="marker-grigio"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });

    const marker = L.marker([station.lat, station.lon], { icon: markerIcon }).addTo(map)
      .bindPopup(`<strong>${station.nome}</strong><br>${station.strada}<br>${station.distanza} km`);
    window.stationMarkers.push(marker);
  });

  document.body.style.cursor = "default";
  //document.getElementById("coords").innerText = "";
  // NB: Non toccare #strada e #direzione – sono gestiti da geolocalizzazione.js
}

// Aggiorna le colonnine: normalizza gli indirizzi, applica filtri opzionali,
// calcola le distanze, verifica la compatibilità degli indirizzi e delle direzioni,
// crea marker sulla mappa e aggiorna l'interfaccia utente.
export function updateColonnine(map, aree, userLat, userLon, heading) {
  const normalizeFull = s => s?.toLowerCase().trim();

  const disattivaFiltri = document.querySelector("#toggleNearest")?.checked;
  const stradaUtente = window.stradaUtenteReverse ?? "";
  const stradaUtenteNorm = normalizeFull(stradaUtente);
  const codiceAutostrada = window.codiceAutostradaUtente ?? null;

  const preResults = aree.map(area => {
    const lat = parseFloat(area.lat);
    const lon = parseFloat(area.lon);
    const distanza = getDistanceFromLatLonInKm(userLat, userLon, lat, lon);

    // Match autostrada: preferisce il codice (es. "A13") rispetto al nome reverse
    const stradaAreaUpper = area.strada?.toUpperCase() ?? "";
    const stradaCompatibile = disattivaFiltri || (
      codiceAutostrada
        ? stradaAreaUpper.includes(codiceAutostrada)
        : (stradaUtenteNorm && normalizeFull(area.stradaReverse) &&
           (normalizeFull(area.stradaReverse).includes(stradaUtenteNorm) ||
            stradaUtenteNorm.includes(normalizeFull(area.stradaReverse))))
    );

    // La stazione è sulla stessa carreggiata (direzione_geografica) E geometricamente avanti?
    const stessaCarreggiata = heading != null
      ? matchDirezioneGeografica(area.direzione_geografica, heading)
      : true;
    const avanti = heading != null
      ? isStazioneAvanti(userLat, userLon, heading, lat, lon)
      : true;

    if (disattivaFiltri || distanza <= 100) {
      const isAvanti = disattivaFiltri || (stradaCompatibile && stessaCarreggiata && avanti);

      return {
        nome: area.nome,
        strada: area.strada || area.stradaReverse || "Strada sconosciuta",
        direzione: area.direzione ?? "",
        lat,
        lon,
        distanza,
        colonnine: area.colonnine,
        isAvanti
      };
    }
    return null;
  }).filter(Boolean);

  preResults.sort((a, b) => a.distanza - b.distanza);

  // Trova la stazione più vicina avanti sulla stessa autostrada
  const nearestAvanti = preResults.find(s => s.isAvanti) ?? null;
  if (nearestAvanti) nearestAvanti.isNearest = true;

  const filtered = preResults;

  if (window.stationMarkers) {
    window.stationMarkers.forEach(m => map.removeLayer(m));
  }
  window.stationMarkers = [];

  aggiornaTabellaColonnine(filtered);
  updateNextStationPanel(nearestAvanti);

  filtered.forEach(station => {
    let markerClass, markerSize;
    if (station.isNearest) {
      markerClass = 'marker-prossima';
      markerSize = [20, 20];
    } else if (station.isAvanti) {
      markerClass = 'marker-rosso';
      markerSize = [14, 14];
    } else {
      markerClass = 'marker-grigio';
      markerSize = [14, 14];
    }

    const markerIcon = L.divIcon({
      className: 'custom-marker',
      html: `<div class="${markerClass}"></div>`,
      iconSize: markerSize,
      iconAnchor: [markerSize[0] / 2, markerSize[1] / 2]
    });

    const popupText = station.isNearest
      ? `<strong>⚡ PROSSIMA COLONNINA</strong><br><strong>${station.nome}</strong><br>${station.strada}<br>→ ${station.direzione}<br>${station.distanza.toFixed(1)} km`
      : `<strong>${station.nome}</strong><br>${station.strada}<br>${station.distanza.toFixed(2)} km`;

    const marker = L.marker([station.lat, station.lon], { icon: markerIcon }).addTo(map)
      .bindPopup(popupText);
    window.stationMarkers.push(marker);
  });

  updateDistanceBar(filtered);
}

// Aggiorna il pannello "prossima colonnina" con la stazione più vicina avanti.
function updateNextStationPanel(station) {
  const panel = document.getElementById("next-station");
  if (!panel) return;

  if (!station) {
    panel.innerHTML = '<span class="next-station-label">Prossima colonnina:</span> <span class="next-station-info">–</span>';
    return;
  }

  panel.innerHTML = `
    <span class="next-station-label">Prossima colonnina:</span>
    <span class="next-station-name">${station.nome}</span>
    <span class="next-station-dir">→ ${station.direzione}</span>
    <span class="next-station-dist">${station.distanza.toFixed(1)} km</span>
  `;
}

// Calcola la posizione delle icone sulla barra delle distanze in base alla distanza
// e aggiorna dinamicamente l'interfaccia con le informazioni delle colonnine.
// Mostra solo le stazioni avanti sulla stessa autostrada; evidenzia la più vicina.
function updateDistanceBar(stations) {
  const bar = document.getElementById("distance-bar");
  if (!bar) return;

  bar.innerHTML = "";

  const avanti = stations.filter(s => s.isAvanti);
  if (avanti.length === 0) return;

  // Scala fino alla stazione più lontana avanti (max 100 km)
  const maxDist = Math.min(Math.max(...avanti.map(s => s.distanza)) * 1.1, 100);

  avanti.forEach(station => {
    const distanza = parseFloat(station.distanza);
    if (isNaN(distanza)) return;

    const barWidth = bar.clientWidth;
    const positionPx = (distanza / maxDist) * barWidth;
    const marker = document.createElement("div");
    const emoji = station.isNearest ? "⚡" : "🔌";
    marker.innerHTML = `<span title="${station.nome}\n${station.strada}\n→ ${station.direzione}\n${distanza.toFixed(1)} km\nStalli: ${station.colonnine?.length ?? "?"}">${emoji}</span>`;
    marker.style.position = "absolute";
    marker.style.left = `${positionPx}px`;
    marker.style.top = station.isNearest ? "-10px" : "-6px";
    marker.style.transform = "translateX(-50%)";
    marker.style.fontSize = station.isNearest ? "22px" : "18px";
    bar.appendChild(marker);
  });
}

// Costruisce la tabella HTML con le informazioni delle colonnine filtrate,
// aggiornando i dati visualizzati nell'interfaccia utente.
function aggiornaTabellaColonnine(colonnine) {
  const tbody = document.querySelector("#stations-table tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  colonnine.forEach(station => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${station.nome}</td>
      <td>${station.strada}</td>
      <td>${station.distanza.toFixed(2)}</td>
      <td>${station.lat}</td>
      <td>${station.lon}</td>
    `;
    tbody.appendChild(row);
  });
}