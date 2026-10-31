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

// Stazione di cui è aperto il fumetto nella barra: sopravvive al ridisegno a ogni posizione GPS
let fumettoAperto = null;
let timerFumetto = null;
const DURATA_FUMETTO_MS = 6000;

const chiaveStazione = s => `${s.nome}|${s.lat}|${s.lon}`;

/** Icone delle stazioni avanti, posizionate in proporzione alla distanza (scala max 100 km).
 *  Toccando un'icona si apre un fumetto con i dati: l'attributo title non funziona al tocco. */
function aggiornaBarraDistanze(avanti) {
  const barra = document.getElementById('distance-bar');
  barra.innerHTML = '';
  if (avanti.length === 0) return chiudiFumetto();

  const scalaKm = Math.min(Math.max(...avanti.map(s => s.distanza)) * 1.1, 100);
  let ancoraPresente = false;
  avanti.forEach(s => {
    const icona = document.createElement('button');
    icona.type = 'button';
    icona.className = s.isNearest ? 'bar-station bar-station--next' : 'bar-station';
    icona.textContent = s.isNearest ? '⚡' : '🔌';
    icona.setAttribute('aria-label', `${s.nome}, ${s.distanza.toFixed(1)} km`);
    icona.style.left = `${Math.min(s.distanza / scalaKm, 1) * 100}%`;
    icona.addEventListener('click', e => {
      e.stopPropagation();
      if (fumettoAperto === chiaveStazione(s)) return chiudiFumetto();
      fumettoAperto = chiaveStazione(s);
      clearTimeout(timerFumetto);
      timerFumetto = setTimeout(chiudiFumetto, DURATA_FUMETTO_MS);
      mostraFumetto(barra, icona, s);
    });
    barra.appendChild(icona);
    if (fumettoAperto === chiaveStazione(s)) {
      ancoraPresente = true;
      mostraFumetto(barra, icona, s);
    }
  });
  if (!ancoraPresente) chiudiFumetto();
}

function mostraFumetto(barra, icona, s) {
  barra.querySelector('.bar-tooltip')?.remove();
  const fumetto = document.createElement('div');
  fumetto.className = 'bar-tooltip';
  fumetto.innerHTML = `
    <strong>${s.nome}</strong>
    <span>${s.strada}${s.direzione ? ` → ${s.direzione}` : ''}</span>
    <span class="bar-tooltip-dist">${s.distanza.toFixed(1)} km${s.exitRequired ? ' · ⚠️ uscita' : ''}</span>
    <span>${s.operatore ? `🔌 ${s.operatore} · ` : ''}${s.colonnine.length} colonnin${s.colonnine.length === 1 ? 'a' : 'e'}</span>
  `;
  barra.appendChild(fumetto);
  // Centrato sull'icona ma senza uscire dai bordi della barra
  const larghezza = barra.clientWidth;
  const meta = fumetto.offsetWidth / 2;
  const centro = icona.offsetLeft;
  fumetto.style.left = `${Math.min(Math.max(centro, meta), Math.max(larghezza - meta, meta))}px`;
}

function chiudiFumetto() {
  fumettoAperto = null;
  clearTimeout(timerFumetto);
  document.querySelector('#distance-bar .bar-tooltip')?.remove();
}

// Su iOS un tocco su un elemento non cliccabile non genera "click": si ascolta anche touchstart
['click', 'touchstart'].forEach(evento => document.addEventListener(evento, e => {
  if (fumettoAperto && !e.target.closest('.bar-tooltip, .bar-station')) chiudiFumetto();
}, { passive: true }));

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
