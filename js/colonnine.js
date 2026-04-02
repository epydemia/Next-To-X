import { getDistanceFromLatLonInKm, isStazioneAvanti, matchDirezioneGeografica } from './geoutils.js';

// Dataset completo delle aree di servizio con colonnine, impostato da index.js al caricamento
let colonnineAree = [];

/**
 * Salva in memoria l'elenco completo delle aree di servizio.
 * Chiamato una volta sola da index.js dopo il caricamento dei dati.
 */
export function setColonnineData(aree) {
  colonnineAree = aree;
}

/**
 * Inizializzazione della mappa e della tabella al primo caricamento.
 * Calcola le distanze di tutte le stazioni dall'utente (senza filtrare per
 * autostrada o direzione) e crea marker grigi su mappa come stato iniziale.
 * I marker vengono sostituiti da updateColonnine() non appena l'utente si muove.
 */
export function initColonnine(map, aree, userCoordinates) {
  console.log("📥 Inizio visualizzazione iniziale colonnine");
  document.body.style.cursor = "wait";

  if (!userCoordinates) return null;
  const results = aree.map(area => {
    const lat = parseFloat(area.lat);
    const lon = parseFloat(area.lon);
    const distanzaRaw = getDistanceFromLatLonInKm(userCoordinates.lat, userCoordinates.lon, lat, lon);
    // Fallback a Infinity se il calcolo restituisce NaN (es. coordinate mancanti nel JSON)
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

  // Rimuove i marker precedenti prima di ridisegnarli
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
  // NB: Non toccare #strada e #direzione – sono gestiti da geolocalizzazione.js
}

/**
 * Aggiorna le colonnine ad ogni posizione GPS ricevuta.
 * Applica una pipeline di filtri per mostrare solo le stazioni rilevanti:
 *
 * 1. Distanza: scarta stazioni oltre 100 km (o mostra tutte se filtri disabilitati)
 * 2. Compatibilità strada: confronta la strada dell'area con quella dell'utente
 *    (preferisce il codice autostrada es. "A14" rispetto al nome reverse geocode)
 * 3. Carreggiata (direzione_geografica): esclude stazioni sull'altra carreggiata
 * 4. Posizione avanti: esclude stazioni già superate
 *
 * La stazione più vicina tra quelle "avanti" viene evidenziata come prossima.
 */
export function updateColonnine(map, aree, userLat, userLon, heading) {
  const normalizeFull = s => s?.toLowerCase().trim();

  // Se il toggle "Mostra tutte" è attivo, disabilita i filtri strada/direzione/avanti
  const disattivaFiltri = document.querySelector("#toggleNearest")?.checked;
  const stradaUtente = window.stradaUtenteReverse ?? "";
  const stradaUtenteNorm = normalizeFull(stradaUtente);
  const codiceAutostrada = window.codiceAutostradaUtente ?? null;

  const preResults = aree.map(area => {
    const lat = parseFloat(area.lat);
    const lon = parseFloat(area.lon);
    const distanza = getDistanceFromLatLonInKm(userLat, userLon, lat, lon);

    // Confronto strada: se l'utente è su un'autostrada con codice noto (es. "A14"),
    // cerca il codice nel nome della strada dell'area. Altrimenti usa il matching
    // testuale tra il nome reverse geocode dell'utente e quello dell'area.
    // Il doppio includes() gestisce i casi in cui uno dei due sia sottostringa dell'altro.
    const stradaAreaUpper = area.strada?.toUpperCase() ?? "";
    const stradaCompatibile = disattivaFiltri || (
      codiceAutostrada
        ? stradaAreaUpper.includes(codiceAutostrada)
        : (stradaUtenteNorm && normalizeFull(area.stradaReverse) &&
           (normalizeFull(area.stradaReverse).includes(stradaUtenteNorm) ||
            stradaUtenteNorm.includes(normalizeFull(area.stradaReverse))))
    );

    // Le stazioni "exitRequired" sono accessibili da entrambe le direzioni:
    // si salta il filtro carreggiata ma si mantiene il filtro "avanti"
    const exitRequired = !!area.exitRequired;

    // Filtra per carreggiata e posizione avanti rispetto alla direzione di marcia
    const stessaCarreggiata = exitRequired || heading == null
      ? true
      : matchDirezioneGeografica(area.direzione_geografica, heading);
    const avanti = heading != null
      ? isStazioneAvanti(userLat, userLon, heading, lat, lon)
      : true;

    if (disattivaFiltri || distanza <= 100) {
      const isAvanti = disattivaFiltri || (stradaCompatibile && stessaCarreggiata && avanti);

      return {
        nome: area.nome,
        // Fallback progressivo per il nome della strada
        strada: area.strada || area.stradaReverse || "Strada sconosciuta",
        direzione: area.direzione ?? "",
        lat,
        lon,
        distanza,
        colonnine: area.colonnine,
        exitRequired,
        isAvanti
      };
    }
    return null;
  }).filter(Boolean); // Rimuove le stazioni oltre 100 km (che hanno restituito null)

  // Ordina per distanza crescente: la prima stazione "avanti" sarà quella più vicina
  preResults.sort((a, b) => a.distanza - b.distanza);

  // Identifica la prossima colonnina: prima stazione avanti sulla stessa autostrada
  const nearestAvanti = preResults.find(s => s.isAvanti) ?? null;
  if (nearestAvanti) nearestAvanti.isNearest = true;

  const filtered = preResults;

  // Ridisegna tutti i marker sulla mappa
  if (window.stationMarkers) {
    window.stationMarkers.forEach(m => map.removeLayer(m));
  }
  window.stationMarkers = [];

  aggiornaTabellaColonnine(filtered);
  updateNextStationPanel(nearestAvanti);

  filtered.forEach(station => {
    // Quattro stili di marker distinti per stato visivo:
    // - prossima (⚡): stazione più vicina avanti → marker grande verde
    // - uscita prossima: stazione exitRequired più vicina avanti → marker grande arancione
    // - rosso: avanti sulla stessa autostrada ma non la più vicina
    // - uscita: exitRequired non prossima → marker arancione
    // - grigio: fuori dalla carreggiata/autostrada corrente
    let markerClass, markerSize;
    if (station.isNearest && station.exitRequired) {
      markerClass = 'marker-uscita-prossima';
      markerSize = [20, 20];
    } else if (station.isNearest) {
      markerClass = 'marker-prossima';
      markerSize = [20, 20];
    } else if (station.isAvanti && station.exitRequired) {
      markerClass = 'marker-uscita';
      markerSize = [14, 14];
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

    const exitNote = station.exitRequired ? '<br>⚠️ Richiede uscita dal casello' : '';
    const popupText = station.isNearest
      ? `<strong>⚡ PROSSIMA COLONNINA</strong><br><strong>${station.nome}</strong><br>${station.strada}<br>→ ${station.direzione}<br>${station.distanza.toFixed(1)} km${exitNote}`
      : `<strong>${station.nome}</strong><br>${station.strada}<br>${station.distanza.toFixed(2)} km${exitNote}`;

    const marker = L.marker([station.lat, station.lon], { icon: markerIcon }).addTo(map)
      .bindPopup(popupText);
    window.stationMarkers.push(marker);
  });

  updateDistanceBar(filtered);
}

/**
 * Aggiorna il pannello fisso "Prossima colonnina" in testa alla pagina.
 * Mostra nome, direzione e distanza della stazione più vicina avanti,
 * oppure un trattino se non ne è stata trovata nessuna.
 */
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
    ${station.exitRequired ? '<span class="next-station-exit">⚠️ uscita</span>' : `<span class="next-station-dir">→ ${station.direzione}</span>`}
    <span class="next-station-dist">${station.distanza.toFixed(1)} km</span>
  `;
}

/**
 * Disegna la barra delle distanze orizzontale con le icone delle colonnine avanti.
 *
 * La barra è scalata dinamicamente: la stazione più lontana occupa il 100%
 * della larghezza (con un padding del 10% e un cap a 100 km).
 * Ogni icona è posizionata in pixel usando la larghezza reale del DOM (clientWidth),
 * quindi va chiamata dopo che il layout è già stato calcolato.
 *
 * Mostra solo le stazioni avanti; la prossima (⚡) è resa più grande delle altre (🔌).
 */
function updateDistanceBar(stations) {
  const bar = document.getElementById("distance-bar");
  if (!bar) return;

  bar.innerHTML = "";

  const avanti = stations.filter(s => s.isAvanti);
  if (avanti.length === 0) return;

  // Scala la barra sulla stazione più lontana, con cap a 100 km e padding 10%
  const maxDist = Math.min(Math.max(...avanti.map(s => s.distanza)) * 1.1, 100);

  avanti.forEach(station => {
    const distanza = parseFloat(station.distanza);
    if (isNaN(distanza)) return;

    const barWidth = bar.clientWidth;
    const positionPx = (distanza / maxDist) * barWidth;
    const marker = document.createElement("div");
    const emoji = station.isNearest ? "⚡" : "🔌";
    // Il tooltip mostra tutti i dettagli utili al passaggio del mouse
    marker.innerHTML = `<span title="${station.nome}\n${station.strada}\n→ ${station.direzione}\n${distanza.toFixed(1)} km\nStalli: ${station.colonnine?.length ?? "?"}">${emoji}</span>`;
    marker.style.position = "absolute";
    marker.style.left = `${positionPx}px`;
    marker.style.top = station.isNearest ? "-10px" : "-6px";
    marker.style.transform = "translateX(-50%)";
    marker.style.fontSize = station.isNearest ? "22px" : "18px";
    bar.appendChild(marker);
  });
}

/**
 * Ricostruisce la tabella HTML #stations-table con la lista delle stazioni
 * correnti (già filtrate e ordinate per distanza da updateColonnine).
 */
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
