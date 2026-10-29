"""Scarica l'elenco delle aree di servizio con colonnine Free To X da Autostrade per l'Italia.

Uso:  python tools/Download_Free_To_X.py
Poi:  python tools/ReverseGeocoding.py
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import requests

URL = "https://viabilita.autostrade.it/json/colonnine.json"
OUTPUT = Path(__file__).resolve().parent.parent / "data" / "free_to_x.json.original.json"


def download_colonnine(url=URL, output=OUTPUT):
    print(f"Scaricamento da {url}...")
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    dati = response.json()
    dati["data_download"] = datetime.now(timezone.utc).isoformat()

    output.write_text(json.dumps(dati, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(dati.get('listaAree', []))} aree salvate in {output}")


if __name__ == "__main__":
    download_colonnine()
