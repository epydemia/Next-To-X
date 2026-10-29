"""Confronta le aree di servizio Free To X e A22 con OpenStreetMap.

Per ogni area:
- area di servizio OSM corrispondente (stesso nome se possibile, altrimenti la più vicina
  entro RICERCA_M) e distanza della nostra posizione da essa;
- carreggiata secondo OSM (senso di marcia dell'autostrada a senso unico più vicina
  all'area OSM) confrontata con la nostra direzione_geografica;
- operatori delle colonnine mappate in OSM nell'area.

Scrive reports/crosscheck_osm.md (leggibile) e reports/crosscheck_osm.json (per correzioni).
Uso:  python tools/Crosscheck_OSM.py  [--aggiorna]
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from Download_OSM_Colonnine import (  # noqa: E402
    CACHE, DATA, PUNTI_CARDINALI, autostrada_piu_vicina, distanza_elemento_m, nome_coincide, posizione,
    punto_cardinale, richiesta_overpass,
)

REPORTS = DATA.parent / "reports"
FONTI = {"Free To X": "free_to_x_reverse.json", "A22": "a22_brennero_geocoded.json"}
RICERCA_M = 500          # raggio di ricerca dell'area di servizio OSM
POSIZIONE_OK_M = 150     # oltre, la nostra posizione è considerata da correggere
COLONNINE_M = 150        # colonnine considerate dentro l'area OSM
LOTTO = 40               # aree per richiesta Overpass


def carica_aree():
    aree = []
    for fonte, file in FONTI.items():
        for a in json.loads((DATA / file).read_text(encoding="utf-8")).get("listaAree", []):
            if a.get("lat") is not None and a.get("lon") is not None:
                aree.append({**a, "fonte": fonte})
    return aree


def query(lotto):
    punti = [f"{a['lat']},{a['lon']}" for a in lotto]
    blocco = lambda filtro, raggio: "\n".join(f"  {filtro.format(r=raggio, p=p)}" for p in punti)
    return f"""
[out:json][timeout:240];
(
{blocco('nwr(around:{r},{p})["highway"~"^(services|rest_area)$"];', RICERCA_M)}
)->.aree;
.aree out tags geom;
(
{blocco('way(around:{r},{p})["highway"="motorway"];', RICERCA_M + 300)}
)->.autostrade;
.autostrade out tags geom;
(
{blocco('nwr(around:{r},{p})["amenity"="charging_station"];', RICERCA_M)}
)->.colonnine;
.colonnine out tags center;
"""


def scarica(aree, aggiorna):
    elementi = {}
    for i in range(0, len(aree), LOTTO):
        lotto = aree[i:i + LOTTO]
        cache = CACHE / f"crosscheck_{i // LOTTO}.json"
        if cache.exists() and not aggiorna:
            risposta = json.loads(cache.read_text(encoding="utf-8"))
        else:
            risposta = richiesta_overpass(query(lotto), f"aree {i + 1}-{i + len(lotto)} di {len(aree)}")
            CACHE.mkdir(exist_ok=True)
            cache.write_text(json.dumps(risposta), encoding="utf-8")
        for el in risposta.get("elements", []):
            elementi[(el["type"], el["id"])] = el
    return list(elementi.values())


def differenza_cardinale(a, b):
    if a not in PUNTI_CARDINALI or b not in PUNTI_CARDINALI:
        return None
    d = abs(PUNTI_CARDINALI.index(a) - PUNTI_CARDINALI.index(b)) % 8
    return min(d, 8 - d) * 45


def confronta(area, elementi):
    p = (area["lat"], area["lon"])
    aree_osm = [e for e in elementi if e.get("tags", {}).get("highway") in ("services", "rest_area")]
    autostrade = [e for e in elementi if e.get("tags", {}).get("highway") == "motorway"]
    colonnine = [e for e in elementi if e.get("tags", {}).get("amenity") == "charging_station"]

    vicine = sorted(((distanza_elemento_m(p, e), e) for e in aree_osm), key=lambda v: v[0])
    vicine = [(d, e) for d, e in vicine if d <= RICERCA_M]
    stesso_nome = [(d, e) for d, e in vicine if nome_coincide(area.get("nome"), e["tags"].get("name"))]
    uscita = bool(area.get("exitRequired"))

    risultato = {
        "fonte": area["fonte"], "codice": area.get("codice"), "nome": area.get("nome"),
        "strada": area.get("strada"), "direzione": area.get("direzione"),
        "carreggiata": area.get("direzione_geografica") or "ND", "uscita": uscita,
        "osm_nome": None, "osm_id": None, "nome_coincide": bool(stesso_nome),
        "distanza_m": None, "osm_lat": None, "osm_lon": None,
        "osm_carreggiata": None, "differenza_gradi": None, "operatori": [],
        "problemi": [],
    }

    # Un'area "uscita" (fuori dal casello) non deve avere un'area di servizio OSM: la segnaliamo
    # solo se ne esiste una con lo stesso nome, che indicherebbe una classificazione sbagliata
    if uscita and not stesso_nome:
        return risultato
    distanza, osm = (stesso_nome or vicine or [(None, None)])[0]
    if osm is None:
        risultato["problemi"].append(f"nessuna area di servizio OSM entro {RICERCA_M} m")
        return risultato
    if uscita:
        risultato["problemi"].append("segnata come uscita, ma OSM ha un'area di servizio con lo stesso nome")

    centro = posizione(osm)
    _, _, direzione = autostrada_piu_vicina(centro, autostrade)
    carreggiata_osm = punto_cardinale(direzione) if direzione is not None else None
    operatori = sorted({c["tags"].get("operator") or c["tags"].get("network") or "?"
                        for c in colonnine if distanza_elemento_m(posizione(c), osm) <= COLONNINE_M})
    differenza = differenza_cardinale(risultato["carreggiata"], carreggiata_osm)

    risultato.update({
        "osm_nome": osm["tags"].get("name"), "osm_id": f"{osm['type']}/{osm['id']}",
        "distanza_m": round(distanza), "osm_lat": round(centro[0], 6), "osm_lon": round(centro[1], 6),
        "osm_carreggiata": carreggiata_osm, "differenza_gradi": differenza, "operatori": operatori,
    })
    if not stesso_nome:
        risultato["problemi"].append(f"nome diverso ('{risultato['osm_nome']}'): abbinata per vicinanza")
    if distanza > POSIZIONE_OK_M:
        risultato["problemi"].append(f"posizione a {round(distanza)} m dall'area OSM")
    if risultato["carreggiata"] == "ND" and carreggiata_osm:
        risultato["problemi"].append(f"carreggiata mancante, OSM dice {carreggiata_osm}")
    elif differenza is not None and differenza > 45:
        risultato["problemi"].append(f"carreggiata {risultato['carreggiata']} ma OSM dice {carreggiata_osm}")
    return risultato


def report_markdown(risultati):
    problemi = [r for r in risultati if r["problemi"]]
    righe = [
        "# Crosscheck Free To X / A22 con OpenStreetMap", "",
        f"{len(risultati)} aree confrontate, {len(problemi)} con almeno un problema.", "",
        "## Da controllare", "",
        "| Fonte | Area | Strada | Carreggiata (noi / OSM) | Area OSM | Distanza | Problemi |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in problemi:
        righe.append(f"| {r['fonte']} | {r['nome']} | {r['strada']} | {r['carreggiata']} / {r['osm_carreggiata'] or '–'} "
                     f"| {r['osm_nome'] or '–'} | {'' if r['distanza_m'] is None else str(r['distanza_m']) + ' m'} "
                     f"| {'; '.join(r['problemi'])} |")
    righe += ["", "## Operatori presenti nelle aree secondo OSM", ""]
    conteggio = {}
    for r in risultati:
        for o in r["operatori"]:
            conteggio[o] = conteggio.get(o, 0) + 1
    righe += [f"- {o}: {n} {'area' if n == 1 else 'aree'}" for o, n in sorted(conteggio.items(), key=lambda v: -v[1])] or ["- nessuna colonnina mappata"]
    return "\n".join(righe) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--aggiorna", action="store_true", help="riscarica ignorando tools/cache/")
    args = parser.parse_args()

    aree = carica_aree()
    elementi = scarica(aree, args.aggiorna)
    risultati = [confronta(a, elementi) for a in aree]

    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "crosscheck_osm.json").write_text(json.dumps(risultati, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (REPORTS / "crosscheck_osm.md").write_text(report_markdown(risultati), encoding="utf-8")
    problemi = sum(bool(r["problemi"]) for r in risultati)
    print(f"{len(risultati)} aree, {problemi} con problemi → reports/crosscheck_osm.md")


if __name__ == "__main__":
    main()
