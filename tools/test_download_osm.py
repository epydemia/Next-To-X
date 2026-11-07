"""Test di Download_OSM_Colonnine.py (senza rete).  Uso:  python3 -m unittest discover tools"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import Download_OSM_Colonnine as dl  # noqa: E402
from Download_OSM_Colonnine import (  # noqa: E402
    colonnine_veloci_vicino_autostrada, elabora, operatore_di, potenza_kw, ricarica_veloce,
)

# Tracciato locale finto: un tratto di A9 in direzione nord-est
TRACCIATO = {}
A9 = ((48.60, 11.54), (48.64, 11.57))
for r in range(2430, 2433):
    for c in range(576, 580):
        TRACCIATO[(r, c)] = [(*A9, "A9")]


def stazione(id_, lon, **tags):
    return {"type": "node", "id": id_, "lat": 48.62, "lon": lon, "tags": {"amenity": "charging_station", **tags}}


class TestRicaricaVeloce(unittest.TestCase):
    def test_potenza(self):
        self.assertEqual(potenza_kw("150 kW"), 150)
        self.assertEqual(potenza_kw("50000 W"), 50)
        self.assertEqual(potenza_kw("22kW;11 kW"), 22)
        self.assertIsNone(potenza_kw("molto"))
        self.assertEqual(potenza_kw("22000"), 22)  # watt senza unità

    def test_veloce(self):
        self.assertTrue(ricarica_veloce({"socket:type2_combo": "4"}))
        self.assertTrue(ricarica_veloce({"socket:type2_combo:output": "300 kW"}))
        self.assertTrue(ricarica_veloce({"name": "Tesla Supercharger Langenbruck"}))
        self.assertFalse(ricarica_veloce({"socket:type2": "2", "socket:type2:output": "22 kW"}))
        self.assertFalse(ricarica_veloce({}))
        self.assertFalse(ricarica_veloce({"socket:type2": "2", "socket:type2:output": "22000"}))


class TestColonnineAllUscita(unittest.TestCase):
    def test_veloci_vicino_autostrada_tenute_come_uscita(self):
        colonnine = [
            stazione(1, 11.55, operator="Tesla, Inc.", **{"socket:tesla_supercharger_ccs": "8"}),
            stazione(2, 11.5505, operator="IONITY", **{"socket:type2_combo": "4"}),  # ha una fonte propria
            stazione(3, 11.551, **{"socket:type2": "2"}),                             # lenta
            stazione(4, 11.40, **{"socket:type2_combo": "2"}),                        # lontana dall'autostrada
        ]
        fuori = colonnine_veloci_vicino_autostrada(colonnine, [], TRACCIATO)
        self.assertEqual([c["id"] for c in fuori], [1])
        dl._tracciato = TRACCIATO
        # Senza autostrade da Overpass: distanza e sigla vengono dal tracciato locale
        aree = elabora({"elements": fuori + [colonnine[2]]}, "DE", None)
        self.assertEqual(len(aree), 1)
        a = aree[0]
        self.assertEqual((a["nome"], a["strada"], a["exitRequired"], a["operatore"]), ("Tesla A9", "A9", True, "Tesla"))
        self.assertLess(a["distanzaAutostradaM"], 1000)

    def test_oltre_il_limite_delle_uscite_scartata(self):
        lontana = stazione(5, 11.575, **{"socket:type2_combo": "2"})  # ~1,3 km dal tratto
        self.assertEqual(len(colonnine_veloci_vicino_autostrada([lontana], [], TRACCIATO)), 1)  # scaricata (< 1,5 km)
        dl._tracciato = TRACCIATO
        self.assertEqual(elabora({"elements": [lontana]}, "DE", None), [])  # ma oltre i 1000 m delle uscite

    def test_lontana_dagli_svincoli_scartata(self):
        dl._tracciato = TRACCIATO
        veloce = stazione(1, 11.55, **{"socket:type2_combo": "4"})
        vicino = {"type": "node", "id": 7, "lat": 48.625, "lon": 11.555, "tags": {"highway": "motorway_junction"}}
        lontano = {"type": "node", "id": 8, "lat": 48.70, "lon": 11.62, "tags": {"highway": "motorway_junction"}}
        self.assertEqual(len(elabora({"elements": [veloce, vicino]}, "DE", None)), 1)
        self.assertEqual(elabora({"elements": [veloce, lontano]}, "DE", None), [])

    def test_stessa_sede_entro_300_m(self):
        dl._tracciato = TRACCIATO
        tesla = stazione(1, 11.550, operator="Tesla", **{"socket:tesla_supercharger_ccs": "8"})
        enbw = stazione(2, 11.553, operator="EnBW", **{"socket:type2_combo": "4"})  # ~220 m
        aree = elabora({"elements": [tesla, enbw]}, "DE", None)
        self.assertEqual(len(aree), 1)
        self.assertEqual(aree[0]["operatore"], "EnBW, Tesla")


class TestOperatori(unittest.TestCase):
    def test_nomi(self):
        self.assertEqual(operatore_di({"operator": "Fastned Deutschland GmbH & Co. KG"}), "Fastned")
        self.assertEqual(operatore_di({"operator": "ALDI Süd"}), "Aldi")
        self.assertEqual(operatore_di({"operator": "LKW - Kühlladung"}), "")
        self.assertEqual(operatore_di({"operator": "Waschheld Illertissen / EHRLE-Consulting GmbH"}), "")


if __name__ == "__main__":
    unittest.main()
