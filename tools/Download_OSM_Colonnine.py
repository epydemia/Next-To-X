"""Colonnine autostradali di un operatore (es. IONITY) da OpenStreetMap, nel formato dell'app.

Per ogni colonnina dell'operatore nei paesi richiesti:
- se si trova in un'area di servizio (highway=services/rest_area) vicina a un'autostrada,
  la carreggiata è la direzione di marcia del tratto di autostrada più vicino
  (in OSM le carreggiate sono due vie a senso unico separate);
- se non è in un'area di servizio ma l'autostrada è entro USCITA_MAX_M (es. Autohof
  tedeschi), viene marcata exitRequired: raggiungibile uscendo, da entrambe le direzioni;
- altrimenti (colonnine in città) viene scartata.

Uso:  python tools/Download_OSM_Colonnine.py --operatore IONITY --paesi IT,DE
Dati © OpenStreetMap contributors, licenza ODbL.
"""
import argparse
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
OVERPASS = "https://overpass-api.de/api/interpreter"
HEADERS = {"User-Agent": "Next-To-X/1.0 (https://github.com/epydemia/Next-To-X)"}

AREA_SERVIZIO_MAX_M = 150   # colonnina considerata dentro l'area di servizio
CARREGGIATA_MAX_M = 400     # autostrada a cui appartiene l'area di servizio
USCITA_MAX_M = 1500         # oltre, la colonnina non è considerata autostradale

PUNTI_CARDINALI = ["NORD", "NORDEST", "EST", "SUDEST", "SUD", "SUDOVEST", "OVEST", "NORDOVEST"]

# Spine CCS/CHAdeMO/Type 2 come le tagga OSM (socket:<tipo>=<numero>, socket:<tipo>:output=<potenza>)
PRESE = {"type2_combo": "CCS", "chademo": "CHAdeMO", "type2": "Type 2", "type2_cable": "Type 2"}


def query_overpass(paese, operatore):
    filtro = re.escape(operatore)
    return f"""
[out:json][timeout:300];
area["ISO3166-1"="{paese}"][admin_level=2]->.paese;
(
  nwr["amenity"="charging_station"]["operator"~"{filtro}",i](area.paese);
  nwr["amenity"="charging_station"]["network"~"{filtro}",i](area.paese);
  nwr["amenity"="charging_station"]["brand"~"{filtro}",i](area.paese);
)->.colonnine;
.colonnine out tags center;
way(around.colonnine:{USCITA_MAX_M})["highway"="motorway"]->.autostrade;
.autostrade out tags geom;
nwr(around.colonnine:{CARREGGIATA_MAX_M})["highway"~"^(services|rest_area)$"]->.aree;
.aree out tags geom;
"""


def scarica(paese, operatore):
    import requests
    print(f"Overpass: {operatore} in {paese}...")
    r = requests.post(OVERPASS, data={"data": query_overpass(paese, operatore)}, headers=HEADERS, timeout=360)
    r.raise_for_status()
    return r.json()


# --- Geometria (piano locale in metri: sufficiente per distanze di qualche km) ---

def _xy(lat, lon, lat0):
    return lon * 111320 * math.cos(math.radians(lat0)), lat * 110540


def distanza_segmento_m(p, a, b):
    """Distanza in metri del punto p dal segmento a-b; punti come (lat, lon)."""
    lat0 = p[0]
    px, py = _xy(*p, lat0)
    ax, ay = _xy(*a, lat0)
    bx, by = _xy(*b, lat0)
    dx, dy = bx - ax, by - ay
    t = 0 if dx == dy == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def bearing(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def punto_cardinale(gradi):
    return PUNTI_CARDINALI[round(gradi / 45) % 8]


def dentro_poligono(p, anello):
    lat, lon = p
    dentro = False
    for (la1, lo1), (la2, lo2) in zip(anello, anello[1:]):
        if (la1 > lat) != (la2 > lat) and lon < lo1 + (lat - la1) * (lo2 - lo1) / (la2 - la1):
            dentro = not dentro
    return dentro


# --- Elementi OSM ---

def posizione(el):
    if "lat" in el:
        return el["lat"], el["lon"]
    c = el.get("center")
    if c:
        return c["lat"], c["lon"]
    punti = linee(el)
    return (sum(p[0] for linea in punti for p in linea) / sum(map(len, punti)),
            sum(p[1] for linea in punti for p in linea) / sum(map(len, punti))) if punti else None


def linee(el):
    """Polilinee dell'elemento: la via stessa, o le vie membro di una relazione."""
    if el["type"] == "way" and el.get("geometry"):
        return [[(g["lat"], g["lon"]) for g in el["geometry"]]]
    if el["type"] == "relation":
        return [[(g["lat"], g["lon"]) for g in m["geometry"]] for m in el.get("members", []) if m.get("geometry")]
    return []


def distanza_elemento_m(p, el):
    if el["type"] == "node":
        return distanza_segmento_m(p, (el["lat"], el["lon"]), (el["lat"], el["lon"]))
    distanza = math.inf
    for linea in linee(el):
        if len(linea) > 3 and linea[0] == linea[-1] and dentro_poligono(p, linea):
            return 0
        for a, b in zip(linea, linea[1:]):
            distanza = min(distanza, distanza_segmento_m(p, a, b))
    return distanza


def autostrada_piu_vicina(p, autostrade):
    """(distanza_m, via, direzione_di_marcia_in_gradi | None) del tratto di autostrada più vicino."""
    migliore = (math.inf, None, None)
    for via in autostrade:
        linea = linee(via)[0] if linee(via) else []
        for a, b in zip(linea, linea[1:]):
            d = distanza_segmento_m(p, a, b)
            if d < migliore[0]:
                senso = via["tags"].get("oneway", "yes" if via["tags"].get("highway") == "motorway" else "no")
                direzione = bearing(a, b) if senso == "yes" else bearing(b, a) if senso == "-1" else None
                migliore = (d, via, direzione)
    return migliore


def codice_autostrada(tags):
    """"A 7;E 45" → "A7". Prima sigla che inizia per A, altrimenti la prima sigla."""
    sigle = [s.strip() for s in (tags.get("ref") or "").split(";") if s.strip()]
    for s in sigle:
        m = re.match(r"^A\s?(\d+)$", s)
        if m:
            return f"A{m.group(1)}"
    return sigle[0].replace(" ", "") if sigle else ""


def connettori(tags):
    risultato = []
    for chiave, nome in PRESE.items():
        n = tags.get(f"socket:{chiave}")
        if not n or not n.isdigit():
            continue
        potenza = tags.get(f"socket:{chiave}:output", "")
        risultato += [{"modello": f"{nome} {potenza}".strip()}] * int(n)
    return risultato


def colonnina(el):
    tags = el.get("tags", {})
    return {
        "codice": f"osm:{el['type']}/{el['id']}",
        "modello": tags.get("name") or tags.get("operator") or tags.get("network") or "",
        "connettori": connettori(tags),
    }


def elabora(risposta, paese, operatore):
    """Converte la risposta Overpass in aree nel formato dell'app (vedi data/*.json)."""
    elementi = risposta.get("elements", [])
    colonnine = [e for e in elementi if e.get("tags", {}).get("amenity") == "charging_station"]
    autostrade = [e for e in elementi if e.get("tags", {}).get("highway") == "motorway"]
    aree_servizio = [e for e in elementi if e.get("tags", {}).get("highway") in ("services", "rest_area")]

    aree = {}
    for c in colonnine:
        p = posizione(c)
        if not p:
            continue
        dist_autostrada, via, direzione = autostrada_piu_vicina(p, autostrade)
        if dist_autostrada > USCITA_MAX_M:
            continue

        area_servizio = min(aree_servizio, key=lambda a: distanza_elemento_m(p, a), default=None)
        in_area = (area_servizio is not None
                   and distanza_elemento_m(p, area_servizio) <= AREA_SERVIZIO_MAX_M
                   and dist_autostrada <= CARREGGIATA_MAX_M)

        chiave = f"osm:{area_servizio['type']}/{area_servizio['id']}" if in_area else colonnina(c)["codice"]
        if chiave in aree:
            aree[chiave]["colonnine"].append(colonnina(c))
            continue

        tags_area = area_servizio["tags"] if in_area else {}
        strada = codice_autostrada(via["tags"])
        aree[chiave] = {
            "codice": chiave,
            "nome": tags_area.get("name") or c.get("tags", {}).get("name") or f"{operatore} {strada}".strip(),
            "strada": strada,
            "direzione": via["tags"].get("destination", "") if in_area else "",
            "direzione_geografica": punto_cardinale(direzione) if in_area and direzione is not None else "ND",
            "exitRequired": not in_area,
            "lat": round(p[0], 6),
            "lon": round(p[1], 6),
            "paese": paese,
            "operatore": operatore,
            "colonnine": [colonnina(c)],
        }
    return list(aree.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--operatore", default="IONITY")
    parser.add_argument("--paesi", default="IT,DE", help="codici ISO separati da virgola")
    parser.add_argument("--output", help="file in data/ (default: <operatore>_osm.json)")
    args = parser.parse_args()

    aree = []
    for paese in [p.strip().upper() for p in args.paesi.split(",")]:
        trovate = elabora(scarica(paese, args.operatore), paese, args.operatore)
        print(f"  {paese}: {len(trovate)} aree ({sum(a['exitRequired'] for a in trovate)} fuori autostrada)")
        aree += trovate

    output = DATA / (args.output or f"{args.operatore.lower()}_osm.json")
    output.write_text(json.dumps({
        "listaAree": aree,
        "data_download": datetime.now(timezone.utc).isoformat(),
        "fonte": "© OpenStreetMap contributors, ODbL",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(aree)} aree salvate in {output}")


if __name__ == "__main__":
    main()
