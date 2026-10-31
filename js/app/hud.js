import { puntoCardinale } from '../core/geo.js';
import { estraiCodice } from '../core/autostrade.js';
import { contaEvento, slugOperatori } from '../statistiche.js';

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

// Schermo in verticale: barra verticale sul bordo della mappa; in orizzontale: nel pannello in basso
const SCHERMO_VERTICALE = matchMedia('(orientation: portrait)');

// Fondo scala della barra e distanza tra le tacche, scelti in base alla stazione più lontana
const SCALE = [
  { km: 10, passo: 5 }, { km: 20, passo: 5 }, { km: 40, passo: 10 },
  { km: 60, passo: 20 }, { km: 80, passo: 20 }, { km: 100, passo: 25 },
];

const FULMINE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></svg>';

const chiaveStazione = s => `${s.nome}|${s.lat}|${s.lon}`;

/** Sposta la barra tra mappa e pannello quando si gira lo schermo; onCambio dopo ogni spostamento. */
export function collegaOrientamentoBarra(onCambio) {
  const contenitore = document.getElementById('distance-bar-container');
  const applica = () => {
    chiudiFumetto();
    const verticale = SCHERMO_VERTICALE.matches;
    contenitore.classList.toggle('verticale', verticale);
    if (verticale) document.getElementById('map-wrapper').appendChild(contenitore);
    else document.getElementById('bottom-panel').prepend(contenitore);
    onCambio?.();
  };
  SCHERMO_VERTICALE.addEventListener('change', applica);
  applica();
}

function elemento(tag, classe, pos) {
  const el = document.createElement(tag);
  el.className = classe;
  if (pos != null) el.style.setProperty('--pos', pos);
  return el;
}

/** Stazioni avanti lungo la barra: la prossima con un'etichetta, le altre come pallini.
 *  Toccandole si apre un fumetto con i dati: l'attributo title non funziona al tocco. */
function aggiornaBarraDistanze(avanti) {
  const barra = document.getElementById('distance-bar');
  barra.innerHTML = '';
  if (avanti.length === 0) return chiudiFumetto();

  const scala = SCALE.find(sc => sc.km >= Math.max(...avanti.map(s => s.distanza)) * 1.1) ?? SCALE.at(-1);
  const pos = km => `${Math.min(km / scala.km, 1) * 100}%`;

  const prossima = avanti.find(s => s.isNearest);
  if (prossima) barra.appendChild(elemento('div', 'bar-percorso', pos(prossima.distanza)));
  for (let km = scala.passo; km <= scala.km; km += scala.passo) {
    const tacca = elemento('div', km === scala.km ? 'bar-tacca bar-tacca--fine' : 'bar-tacca', pos(km));
    tacca.textContent = km;
    barra.appendChild(tacca);
  }

  let ancoraPresente = false;
  avanti.forEach(s => {
    const uscita = s.exitRequired ? ' bar-punto--uscita' : '';
    let comando;
    if (s.isNearest) {
      barra.appendChild(elemento('span', `bar-punto bar-punto--prossima${uscita}`, pos(s.distanza)));
      comando = elemento('button', `bar-etichetta${s.exitRequired ? ' bar-etichetta--uscita' : ''}`, pos(s.distanza));
      comando.innerHTML = `${FULMINE}${Math.round(s.distanza)} km`;
    } else {
      comando = elemento('button', `bar-punto${uscita}`, pos(s.distanza));
    }
    comando.type = 'button';
    comando.setAttribute('aria-label', `${s.nome}, ${s.distanza.toFixed(1)} km`);
    comando.addEventListener('click', e => {
      e.stopPropagation();
      if (fumettoAperto === chiaveStazione(s)) return chiudiFumetto();
      fumettoAperto = chiaveStazione(s);
      contaEvento(`tocco/${s.paese}/${slugOperatori(s.operatore)}`, `Tocco su stazione: ${s.operatore || 'operatore sconosciuto'} (${s.paese})`, { guida: true });
      clearTimeout(timerFumetto);
      timerFumetto = setTimeout(chiudiFumetto, DURATA_FUMETTO_MS);
      mostraFumetto(barra, comando, s, pos(s.distanza));
    });
    barra.appendChild(comando);
    if (fumettoAperto === chiaveStazione(s)) {
      ancoraPresente = true;
      mostraFumetto(barra, comando, s, pos(s.distanza));
    }
  });
  if (!ancoraPresente) chiudiFumetto();
}

function mostraFumetto(barra, ancora, s, pos) {
  barra.querySelector('.bar-tooltip')?.remove();
  const fumetto = elemento('div', 'bar-tooltip', pos);
  fumetto.innerHTML = `
    <strong>${s.nome}</strong>
    <span>${s.strada}${s.direzione ? ` → ${s.direzione}` : ''}</span>
    <span class="bar-tooltip-dist">${s.distanza.toFixed(1)} km${s.exitRequired ? ' · ⚠️ uscita' : ''}</span>
    <span>${s.operatore ? `${s.operatore} · ` : ''}${s.colonnine.length} colonnin${s.colonnine.length === 1 ? 'a' : 'e'}</span>
  `;
  barra.appendChild(fumetto);
  if (SCHERMO_VERTICALE.matches) return;
  // In orizzontale: centrato sulla stazione ma senza uscire dai bordi della barra
  const larghezza = barra.clientWidth;
  const meta = fumetto.offsetWidth / 2;
  fumetto.style.left = `${Math.min(Math.max(ancora.offsetLeft, meta), Math.max(larghezza - meta, meta))}px`;
}

function chiudiFumetto() {
  fumettoAperto = null;
  clearTimeout(timerFumetto);
  document.querySelector('#distance-bar .bar-tooltip')?.remove();
}

// Su iOS un tocco su un elemento non cliccabile non genera "click": si ascolta anche touchstart
['click', 'touchstart'].forEach(evento => document.addEventListener(evento, e => {
  if (fumettoAperto && !e.target.closest('.bar-tooltip, .bar-punto, .bar-etichetta')) chiudiFumetto();
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
