import { caricaAree } from '../core/dati.js';
import { AUTOSTRADE, estraiCodice } from '../core/autostrade.js';

// Panoramica: per un'autostrada mostra le stazioni sulle due carreggiate,
// posizionate secondo la progressiva chilometrica.

function popolaSelect(autostrade) {
  const select = document.getElementById('autostradaSelect');
  autostrade.forEach(nome => select.add(new Option(nome, nome)));
}

/** Direzioni delle due carreggiate, es. "NORD-SUD" → ["NORD", "SUD"]; null se non noto. */
function carreggiate(autostrada) {
  const asse = AUTOSTRADE[estraiCodice(autostrada)]?.asse;
  return asse ? asse.split('-') : null;
}

function disegnaBarra(aree, autostrada) {
  const barraSopra = document.getElementById('visual-bar-top');
  const barraSotto = document.getElementById('visual-bar-bottom');
  barraSopra.innerHTML = '';
  barraSotto.innerHTML = '';

  // "A14 BOLOGNA-TARANTO" → "BOLOGNA" … "TARANTO"
  const [inizio, fine] = autostrada.replace(/^A\d+\s*/, '').split('-').map(s => s.trim());
  document.getElementById('label-inizio').textContent = inizio || 'Inizio';
  document.getElementById('label-fine').textContent = fine || 'Fine';

  const stazioni = aree.filter(a => a.strada === autostrada && typeof a.km === 'number');
  const direzioni = carreggiate(autostrada);
  if (stazioni.length === 0 || !direzioni) return;

  const minKm = Math.min(...stazioni.map(a => a.km));
  const intervallo = Math.max(...stazioni.map(a => a.km)) - minKm || 1;

  stazioni.forEach(a => {
    const barra = a.direzione_geografica === direzioni[0] ? barraSopra
                : a.direzione_geografica === direzioni[1] ? barraSotto
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
  const aree = await caricaAree();
  const autostrade = [...new Set(aree.map(a => a.strada).filter(Boolean))].sort();
  popolaSelect(autostrade);
  disegnaBarra(aree, autostrade[0]);
  document.getElementById('autostradaSelect').addEventListener('change', e => disegnaBarra(aree, e.target.value));
});
