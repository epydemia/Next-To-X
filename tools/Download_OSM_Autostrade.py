"""Tracciato delle autostrade da OpenStreetMap, per riconoscere in locale su quale autostrada si viaggia.

L'app confronta la posizione GPS con queste linee invece di chiedere la strada a Nominatim
(che limita le chiamate e blocca chi ne fa troppe). Si scaricano:
- tutte le vie highway=motorway (in OSM ogni carreggiata è una via a senso unico separata);
- le highway=trunk con sigla autostradale (RA italiani, S austriache, A svizzere declassate).

Le vie con stessa sigla e stesso senso di marcia vengono unite in linee lunghe e semplificate
(Douglas-Peucker, TOLLERANZA_M), poi salvate in data/autostrade.json:

  {
    "versione": 1, "generato": "...", "licenza": "...",
    "strade": [{"paese": "IT", "codice": "A14", "nome": "Autostrada Adriatica"}, ...],
    "linee":  [[indiceStrada, sensoUnico, lat0, lon0, dLat1, dLon1, ...], ...]
  }

Coordinate in centomillesimi di grado (~1 m), dalla seconda in poi come differenza dalla
precedente: numeri piccoli, file compatto. sensoUnico = 1 se la linea va percorsa nel verso
dei punti, 0 se in entrambi.

Uso:  python tools/Download_OSM_Autostrade.py [--paesi IT,DE,CH,AT] [--aggiorna]
Dati © OpenStreetMap contributors, licenza ODbL.
"""
import argparse
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from Download_OSM_Colonnine import CACHE, DATA, codice_autostrada, richiesta_overpass

OUTPUT = DATA / "autostrade.json"
TOLLERANZA_M = 10   # errore massimo della semplificazione: l'app accetta posizioni entro ~35 m
SCALA = 100_000     # coordinate intere in centomillesimi di grado


SENZA_SIGLA = "nome:"  # prefisso del gruppo delle vie senza ref


def query_autostrade(paese):
    return f"""
[out:json][timeout:300];
area["ISO3166-1"="{paese}"][admin_level=2]->.paese;
(
  way["highway"="motorway"](area.paese);
  way["highway"="trunk"]["ref"~"^(A|RA|S) ?[0-9]"](area.paese);
);
out tags geom;
"""


def scarica(paese, aggiorna):
    """Risposta Overpass per un paese; salvata in tools/cache/ e riusata se già presente."""
    cache = CACHE / f"autostrade_{paese}.json"
    if cache.exists() and not aggiorna:
        print(f"{paese}: uso la cache {cache.name} (--aggiorna per riscaricare)")
        return json.loads(cache.read_text(encoding="utf-8"))
    risposta = richiesta_overpass(query_autostrade(paese), f"autostrade in {paese}")
    CACHE.mkdir(exist_ok=True)
    cache.write_text(json.dumps(risposta), encoding="utf-8")
    return risposta


def senso(tags):
    """1 (verso dei punti), -1 (verso opposto) o 0 (entrambi). Le motorway sono a senso unico salvo oneway=no."""
    oneway = tags.get("oneway")
    if oneway == "-1":
        return -1
    if oneway in ("yes", "1", "true"):
        return 1
    if oneway == "no":
        return 0
    return 1 if tags.get("highway") == "motorway" else 0


def vie(elementi):
    """(codice, nome, sensoUnico, punti) per ogni via, con i punti già nel verso di marcia."""
    for el in elementi:
        punti = [(g["lat"], g["lon"]) for g in el.get("geometry", [])]
        if len(punti) < 2:
            continue
        tags = el.get("tags", {})
        s = senso(tags)
        if s == -1:
            punti.reverse()
        yield codice_autostrada(tags), tags.get("name", ""), int(s != 0), punti


def unisci(vie_gruppo):
    """Unisce le vie che proseguono una nell'altra (fine dell'una = inizio dell'altra)."""
    da_inizio = defaultdict(list)
    for i, punti in enumerate(vie_gruppo):
        da_inizio[punti[0]].append(i)
    usate = set()
    finali = {punti[-1] for punti in vie_gruppo}
    linee = []
    # Prima le vie che nessun'altra prosegue (inizi di catena), poi quel che resta (anelli)
    ordine = sorted(range(len(vie_gruppo)), key=lambda i: vie_gruppo[i][0] in finali)
    for i in ordine:
        if i in usate:
            continue
        usate.add(i)
        linea = list(vie_gruppo[i])
        while True:
            seguenti = [j for j in da_inizio.get(linea[-1], []) if j not in usate]
            if not seguenti:
                break
            usate.add(seguenti[0])
            linea.extend(vie_gruppo[seguenti[0]][1:])
        linee.append(linea)
    return linee


def _xy(p, lat0):
    return p[1] * 111320 * math.cos(math.radians(lat0)), p[0] * 110540


def distanza_segmento_m(p, a, b, lat0):
    (px, py), (ax, ay), (bx, by) = _xy(p, lat0), _xy(a, lat0), _xy(b, lat0)
    dx, dy = bx - ax, by - ay
    t = 0 if dx == dy == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def semplifica(punti, tolleranza_m):
    """Douglas-Peucker iterativo (le linee unite possono avere decine di migliaia di punti)."""
    lat0 = punti[0][0]
    tieni = [False] * len(punti)
    tieni[0] = tieni[-1] = True
    pila = [(0, len(punti) - 1)]
    while pila:
        inizio, fine = pila.pop()
        massimo, indice = 0, None
        for i in range(inizio + 1, fine):
            d = distanza_segmento_m(punti[i], punti[inizio], punti[fine], lat0)
            if d > massimo:
                massimo, indice = d, i
        if indice is not None and massimo > tolleranza_m:
            tieni[indice] = True
            pila += [(inizio, indice), (indice, fine)]
    return [p for p, k in zip(punti, tieni) if k]


def codifica(indice_strada, senso_unico, punti):
    interi = [(round(lat * SCALA), round(lon * SCALA)) for lat, lon in punti]
    riga = [indice_strada, senso_unico, *interi[0]]
    for (lat_prec, lon_prec), (lat, lon) in zip(interi, interi[1:]):
        if (lat, lon) != (lat_prec, lon_prec):
            riga += [lat - lat_prec, lon - lon_prec]
    return riga


def elabora(paese, elementi, strade, linee):
    gruppi = defaultdict(list)
    nomi = defaultdict(Counter)
    for codice, nome, senso_unico, punti in vie(elementi):
        # Senza sigla si raggruppa per nome: altrimenti tutte le vie senza ref del paese
        # diventerebbero un'unica strada, con il nome della più frequente
        gruppo = codice or f"{SENZA_SIGLA}{nome}"
        gruppi[(gruppo, senso_unico)].append(punti)
        if nome:
            nomi[gruppo][nome] += 1

    punti_prima = punti_dopo = 0
    for (gruppo, senso_unico), vie_gruppo in sorted(gruppi.items()):
        chiave = (paese, gruppo)
        if chiave not in strade:
            nome = nomi[gruppo].most_common(1)[0][0] if nomi[gruppo] else ""
            strade[chiave] = (len(strade), nome)
        for linea in unisci(vie_gruppo):
            semplice = semplifica(linea, TOLLERANZA_M)
            punti_prima += len(linea)
            punti_dopo += len(semplice)
            linee.append(codifica(strade[chiave][0], senso_unico, semplice))
    print(f"  {paese}: {len({c for c, _ in gruppi})} sigle, {punti_prima} punti → {punti_dopo} dopo la semplificazione")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--paesi", default="IT,DE,CH,AT", help="codici ISO separati da virgola")
    parser.add_argument("--aggiorna", action="store_true", help="riscarica da Overpass ignorando la cache")
    args = parser.parse_args()

    strade, linee = {}, []
    for paese in [p.strip().upper() for p in args.paesi.split(",")]:
        elabora(paese, scarica(paese, args.aggiorna).get("elements", []), strade, linee)

    elenco = [None] * len(strade)
    for (paese, gruppo), (indice, nome) in strade.items():
        codice = "" if gruppo.startswith(SENZA_SIGLA) else gruppo
        elenco[indice] = {"paese": paese, "codice": codice, "nome": nome}
    risultato = {
        "versione": 1,
        "generato": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "licenza": "Contiene dati © OpenStreetMap contributors, disponibili con licenza ODbL 1.0 "
                   "(https://opendatacommons.org/licenses/odbl/1-0/)",
        "strade": elenco,
        "linee": linee,
    }
    OUTPUT.write_text(json.dumps(risultato, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Scritto {OUTPUT.relative_to(DATA.parent)}: {len(elenco)} strade, {len(linee)} linee, "
          f"{OUTPUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
