"""Test di Compila_Aree.py.  Uso:  python -m unittest discover tools"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from Compila_Aree import (  # noqa: E402
    applica_revisioni, controlla, controlla_unite, da_a22, da_free_to_x, da_osm, potenza_kw, tipo_connettore, unisci,
)

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


def osm(id_, nome, lat, lon, carreggiata, operatore, fonte="osm"):
    return da_osm({"codice": id_, "nome": nome, "strada": "A4", "paese": "IT", "direzione_geografica": carreggiata,
                   "lat": lat, "lon": lon,
                   "colonnine": [{"codice": id_ + "/c", "operatore": operatore, "connettori": [{"modello": "CCS 150 kW"}]}]},
                  fonte)


class TestUnione(unittest.TestCase):
    def setUp(self):
        self.ftx = da_free_to_x({**FREE_TO_X, "codice": "D51", "nome": "VALTROMPIA SUD", "direzione_geografica": "EST",
                                 "lat": 45.5, "lon": 10.2})

    def test_stesso_nome_unisce(self):
        aree = unisci([osm("osm:way/1", "Val Trompia Sud", 45.5008, 10.2, "SUDEST", "Tesla"), self.ftx])
        self.assertEqual(len(aree), 1)
        a = aree[0]
        self.assertEqual((a["id"], a["fonti"], a["codiciOrigine"]), ("ftx:D51", ["free_to_x", "osm"], ["D51", "osm:way/1"]))
        self.assertEqual(a["operatori"], ["Free To X", "Tesla"])
        self.assertEqual(len(a["colonnine"]), 2)

    def test_carreggiate_opposte_non_unisce(self):
        aree = unisci([osm("osm:way/1", "Val Trompia Sud", 45.5003, 10.2, "OVEST", "Tesla"), self.ftx])
        self.assertEqual(len(aree), 2)

    def test_nome_diverso_lontano_non_unisce_ma_avvisa(self):
        aree = unisci([osm("osm:way/1", "Raststation", 45.501, 10.2, "EST", "Tesla"), self.ftx])
        self.assertEqual(len(aree), 2)
        _, avvisi = controlla_unite(aree)
        self.assertTrue(any("forse la stessa area" in a for a in avvisi))

    def test_campi_mancanti_dalla_fonte_secondaria(self):
        senza = da_free_to_x({**FREE_TO_X, "codice": "D51", "nome": "VALTROMPIA SUD", "direzione_geografica": "ND",
                              "lat": 45.5, "lon": 10.2})
        a = unisci([senza, osm("osm:way/1", "Val Trompia Sud", 45.5003, 10.2, "SUDEST", "Tesla")])[0]
        self.assertEqual(a["carreggiata"], "SUDEST")


class TestRevisioni(unittest.TestCase):
    def test_applica_e_segnala_orfane(self):
        aree = unisci([da_free_to_x(FREE_TO_X), osm("osm:way/9", "Altra", 45.0, 11.0, "NORD", "Tesla")])
        orfane = applica_revisioni(aree, {
            "493": {"direzione_geografica": "NORD", "nota": "crosscheck OSM"},
            "osm:way/9": {"esito": "esclusa", "data": "2026-10-31"},
            "XYZ": {"esito": "uscita"},
        })
        ftx, altra = aree
        self.assertEqual(ftx["carreggiata"], "NORD")
        self.assertEqual(ftx["correzioni"]["carreggiata"], {"da": "NORDOVEST", "nota": "crosscheck OSM"})
        self.assertTrue(altra["esclusa"])
        self.assertEqual(orfane, ["XYZ"])

    def test_esito_e_posizione(self):
        aree = unisci([da_free_to_x({**FREE_TO_X, "daVerificare": True, "motivo": "posizione"})])
        applica_revisioni(aree, {"493": {"esito": "uscita", "lat": 44.91, "lon": 9.91, "data": "2026-11-01"}})
        a = aree[0]
        self.assertEqual((a["accesso"], a["lat"], a["lon"], a["verifica"]), ("uscita", 44.91, 9.91, "posizione"))
        self.assertEqual(set(a["correzioni"]), {"accesso", "posizione"})


if __name__ == "__main__":
    unittest.main()
