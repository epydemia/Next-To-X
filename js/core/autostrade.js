/**
 * Autostrade italiane: nomi con cui Nominatim può restituirle e asse principale
 * (usato dalla panoramica per separare le due carreggiate).
 */
export const AUTOSTRADE = {
  A1:  { nomi: ['Milano Napoli', 'Autostrada del Sole'],              asse: 'NORD-SUD' },
  A2:  { nomi: ['Salerno Reggio Calabria', 'Autostrada del Mediterraneo'], asse: 'NORD-SUD' },
  A3:  { nomi: ['Napoli Salerno'],                                     asse: 'NORD-SUD' },
  A4:  { nomi: ['Torino Trieste', 'Serenissima'],                      asse: 'EST-OVEST' },
  A5:  { nomi: ['Torino Aosta Monte Bianco'],                          asse: 'NORD-SUD' },
  A6:  { nomi: ['Torino Savona'],                                      asse: 'NORD-SUD' },
  A7:  { nomi: ['Milano Genova', 'Autostrada dei Giovi'],              asse: 'NORD-SUD' },
  A8:  { nomi: ['Milano Varese', 'Autostrada dei Laghi'],              asse: 'NORDOVEST-SUDEST' },
  A9:  { nomi: ['Lainate Chiasso', 'Autostrada dei Laghi'],            asse: 'NORDOVEST-SUDEST' },
  A10: { nomi: ['Genova Ventimiglia', 'Autostrada dei Fiori'],         asse: 'EST-OVEST' },
  A11: { nomi: ['Firenze Pisa', 'Firenze Mare'],                       asse: 'EST-OVEST' },
  A12: { nomi: ['Genova Roma', 'Autostrada Tirrenica'],                asse: 'NORDOVEST-SUDEST' },
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
};

/**
 * Codice autostrada (es. "A14") dal nome di strada restituito dal reverse geocoding,
 * oppure null. Confronto case-insensitive per sottostringa, perché Nominatim può
 * restituire nomi parziali o con parole in più.
 */
export function codiceDaNomeStrada(nomeStrada) {
  const normalizzato = nomeStrada?.toLowerCase() ?? '';
  for (const [codice, { nomi }] of Object.entries(AUTOSTRADE)) {
    if (nomi.some(n => normalizzato.includes(n.toLowerCase()))) return codice;
  }
  return null;
}

/**
 * Codice autostrada contenuto in un testo, oppure null.
 * "A14 BOLOGNA-TARANTO" → "A14", "A 7;E 45" (sigla tedesca in OSM) → "A7".
 */
export function estraiCodice(testo) {
  const m = testo?.toUpperCase().match(/\bA\s?(\d+)\b/);
  return m ? `A${m[1]}` : null;
}
