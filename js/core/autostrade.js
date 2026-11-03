/**
 * Autostrade italiane: nomi con cui Nominatim può restituirle e asse principale
 * (usato dalla panoramica per separare le due carreggiate).
 */
export const AUTOSTRADE = {
  A1:  { nomi: ['Milano Napoli', 'Autostrada del Sole'],              asse: 'NORD-SUD' },
  A2:  { nomi: ['Salerno Reggio Calabria', 'Autostrada del Mediterraneo'], asse: 'NORD-SUD' },
  A3:  { nomi: ['Napoli Salerno'],                                     asse: 'NORD-SUD' },
  A4:  { nomi: ['Torino Trieste', 'Serenissima'],                      asse: 'EST-OVEST' },
  A5:  { nomi: ['Torino Aosta Monte Bianco', "Autostrada della Valle d'Aosta"], asse: 'NORD-SUD' },
  A6:  { nomi: ['Torino Savona'],                                      asse: 'NORD-SUD' },
  A7:  { nomi: ['Milano Genova', 'Autostrada dei Giovi'],              asse: 'NORD-SUD' },
  A8:  { nomi: ['Milano Varese', 'Autostrada dei Laghi'],              asse: 'NORDOVEST-SUDEST' },
  A9:  { nomi: ['Lainate Chiasso', 'Autostrada dei Laghi'],            asse: 'NORDOVEST-SUDEST' },
  A10: { nomi: ['Genova Ventimiglia', 'Autostrada dei Fiori'],         asse: 'EST-OVEST' },
  A11: { nomi: ['Firenze Pisa', 'Firenze Mare'],                       asse: 'EST-OVEST' },
  A12: { nomi: ['Genova Roma', 'Autostrada Tirrenica', 'Autostrada Azzurra'], asse: 'NORDOVEST-SUDEST' },
  A13: { nomi: ['Bologna Padova'],                                     asse: 'NORD-SUD' },
  A14: { nomi: ['Bologna Taranto', 'Autostrada Adriatica'],            asse: 'NORD-SUD' },
  A15: { nomi: ['Parma La Spezia', 'Autostrada della Cisa'],           asse: 'NORD-SUD' },
  A16: { nomi: ['Napoli Canosa', 'Autostrada dei Due Mari'],           asse: 'EST-OVEST' },
  A17: { nomi: ['Bari Napoli (storica)'],                              asse: 'EST-OVEST' },
  A18: { nomi: ['Messina Catania', 'Siracusa Rosolini'],               asse: 'NORD-SUD' },
  A19: { nomi: ['Palermo Catania'],                                    asse: 'NORD-SUD' },
  A20: { nomi: ['Messina Palermo'],                                    asse: 'EST-OVEST' },
  A21: { nomi: ['Torino Brescia', 'Autostrada dei Vini'],              asse: 'EST-OVEST' },
  A22: { nomi: ['Modena Brennero', 'Autostrada del Brennero'],         asse: 'NORD-SUD' },
  A23: { nomi: ['Palmanova Tarvisio'],                                 asse: 'NORD-SUD' },
  A24: { nomi: ['Roma Teramo', 'Autostrada dei Parchi'],               asse: 'EST-OVEST' },
  A25: { nomi: ['Torano Pescara', 'Autostrada dei Parchi'],            asse: 'EST-OVEST' },
  A26: { nomi: ['Voltri Gravellona Toce', 'Autostrada dei Trafori'],   asse: 'NORD-SUD' },
  A27: { nomi: ['Mestre Belluno'],                                     asse: 'NORD-SUD' },
  A28: { nomi: ['Portogruaro Conegliano'],                             asse: 'EST-OVEST' },
  A29: { nomi: ['Palermo Mazara del Vallo', 'Autostrada del Sale'],    asse: 'EST-OVEST' },
  A31: { nomi: ['Autostrada della Valdastico'],                        asse: 'NORD-SUD' },
  A32: { nomi: ['Autostrada del Frejus'],                              asse: 'EST-OVEST' },
  A33: { nomi: ['Autostrada Asti Cuneo'],                              asse: 'NORDEST-SUDOVEST' },
  A56: { nomi: ['Tangenziale di Napoli'],                              asse: 'EST-OVEST' },
  SPV: { nomi: ['Pedemontana Veneta'],                                 asse: 'EST-OVEST' },
};

// "Autostrada Bologna-Padova" e "Bologna Padova" devono coincidere
const normalizzaNome = s => (s ?? '').toLowerCase().replace(/[-–—]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Codice autostrada (es. "A14") dal nome di strada restituito dal reverse geocoding,
 * oppure null. Confronto case-insensitive per sottostringa, perché Nominatim può
 * restituire nomi parziali o con parole in più.
 */
export function codiceDaNomeStrada(nomeStrada) {
  const normalizzato = normalizzaNome(nomeStrada);
  if (!normalizzato) return null;
  for (const [codice, { nomi }] of Object.entries(AUTOSTRADE)) {
    if (nomi.some(n => normalizzato.includes(normalizzaNome(n)))) return codice;
  }
  return null;
}

// Sigle di autostrade e raccordi: A14, A1DIR, A1VAR, RA3 (raccordi italiani), S6 (Austria),
// T4 (trafori), SPV (Pedemontana Veneta). Non le strade statali (SS16) o le europee (E45)
const SIGLA_AUTOSTRADALE = /^(?:(?:A|RA|S|T)\d+[A-Z]*|SPV)$/;

/**
 * Sigle autostradali in un testo, nella forma usata da tutte le fonti (maiuscole, senza spazi).
 * "A14 Bologna-Taranto" → ["A14"], "A 7;E 45" → ["A7"], "A11/A12" → ["A11", "A12"],
 * "A1dir" → ["A1DIR"], "RA 3" → ["RA3"], "SS16" → [].
 */
export function codiciAutostradali(testo) {
  return (testo ?? '').toUpperCase()
    .replace(/\b([A-Z]{1,3})\s+(?=\d)/g, '$1')  // "A 7" → "A7", "RA 3" → "RA3"
    .split(/[\s;,/]+/)
    .filter(t => SIGLA_AUTOSTRADALE.test(t));
}

/** La prima sigla autostradale di un testo, oppure null. */
export function estraiCodice(testo) {
  return codiciAutostradali(testo)[0] ?? null;
}
