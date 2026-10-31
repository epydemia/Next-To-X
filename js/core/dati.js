import { CARTELLA_DATI, FILE_AREE, FILE_REVISIONI } from '../config.js';

// Le aree vengono da data/aree.json, compilato da tools/Compila_Aree.py (formato descritto
// in cima a quello script). Le revisioni (data/revisioni.json) sono applicate qui al
// caricamento, partendo dai valori originali: così una revisione salvata dall'editor ha
// effetto subito, senza ricompilare, e annullarla ripristina davvero il dato di partenza.

async function leggiJson(file) {
  const res = await fetch(CARTELLA_DATI + file);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Correzioni ai dati: { [chiave]: { esito?, direzione_geografica?, lat?, lon?, nota?, data } }.
 * La chiave è l'id dell'area o uno dei suoi codiciOrigine. esito: "area_servizio" | "uscita" | "esclusa".
 * File assente = nessuna correzione.
 */
export async function caricaRevisioni() {
  try {
    return (await leggiJson(FILE_REVISIONI)).revisioni ?? {};
  } catch {
    return {};
  }
}

/** Aree come escono dalle fonti, senza le correzioni che la compilazione aveva già applicato. */
export async function caricaAreeOriginali() {
  const { aree } = await leggiJson(FILE_AREE);
  return aree.map(originale);
}

export function originale(area) {
  const o = { ...area, correzioni: {}, esclusa: false };
  const c = area.correzioni ?? {};
  if (c.accesso) o.accesso = c.accesso.da;
  if (c.carreggiata) o.carreggiata = c.carreggiata.da;
  if (c.posizione) [o.lat, o.lon] = c.posizione.da;
  return o;
}

export function chiaviArea(area) {
  return [area.id, ...(area.codiciOrigine ?? [])];
}

/** { chiave, revisione } della revisione che riguarda l'area, oppure null. */
export function revisioneDi(revisioni, area) {
  const chiave = chiaviArea(area).find(k => revisioni[k]);
  return chiave ? { chiave, revisione: revisioni[chiave] } : null;
}

/** Copia dell'area con la revisione applicata; i valori sostituiti finiscono in correzioni. */
export function applicaRevisione(area, revisione) {
  if (!revisione) return area;
  const r = { ...area, correzioni: { ...area.correzioni } };
  // "nota" spiega la correzione di carreggiata (es. "crosscheck OSM"); esito e posizione
  // vengono dall'editor e riportano la data della revisione
  const notaManuale = revisione.data ? `revisione del ${revisione.data}` : 'revisione';
  if (revisione.esito === 'esclusa') r.esclusa = true;
  else if (revisione.esito && revisione.esito !== r.accesso) {
    r.correzioni.accesso = { da: r.accesso, nota: notaManuale };
    r.accesso = revisione.esito;
  }
  if (revisione.direzione_geografica && revisione.direzione_geografica !== r.carreggiata) {
    r.correzioni.carreggiata = { da: r.carreggiata, nota: revisione.nota || notaManuale };
    r.carreggiata = revisione.direzione_geografica;
  }
  if (revisione.lat != null && revisione.lon != null) {
    r.correzioni.posizione = { da: [r.lat, r.lon], nota: notaManuale };
    r.lat = revisione.lat;
    r.lon = revisione.lon;
  }
  return r;
}

let cacheAree = null;

/** Aree pronte per l'app: revisioni applicate, escluse tolte. */
export async function caricaAree() {
  if (!cacheAree) {
    const [aree, revisioni] = await Promise.all([caricaAreeOriginali(), caricaRevisioni()]);
    cacheAree = aree
      .map(a => applicaRevisione(a, revisioneDi(revisioni, a)?.revisione))
      .filter(a => !a.esclusa && Number.isFinite(a.lat) && Number.isFinite(a.lon));
  }
  return cacheAree;
}

/** "A1 Milano-Napoli", "A7", oppure null. */
export function nomeStrada(area) {
  return [area.autostrada, area.tratta].filter(Boolean).join(' ') || null;
}
