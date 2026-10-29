"""Arricchisce le aree Free To X con i campi usati dall'app:

- stradaReverse: nome della strada secondo Nominatim (reverse geocoding)
- direzione_geografica: carreggiata (NORD, SUDEST, ...), calcolata come
  direzione dall'area verso la città indicata nel campo "direzione".
  Se la destinazione non è una città geolocalizzabile vale "ND" e l'app
  non scarta la stazione.

Nota: i suffissi nei nomi delle aree ("CALAGGIO NORD") sono una convenzione
di Autostrade e non indicano la bussola (Calaggio Nord, sull'A16, va verso
Napoli, cioè a ovest), per questo non vengono usati.

Uso:  python tools/ReverseGeocoding.py   (dopo tools/Download_Free_To_X.py)
"""
import json
import math
import time
from pathlib import Path

import requests

DATA = Path(__file__).resolve().parent.parent / "data"
INPUT = DATA / "free_to_x.json.original.json"
OUTPUT = DATA / "free_to_x_reverse.json"

NOMINATIM = "https://nominatim.openstreetmap.org"
# Nominatim richiede uno User-Agent che identifichi l'applicazione
HEADERS = {"User-Agent": "Next-To-X/1.0 (https://github.com/epydemia/Next-To-X)"}

# Sotto questa distanza la direzione verso la città di destinazione non è affidabile
DISTANZA_MINIMA_KM = 10

PUNTI_CARDINALI = ["NORD", "NORDEST", "EST", "SUDEST", "SUD", "SUDOVEST", "OVEST", "NORDOVEST"]


def nominatim(endpoint, **params):
    response = requests.get(f"{NOMINATIM}/{endpoint}", params={"format": "jsonv2", **params},
                            headers=HEADERS, timeout=10)
    response.raise_for_status()
    time.sleep(1)  # limite d'uso di Nominatim: 1 richiesta al secondo
    return response.json()


def reverse_geocode(lat, lon):
    return nominatim("reverse", lat=lat, lon=lon).get("display_name", "")


_cache_citta = {}


def coordinate_citta(nome):
    """(lat, lon) di una città italiana, oppure None se il nome non è un centro abitato."""
    if nome not in _cache_citta:
        risultati = nominatim("search", q=nome, countrycodes="it", featureType="settlement", limit=1)
        _cache_citta[nome] = (float(risultati[0]["lat"]), float(risultati[0]["lon"])) if risultati else None
    return _cache_citta[nome]


def distanza_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def bearing(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def punto_cardinale(gradi):
    return PUNTI_CARDINALI[round(gradi / 45) % 8]


def direzione_geografica(area, coordinate_destinazione=coordinate_citta):
    destinazione = (area.get("direzione") or "").strip()
    lat, lon = area.get("lat"), area.get("lon")
    if not destinazione or lat is None or lon is None:
        return "ND"
    citta = coordinate_destinazione(destinazione)
    if citta is None or distanza_km(lat, lon, *citta) < DISTANZA_MINIMA_KM:
        return "ND"
    return punto_cardinale(bearing(lat, lon, *citta))


SUFFISSI = ("NORD", "SUD", "EST", "OVEST")


def nome_base(area):
    """"MURGE OVEST" → "MURGE": le aree gemelle sulle due carreggiate condividono il nome base."""
    parole = (area.get("nome") or "").strip().upper().split()
    return " ".join(parole[:-1]) if len(parole) > 1 and parole[-1] in SUFFISSI else None


def completa_da_area_gemella(aree):
    """Assegna a un'area senza carreggiata la direzione opposta a quella della sua gemella."""
    per_nome = {}
    for a in aree:
        if nome_base(a):
            per_nome.setdefault((a.get("strada"), nome_base(a)), []).append(a)

    for gemelle in per_nome.values():
        if len(gemelle) != 2:
            continue
        for area, altra in (gemelle, gemelle[::-1]):
            if area["direzione_geografica"] == "ND" and altra["direzione_geografica"] != "ND":
                opposta = (PUNTI_CARDINALI.index(altra["direzione_geografica"]) + 4) % 8
                area["direzione_geografica"] = PUNTI_CARDINALI[opposta]


def arricchisci(input_path=INPUT, output_path=OUTPUT):
    dati = json.loads(input_path.read_text(encoding="utf-8"))
    aree = dati.get("listaAree", [])

    for i, area in enumerate(aree, 1):
        if area.get("lat") is not None and area.get("lon") is not None:
            area["stradaReverse"] = reverse_geocode(area["lat"], area["lon"])
        area["direzione_geografica"] = direzione_geografica(area)
        print(f"{i}/{len(aree)}  {area.get('nome', '')} → {area['direzione_geografica']}".ljust(70), end="\r")
    completa_da_area_gemella(aree)

    output = {"listaAree": aree}
    if "data_download" in dati:
        output["data_download"] = dati["data_download"]
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

    nd = sum(a["direzione_geografica"] == "ND" for a in aree)
    print(f"\n{len(aree)} aree salvate in {output_path} ({nd} senza carreggiata)")


if __name__ == "__main__":
    arricchisci()
