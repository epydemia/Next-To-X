import { puntoCardinale } from '../core/geo.js';
import { estraiCodice } from '../core/autostrade.js';

// Tutto ciò che nell'app di guida non è mappa: HUD, pannelli, barra distanze, tabella.

export function collegaPannelli() {
  const opzioni = document.getElementById('options-panel');
  document.getElementById('options-toggle').addEventListener('click', () => opzioni.classList.toggle('open'));
  document.getElementById('options-close').addEventListener('click', () => opzioni.classList.remove('open'));

  const lista = document.getElementById('stations-list');
  const chevron = document.getElementById('stations-chevron');
  document.getElementById('stations-toggle-btn').addEventListener('click', () => {
    lista.hidden = !lista.hidden;
    chevron.classList.toggle('open', !lista.hidden);
  });
}

export function mostraStrada({ strada, codiceAutostrada }) {
  if (!strada) return;
  const testo = codiceAutostrada && estraiCodice(strada) !== codiceAutostrada
    ? `${codiceAutostrada} – ${strada}`
    : strada;
  document.getElementById('strada').textContent = `🛣️ ${testo}`;
}

export function mostraAvvisoGps() {
  document.getElementById('strada').textContent = '⚠️ GPS non disponibile — attiva la posizione';
}

/** L'asterisco indica un heading stimato dallo spostamento anziché letto dal dispositivo. */
export function mostraDirezione({ heading, headingStimato }) {
  document.getElementById('direzione').textContent =
    `🧭 ${heading.toFixed(0)}°${headingStimato ? '*' : ''} (${puntoCardinale(heading)})`;
}

export function aggiornaPannelli(stazioni) {
  mostraProssimaStazione(stazioni.find(s => s.isNearest));
  aggiornaBarraDistanze(stazioni.filter(s => s.isAvanti));
  aggiornaTabella(stazioni);
}

function mostraProssimaStazione(s) {
  const pannello = document.getElementById('next-station');
  if (!s) {
    pannello.innerHTML = '<span class="next-station-info">–</span>';
    return;
  }
  const dettaglio = s.exitRequired
    ? '<span class="next-station-exit">⚠️ uscita</span>'
    : s.direzione ? `<span class="next-station-dir">→ ${s.direzione}</span>` : '';
  pannello.innerHTML = `
    <span class="next-station-name">${s.nome}</span>
    ${dettaglio}
    <span class="next-station-dist">${s.distanza.toFixed(1)} km</span>
  `;
}

/** Icone delle stazioni avanti, posizionate in proporzione alla distanza (scala max 100 km). */
function aggiornaBarraDistanze(avanti) {
  const barra = document.getElementById('distance-bar');
  barra.innerHTML = '';
  if (avanti.length === 0) return;

  const scalaKm = Math.min(Math.max(...avanti.map(s => s.distanza)) * 1.1, 100);
  avanti.forEach(s => {
    const icona = document.createElement('span');
    icona.className = s.isNearest ? 'bar-station bar-station--next' : 'bar-station';
    icona.textContent = s.isNearest ? '⚡' : '🔌';
    icona.title = [s.nome, s.strada, s.direzione && `→ ${s.direzione}`, `${s.distanza.toFixed(1)} km`, `Stalli: ${s.colonnine.length}`]
      .filter(Boolean).join('\n');
    icona.style.left = `${Math.min(s.distanza / scalaKm, 1) * 100}%`;
    barra.appendChild(icona);
  });
}

function aggiornaTabella(stazioni) {
  const tbody = document.querySelector('#stations-table tbody');
  tbody.innerHTML = '';
  stazioni.forEach(s => {
    const riga = document.createElement('tr');
    riga.innerHTML = `
      <td>${s.nome}</td>
      <td class="td-road">${s.strada}</td>
      <td class="${s.exitRequired ? 'td-exit' : 'td-dist'}">${s.exitRequired ? '⚠️ ' : ''}${s.distanza.toFixed(1)} km</td>
    `;
    tbody.appendChild(riga);
  });

  const n = stazioni.length;
  document.getElementById('stations-count-label').textContent =
    n === 0 ? 'Nessuna stazione' : `${n} stazion${n === 1 ? 'e' : 'i'}`;
}
