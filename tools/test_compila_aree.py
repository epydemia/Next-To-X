"""Test di Compila_Aree.py.  Uso:  python -m unittest discover tools"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from Compila_Aree import controlla, da_a22, da_free_to_x, da_osm, potenza_kw, tipo_connettore  # noqa: E402

FREE_TO_X = {
    "codice": "493", "nome": "ARDA EST", "strada": "A1 MILANO-NAPOLI", "direzione": "MILANO",
    "direzione_geografica": "NORDOVEST", "lat": 44.9, "lon": 9.9, "km": 75.4,
    "stradaReverse": "Autostrada del Sole, Fiorenzuola",
    "colonnine": [{"codice": "F2X1", "modello": "HPC 300 kW", "dataAttivazione": 1701817200000,
                   "connettori": [{"modello": "CCS Ricarica DC"}, {"modello": "Type 2 Ricarica AC (22 kW)"}]}],
}


class TestConversioni(unittest.TestCase):
    def test_potenza_e_tipo(self):
        self.assertEqual(potenza_kw("HPC 300 kW"), 300)
        self.assertEqual(potenza_kw("CCS 350"), 350)
        self.assertIsNone(potenza_kw("Type 2"))
        self.assertIsNone(potenza_kw("CCS Ricarica DC"))
        self.assertEqual(tipo_connettore("Type2 Ricarica AC (22 kW)"), "Type 2")
        self.assertEqual(tipo_connettore("Tesla Supercharger"), "Tesla")

    def test_free_to_x(self):
        a = da_free_to_x(FREE_TO_X)
        self.assertEqual((a["id"], a["codiceOrigine"], a["nome"]), ("ftx:493", "493", "Arda Est"))
        self.assertEqual((a["autostrada"], a["tratta"]), ("A1", "Milano-Napoli"))
        self.assertEqual((a["carreggiata"], a["destinazione"], a["accesso"]), ("NORDOVEST", "Milano", "area_servizio"))
        c = a["colonnine"][0]
        self.assertEqual((c["operatore"], c["potenzaKw"], c["attivaDal"]), ("Free To X", 300, "2023-12-05"))
        self.assertEqual(c["connettori"], [{"tipo": "CCS", "potenzaKw": None}, {"tipo": "Type 2", "potenzaKw": 22}])
        self.assertEqual(a["operatori"], ["Free To X"])

    def test_free_to_x_senza_codice_e_autostrada(self):
        a = da_free_to_x({**FREE_TO_X, "codice": None, "nome": "AEROPORTO MILANO LINATE", "strada": ""})
        self.assertEqual((a["id"], a["codiceOrigine"]), ("ftx:aeroporto-milano-linate", "nome:AEROPORTO MILANO LINATE"))
        self.assertEqual(a["accesso"], "fuori_autostrada")

    def test_a22_direzione_e_carreggiata(self):
        a = da_a22({"codice": "A22_001", "nome": "Garda est", "strada": "A22 BRENNERO", "direzione": "NORD",
                    "lat": 45.5, "lon": 10.8, "colonnine": [{"codice": "T1", "modello": "Tesla Supercharger",
                                                             "connettori": [{"modello": "Tesla Supercharger"}]}]})
        self.assertEqual((a["carreggiata"], a["destinazione"]), ("NORD", None))
        self.assertEqual(a["operatori"], ["Tesla"])

    def test_osm(self):
        a = da_osm({"codice": "osm:way/1", "nome": "Ceva Est", "strada": "A6", "direzione": "", "paese": "IT",
                    "direzione_geografica": "ND", "exitRequired": True, "lat": 44.4, "lon": 8.0,
                    "distanzaAutostradaM": 530, "daVerificare": True, "motivo": "lontana",
                    "colonnine": [{"codice": "osm:node/2", "operatore": "Tesla", "connettori": [{"modello": "CCS 150 kW"}]}]},
                   "osm")
        self.assertEqual((a["accesso"], a["carreggiata"], a["verifica"]), ("uscita", None, "lontana"))
        self.assertEqual(a["colonnine"][0]["potenzaKw"], 150)


class TestControllo(unittest.TestCase):
    def test_dati_validi(self):
        errori, avvisi = controlla([da_free_to_x(FREE_TO_X)])
        self.assertEqual((errori, avvisi), ([], []))

    def test_errori(self):
        a = da_free_to_x(FREE_TO_X)
        errori, _ = controlla([{**a, "lat": 10}, {**a, "carreggiata": "SU"}])
        self.assertTrue(any("fuori dall'Europa" in e for e in errori))
        self.assertTrue(any("carreggiata 'SU'" in e for e in errori))
        self.assertTrue(any("id ripetuto" in e for e in errori))

    def test_avviso_type2_una_volta_per_area(self):
        a = da_osm({"codice": "osm:node/1", "nome": "X", "strada": "A1", "paese": "AT", "direzione_geografica": "NORD",
                    "lat": 48, "lon": 15, "colonnine": [{"codice": "c", "connettori": [{"modello": "Type 2 350kW"}] * 4}]},
                   "ionity")
        _, avvisi = controlla([a])
        self.assertEqual(len(avvisi), 1)


if __name__ == "__main__":
    unittest.main()
