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
 * Decisioni della revisione manuale: { [idArea]: { esito, data } }, dove esito è
 * "area_servizio", "uscita" o "esclusa". File assente = nessuna revisione.
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

/** Copia dell'area con la decisione manuale applicata, oppure null se esclusa. */
export function applicaRevisione(area, revisione) {
  if (!revisione) return area;
  if (revisione.esito === 'esclusa') return null;
  return { ...area, exitRequired: revisione.esito === 'uscita', daVerificare: false };
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
