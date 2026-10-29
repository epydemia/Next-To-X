import { CARTELLA_DATI, SORGENTI_DATI } from '../config.js';

/**
 * Carica tutte le sorgenti JSON in parallelo. Una sorgente che fallisce viene
 * registrata in console e restituita vuota, senza bloccare le altre.
 * Gli oggetti area restano quelli originali del JSON, così l'editor può
 * modificarli e risalvarli tali e quali.
 *
 * @returns {Promise<Array<{chiave, file, label, aree}>>}
 */
export async function caricaSorgenti() {
  return Promise.all(
    Object.entries(SORGENTI_DATI).map(async ([chiave, sorgente]) => {
      try {
        const res = await fetch(CARTELLA_DATI + sorgente.file);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        return { chiave, ...sorgente, aree: json.listaAree ?? [] };
      } catch (err) {
        console.error(`Errore caricamento ${sorgente.file}:`, err);
        return { chiave, ...sorgente, aree: [] };
      }
    })
  );
}

let cacheAree = null;

/** Tutte le aree di servizio con coordinate valide, da tutte le sorgenti. */
export async function caricaAree() {
  if (!cacheAree) {
    const sorgenti = await caricaSorgenti();
    cacheAree = sorgenti.flatMap(s => s.aree).filter(haCoordinate);
  }
  return cacheAree;
}

export function haCoordinate(area) {
  return Number.isFinite(area.lat) && Number.isFinite(area.lon);
}
