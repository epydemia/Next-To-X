// Statistiche anonime con GoatCounter (https://www.goatcounter.com): niente cookie, niente
// script di terzi nella pagina. Le richieste le costruiamo qui, quindi parte solo quello che
// si vede in questo file: nessuna posizione, nessun nome di stazione, nessun identificativo.
// Si disattivano dalle impostazioni, con "Do Not Track" e in sviluppo locale.

const CONTATORE = 'https://nexttox.goatcounter.com/count';
const CHIAVE_PREFERENZA = 'statisticheAnonime';
const HOST_LOCALI = new Set(['localhost', '127.0.0.1', '']);

// In simulazione i dati di guida (stazioni proposte, tocchi) non sono reali: non si contano
let simulazione = false;

export function segnaSimulazione(attiva) {
  simulazione = attiva;
}

export function statisticheAttive() {
  try {
    return localStorage.getItem(CHIAVE_PREFERENZA) !== '0';
  } catch {
    return true;
  }
}

export function impostaStatistiche(attive) {
  try {
    localStorage.setItem(CHIAVE_PREFERENZA, attive ? '1' : '0');
  } catch { /* preferenza non salvabile (es. navigazione privata): vale per questa sessione */ }
}

function consentite() {
  return statisticheAttive() && navigator.doNotTrack !== '1' && !HOST_LOCALI.has(location.hostname);
}

function invia(parametri) {
  if (!consentite()) return;
  const query = new URLSearchParams({ ...parametri, rnd: Math.random().toString(36).slice(2) });
  // Una richiesta di immagine, come il "pixel" di GoatCounter: niente cookie
  new Image().src = `${CONTATORE}?${query}`;
}

/** Visita di una pagina, con un percorso fisso (non l'URL reale). */
export function contaPagina(percorso, titolo) {
  invia({ p: percorso, t: titolo });
}

/** Evento: "nome" è il percorso con cui compare in GoatCounter, es. "prossima/IT/ionity".
 *  guida: evento che descrive l'uso alla guida, ignorato in simulazione. */
export function contaEvento(nome, titolo = nome, { guida = false } = {}) {
  if (guida && simulazione) return;
  invia({ p: nome, t: titolo, e: 'true' });
}

/** "Free To X, Tesla" → "free-to-x+tesla". */
export function slugOperatori(operatori) {
  const slug = (operatori || '').split(',')
    .map(o => o.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean).join('+');
  return slug || 'sconosciuto';
}
