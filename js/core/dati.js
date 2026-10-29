import { CARTELLA_DATI, SORGENTI_DATI, FILE_REVISIONI } from '../config.js';

/**
 * Carica tutte le sorgenti JSON in parallelo. Una sorgente che fallisce viene
 * registrata in console e restituita vuota, senza bloccare le altre.
 * Gli oggetti area restano quelli originali del JSON, così l'editor può
 * modificarli e risalvarli tali e quali.
 *
 * @returns {Promise<Array<{chiave, file, label, aree, json}>>}  json: il file originale intero
 */
export async function caricaSorgenti() {
  return Promise.all(
    Object.entries(SORGENTI_DATI).map(async ([chiave, sorgente]) => {
      try {
        const res = await fetch(CARTELLA_DATI + sorgente.file);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        return { chiave, ...sorgente, aree: json.listaAree ?? [], json };
      } catch (err) {
        console.error(`Errore caricamento ${sorgente.file}:`, err);
        return { chiave, ...sorgente, aree: [], json: {} };
      }
    })
  );
}

/**
 * Correzioni ai dati: { [idArea]: { esito?, direzione_geografica?, nota?, data } }.
 * esito ("area_servizio" | "uscita" | "esclusa") viene dalla revisione manuale,
 * direzione_geografica corregge la carreggiata (es. dal crosscheck con OSM).
 * File assente = nessuna correzione.
 */
export async function caricaRevisioni() {
  try {
    const res = await fetch(CARTELLA_DATI + FILE_REVISIONI);
    if (!res.ok) return {};
    return (await res.json()).revisioni ?? {};
  } catch {
    return {};
  }
}

/** Identificativo stabile di un'area, anche per quelle senza codice nel JSON. */
export function idArea(area) {
  return area.codice != null ? String(area.codice) : `nome:${area.nome}`;
}

/** Copia dell'area con le correzioni applicate, oppure null se esclusa. */
export function applicaRevisione(area, revisione) {
  if (!revisione) return area;
  if (revisione.esito === 'esclusa') return null;
  const corretta = { ...area };
  if (revisione.esito) {
    corretta.exitRequired = revisione.esito === 'uscita';
    corretta.daVerificare = false;
  }
  if (revisione.direzione_geografica) corretta.direzione_geografica = revisione.direzione_geografica;
  return corretta;
}

let cacheAree = null;

/** Tutte le aree di servizio con coordinate valide, da tutte le sorgenti, revisioni applicate. */
export async function caricaAree() {
  if (!cacheAree) {
    const [sorgenti, revisioni] = await Promise.all([caricaSorgenti(), caricaRevisioni()]);
    cacheAree = sorgenti
      .flatMap(s => s.aree)
      .filter(haCoordinate)
      .map(a => applicaRevisione(a, revisioni[idArea(a)]))
      .filter(Boolean);
  }
  return cacheAree;
}

export function haCoordinate(area) {
  return Number.isFinite(area.lat) && Number.isFinite(area.lon);
}
