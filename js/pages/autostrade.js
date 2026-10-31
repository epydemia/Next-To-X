import { caricaAree, nomeStrada } from '../core/dati.js';
import { AUTOSTRADE } from '../core/autostrade.js';
import { stessaDirezione } from '../core/geo.js';
import { contaPagina } from '../statistiche.js';

// Panoramica: per un'autostrada mostra le stazioni sulle due carreggiate,
// posizionate secondo la progressiva chilometrica (solo le fonti che la forniscono).

const ANGOLI = { NORD: 0, NORDEST: 45, EST: 90, SUDEST: 135, SUD: 180, SUDOVEST: 225, OVEST: 270, NORDOVEST: 315 };

function popolaSelect(autostrade) {
  const select = document.getElementById('autostradaSelect');
  autostrade.forEach(nome => select.add(new Option(nome, nome)));
}

/** Direzioni delle due carreggiate, es. "NORD-SUD" → ["NORD", "SUD"]; null se non noto. */
function carreggiate(sigla) {
  const asse = AUTOSTRADE[sigla]?.asse;
  return asse ? asse.split('-') : null;
}

function disegnaBarra(aree, strada) {
  const barraSopra = document.getElementById('visual-bar-top');
  const barraSotto = document.getElementById('visual-bar-bottom');
  barraSopra.innerHTML = '';
  barraSotto.innerHTML = '';

  const stazioni = aree.filter(a => nomeStrada(a) === strada && typeof a.km === 'number');
  // "Milano-Napoli" → "Milano" … "Napoli"
  const [inizio, fine] = (stazioni[0]?.tratta ?? '').split('-').map(s => s.trim());
  document.getElementById('label-inizio').textContent = inizio || 'Inizio';
  document.getElementById('label-fine').textContent = fine || 'Fine';

  const direzioni = carreggiate(stazioni[0]?.autostrada);
  if (stazioni.length === 0 || !direzioni) return;

  const minKm = Math.min(...stazioni.map(a => a.km));
  const intervallo = Math.max(...stazioni.map(a => a.km)) - minKm || 1;

  stazioni.forEach(a => {
    // Carreggiata della stazione (es. NORDOVEST) assegnata alla corsia con direzione compatibile
    const barra = !a.carreggiata ? null
                : stessaDirezione(a.carreggiata, ANGOLI[direzioni[0]]) ? barraSopra
                : stessaDirezione(a.carreggiata, ANGOLI[direzioni[1]]) ? barraSotto
                : null;
    if (!barra) return;
    const marker = document.createElement('div');
    marker.className = 'marker-icon';
    marker.style.left = `calc(${((a.km - minKm) / intervallo) * 100}% - 8px)`;
    marker.title = `${a.nome} (km ${a.km})`;
    barra.appendChild(marker);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  contaPagina('/autostrade', 'Panoramica autostrade');
  const aree = await caricaAree();
  const strade = [...new Set(aree.filter(a => typeof a.km === 'number').map(nomeStrada).filter(Boolean))].sort();
  popolaSelect(strade);
  disegnaBarra(aree, strade[0]);
  document.getElementById('autostradaSelect').addEventListener('change', e => disegnaBarra(aree, e.target.value));
});
