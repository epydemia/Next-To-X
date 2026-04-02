// Cache in memoria delle aree caricate: evita fetch ripetuti durante la sessione
let cachedAree = null;

/**
 * Carica e restituisce l'elenco combinato di tutte le aree di servizio con colonnine.
 * I dati provengono da tre sorgenti JSON:
 *   - free_to_x_reverse.json: dataset principale (colonnine Free To X sulle autostrade)
 *   - test.json: dataset aggiuntivo per sviluppo/test
 *   - a22_brennero_geocoded.json: colonnine A22 Brennero
 *
 * Le tre sorgenti vengono caricate indipendentemente con try/catch separati,
 * così un errore su una non blocca le altre. Il risultato è unificato in un
 * unico array piatto e memorizzato in cache per le chiamate successive.
 */
export async function getAree() {

  if (cachedAree) return cachedAree;

  let dataFreeToX = { listaAree: [] };
  let dataTest = { listaAree: [] };
  let dataA22 = { listaAree: [] };

  try {
    console.log("Caricamento del file free_to_x_reverse.json...");
    const resFreeToX = await fetch('./data/free_to_x_reverse.json');
    if (!resFreeToX.ok) throw new Error("Errore nel caricamento del file free_to_x_reverse.json");
    dataFreeToX = await resFreeToX.json();
    console.log("File free_to_x_reverse.json caricato con successo.");
  } catch (err) {
    console.error("❌ Errore nel caricamento del file free_to_x_reverse.json:", err);
  }

  try {
    console.log("Caricamento del file test.json...");
    const resTest = await fetch('./data/test.json');
    if (!resTest.ok) throw new Error("Errore nel caricamento del file test.json");
    dataTest = await resTest.json();
    console.log("File test.json caricato con successo.");
  } catch (err) {
    console.error("❌ Errore nel caricamento del file test.json:", err);
  }

  try {
    console.log("Caricamento del file a22_brennero_geocoded.json...");
    const resA22 = await fetch('./data/a22_brennero_geocoded.json');
    if (!resA22.ok) throw new Error("Errore nel caricamento del file a22_brennero_geocoded.json");
    dataA22 = await resA22.json();
    console.log("File a22_brennero_geocoded.json caricato con successo.");
  } catch (err) {
    console.error("❌ Errore nel caricamento del file a22_brennero_geocoded.json:", err);
  }

  // Unisce i tre dataset in un unico array e lo mette in cache
  cachedAree = [
    ...(dataFreeToX.listaAree || []),
    ...(dataTest.listaAree || []),
    ...(dataA22.listaAree || [])
  ];

  return cachedAree;
}
