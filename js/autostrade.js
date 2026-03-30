import { getAree } from './dataloader.js';

/**
 * Estrae l'elenco univoco e ordinato dei nomi delle autostrade presenti nel dataset.
 * Usato per popolare il <select> nella pagina di visualizzazione statica.
 */
function getAutostrade(aree) {
  const set = new Set(aree.map(a => a.strada).filter(Boolean));
  return Array.from(set).sort();
}

/**
 * Popola il <select id="autostradaSelect"> con le opzioni delle autostrade disponibili.
 */
function creaSelect(options) {
  const select = document.getElementById('autostradaSelect');
  options.forEach(opt => {
    const o = document.createElement('option');
    o.value = o.textContent = opt;
    select.appendChild(o);
  });
}

/**
 * Aggiorna la barra visiva delle colonnine per un'autostrada selezionata.
 *
 * La barra è divisa in due corsie (barTop / barBottom) che rappresentano
 * le due carreggiate dell'autostrada. Le stazioni vengono distribuite
 * orizzontalmente in base al loro valore `km` (progressiva chilometrica),
 * scalato sull'intervallo [minKm, maxKm] della singola autostrada.
 *
 * Le etichette di inizio/fine vengono estratte dal nome dell'autostrada
 * (es. "A14 BOLOGNA-TARANTO" → "BOLOGNA" e "TARANTO").
 */
function aggiornaVisualBar(aree, autostrada) {

  /**
   * Restituisce l'asse principale di un'autostrada (es. "NORD-SUD", "EST-OVEST"),
   * usato per assegnare le direzioni alle due corsie della barra.
   * Tricky: il codice viene estratto dal nome dell'autostrada con una regex
   * perché il campo può contenere anche il tratto (es. "A14 BOLOGNA-TARANTO").
   */
  function getAsse(autostrada) {
    const direzioni_autostrade = {
      "A1": "NORD-SUD", "A2": "NORD-SUD", "A3": "NORD-SUD", "A4": "EST-OVEST",
      "A5": "NORD-SUD", "A6": "NORD-SUD", "A7": "NORD-SUD", "A8": "NORDOVEST-SUDEST",
      "A9": "NORDOVEST-SUDEST", "A10": "EST-OVEST", "A11": "EST-OVEST", "A12": "NORDOVEST-SUDEST",
      "A13": "NORD-SUD", "A14": "NORD-SUD", "A15": "NORD-SUD", "A16": "EST-OVEST",
      "A17": "EST-OVEST", "A18": "NORD-SUD", "A19": "NORD-SUD", "A20": "EST-OVEST",
      "A21": "EST-OVEST", "A22": "NORD-SUD", "A23": "NORD-SUD", "A24": "EST-OVEST",
      "A25": "EST-OVEST", "A26": "NORD-SUD", "A27": "NORD-SUD", "A28": "EST-OVEST",
      "A29": "EST-OVEST"
    };
    const codice = autostrada.match(/A\d+/)?.[0];
    return direzioni_autostrade[codice] || "ND";
  }

  const container = document.getElementById('visual-bar-container');
  if (!container) return;
  const labelStart = document.getElementById("label-inizio");
  const labelEnd = document.getElementById("label-fine");
  if (labelStart) labelStart.textContent = '';
  if (labelEnd) labelEnd.textContent = '';
  const barTop = container.querySelector('#visual-bar-top');
  const barBottom = container.querySelector('#visual-bar-bottom');
  if (!barTop || !barBottom) return;

  barTop.innerHTML = '';
  barBottom.innerHTML = '';

  // Considera solo le stazioni dell'autostrada selezionata con km valido
  const filtered = aree.filter(a => a.strada === autostrada && typeof a.km === 'number');
  if (filtered.length === 0) return;

  const minKm = Math.min(...filtered.map(a => a.km));
  const maxKm = Math.max(...filtered.map(a => a.km));

  // Estrai le città di inizio e fine dal nome (es. "A14 BOLOGNA-TARANTO" → ["BOLOGNA", "TARANTO"])
  const autostradaLabel = autostrada.replace(/^A\d+\s*/, '');
  const [inizio, fine] = autostradaLabel.split('-').map(s => s.trim());
  if (labelStart) labelStart.textContent = inizio || 'Inizio';
  if (labelEnd) labelEnd.textContent = fine || 'Fine';

  // Evita divisione per zero se tutte le stazioni sono allo stesso km
  const range = maxKm - minKm || 1;

  const asse = getAsse(autostrada);

  // Mappa l'asse dell'autostrada alle direzioni geografiche delle due corsie:
  // barTop = corsia "principale" (prima direzione), barBottom = opposta
  let direzioniTop, direzioniBottom;
  switch (asse) {
    case "EST-OVEST":
      direzioniTop = ["EST"];
      direzioniBottom = ["OVEST"];
      break;
    case "NORD-SUD":
      direzioniTop = ["NORD"];
      direzioniBottom = ["SUD"];
      break;
    case "NORDOVEST-SUDEST":
      direzioniTop = ["NORDOVEST"];
      direzioniBottom = ["SUDEST"];
      break;
    case "NORDEST-SUDOVEST":
      direzioniTop = ["NORDEST"];
      direzioniBottom = ["SUDOVEST"];
      break;
    default:
      // Asse non determinato: non posizionare nella barra
      direzioniTop = [];
      direzioniBottom = [];
  }

  filtered.forEach(a => {
    // Posizione orizzontale in percentuale rispetto all'intervallo km dell'autostrada
    const pos = ((a.km - minKm) / range) * 100;
    const marker = document.createElement('div');
    marker.className = 'marker-icon';
    marker.style.left = `calc(${pos}% - 8px)`;
    marker.title = `${a.nome} (km ${a.km})`;

    // Inserisce il marker nella corsia corretta in base alla direzione geografica della stazione
    if (direzioniTop.includes(a.direzione_geografica)) {
      barTop.appendChild(marker);
    } else if (direzioniBottom.includes(a.direzione_geografica)) {
      barBottom.appendChild(marker);
    }
    // Stazioni con direzione ND o non corrispondente non vengono visualizzate
  });
}

// Inizializzazione al caricamento del DOM
document.addEventListener('DOMContentLoaded', async () => {
  const aree = await getAree();
  const autostrade = getAutostrade(aree);
  creaSelect(autostrade);
  // Mostra subito la barra per la prima autostrada della lista
  aggiornaVisualBar(aree, autostrade[0]);
  document.getElementById('autostradaSelect').addEventListener('change', e => {
    aggiornaVisualBar(aree, e.target.value);
  });
});
