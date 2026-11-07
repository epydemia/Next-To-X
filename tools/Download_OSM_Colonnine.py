"""Colonnine autostradali di un operatore (es. IONITY) da OpenStreetMap, nel formato dell'app.

Per ogni colonnina dell'operatore nei paesi richiesti:
- se si trova in un'area di servizio (highway=services/rest_area) vicina a un'autostrada,
  la carreggiata è la direzione di marcia del tratto di autostrada più vicino
  (in OSM le carreggiate sono due vie a senso unico separate);
- se non è in un'area di servizio ma l'autostrada è entro USCITA_MAX_M (es. Autohof
  tedeschi), viene marcata exitRequired: raggiungibile uscendo, da entrambe le direzioni;
- altrimenti (colonnine in città) viene scartata.

I casi dubbi vengono marcati daVerificare (con il motivo) per la revisione manuale
nell'editor stazioni; le decisioni finiscono in data/revisioni.json e l'app le applica
al caricamento, quindi sopravvivono a un nuovo download.

Con --tutti-gli-operatori si parte dalle aree di servizio: tutte le colonnine dentro un'area,
più le colonnine veloci (DC) entro USCITA_VELOCI_MAX_M dall'autostrada, raggiungibili uscendo
(distributori e Autohof appena fuori dal casello, es. Langenbruck sull'A9) ed entro
SVINCOLO_MAX_M da uno svincolo, perché in città l'uscita può essere lontana. Per queste la
distanza e la sigla vengono dal tracciato locale (data/autostrade.json), senza altre
richieste a Overpass.

Uso:  python3 tools/Download_OSM_Colonnine.py --operatore IONITY --paesi IT,DE,CH,AT
Dati © OpenStreetMap contributors, licenza ODbL.
"""
import argparse
import json
import math
import re
import sys
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
CACHE = Path(__file__).resolve().parent / "cache"
# Server pubblici: se il primo è sovraccarico (429/502/504) si passa al successivo
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
TENTATIVI_PER_SERVER = 2
HEADERS = {"User-Agent": "Next-To-X/1.0 (https://github.com/epydemia/Next-To-X)"}

AREA_SERVIZIO_MAX_M = 150   # colonnina considerata dentro l'area di servizio
CARREGGIATA_MAX_M = 400     # autostrada a cui appartiene l'area di servizio
USCITA_MAX_M = 1500         # oltre, la colonnina non è considerata autostradale
RAGGRUPPA_M = 300           # colonnine fuori autostrada più vicine di così sono la stessa sede
AREA_LONTANA_M = 200        # area di servizio sospetta se la colonnina è più lontana dall'autostrada
USCITA_VICINA_M = 100       # "uscita" sospetta se così vicina all'autostrada (area di servizio non mappata?)
AREA_UFFICIALE_M = 300      # "uscita" sospetta se così vicina a un'area di servizio delle altre fonti

# Aree di servizio ufficiali già nell'app, usate per il confronto
FONTI_UFFICIALI = ["free_to_x_reverse.json", "a22_brennero_geocoded.json"]

# Modalità "tutti gli operatori": questi hanno già una fonte dedicata. Le loro colonnine
# si scartano, ma l'area resta: Compila_Aree.py la unisce a quella dell'altra fonte, così
# un'area con IONITY ed EnBW ha entrambi gli operatori
OPERATORI_CON_FONTE = re.compile(r"ionity|free\s?-?\s?to\s?-?\s?x", re.I)
# Lo stesso operatore compare in OSM scritto in modi diversi
NOMI_OPERATORI = [(re.compile(r, re.I), nome) for r, nome in [
    (r"\btesla\b", "Tesla"),
    (r"\benel\b", "Enel X Way"),
    (r"\bbe\s?charge\b", "Be Charge"),
    (r"plenitude", "Plenitude"),
    (r"free\s?-?\s?to\s?-?\s?x", "Free To X"),
    (r"\bionity\b", "IONITY"),
    (r"\bewiva\b", "Ewiva"),
    (r"\bedison\b", "Edison Next"),
    (r"autostrada del brennero|^a22$", "Autostrada del Brennero"),
    (r"smatrics|smartics", "SMATRICS"),
    (r"\bshell\b", "Shell Recharge"),
    (r"\bda[\s-]?emobil\b", "da emobil"),
    (r"\bevite\b", "EVite"),
    (r"\blinz\s?ag\b", "Linz AG"),
    (r"\bsocar\b", "SOCAR"),
    (r"\bmove\b", "MOVE"),
    (r"\bgo\s?fast\b", "GOFAST"),
    (r"\bomv\b", "OMV eMotion"),
    (r"illwerke|\bvkw\b", "illwerke vkw"),
    (r"\benbw\b", "EnBW"),
    (r"^e[.-]?on\b", "E.ON Drive"),
    (r"\ballego\b", "Allego"),
    (r"^aral\b|^pulse$", "Aral pulse"),
    (r"tank\s?&\s?rast", "Tank & Rast"),
    (r"^mer\b", "Mer"),
    (r"^in+ogy\b", "Innogy"),
    (r"^ewe[\s-]?go\b", "EWE Go"),
    (r"^charge-on\b", "Charge-ON"),
    (r"^circle(\s?k)?$", "Circle K"),
    (r"^e-wald\b", "E-WALD"),
    (r"^mblty\b", "mblty"),
    (r"^nio\s?power\b", "NIO Power"),
    (r"^nomad\s?power\b", "Nomad Power"),
    (r"^total", "TotalEnergies"),
    (r"^bp\b", "BP"),
    (r"^lechwerke\b|^lew$", "LEW"),
    (r"^fast[\s-]?e$", "Fast-E"),
    (r"^fastned\b", "Fastned"),
    (r"^aldi\b", "Aldi"),
]]
# Valori del tag operator che non indicano un operatore
NON_OPERATORI = re.compile(r"^(vari|wikidata=.*)$|^lkw\b|kühlladung|waschheld", re.I)
CELLA_GRADI = 0.01            # griglia per abbinare colonnine e aree di servizio in Python
AUTOSTRADE_VICINE_M = 700     # raggio attorno al centro dell'area (aree grandi fino a ~300 m)
LOTTO_AUTOSTRADE = 40

# Colonnine fuori dalle aree di servizio, modalità tutti gli operatori: si tengono solo quelle
# veloci, per cui vale la pena uscire. Le lente (AC) vicino all'autostrada sono quasi sempre
# colonnine di paese o di parcheggi
POTENZA_VELOCE_KW = 50
USCITA_VELOCI_MAX_M = 1000  # più stretto di USCITA_MAX_M: in città le colonnine veloci sono tante
# Vicino all'autostrada non basta (in città l'uscita può essere a chilometri): la colonnina
# deve essere anche vicina a uno svincolo (highway=motorway_junction)
SVINCOLO_MAX_M = 1500
PRESE_VELOCI = ("type2_combo", "chademo", "tesla_supercharger", "tesla_supercharger_ccs")
NOME_VELOCE = re.compile(r"supercharger|fastned|ionity|aral\s?pulse|\bhpc\b|schnelllad|high power", re.I)
# Tracciato locale delle autostrade (tools/Download_OSM_Autostrade.py): per scegliere le
# colonnine vicine all'autostrada senza chiedere a Overpass le autostrade attorno a ognuna
FILE_AUTOSTRADE = DATA / "autostrade.json"
SCALA_AUTOSTRADE = 100_000
CELLA_AUTOSTRADE_GRADI = 0.02

# Gli Autohof tedeschi sono a volte taggati highway=services, ma si raggiungono uscendo
NOME_AUTOHOF = re.compile(r"autohof|truck\s?stop", re.I)
NOME_AREA_SERVIZIO = re.compile(r"rastst[äa]tte|raststation|rasthof|rastanlage|area di servizio|aire de|\bads\b|autogrill|serways|tank\s?&\s?rast", re.I)

PUNTI_CARDINALI = ["NORD", "NORDEST", "EST", "SUDEST", "SUD", "SUDOVEST", "OVEST", "NORDOVEST"]

# Spine CCS/CHAdeMO/Type 2 come le tagga OSM (socket:<tipo>=<numero>, socket:<tipo>:output=<potenza>)
PRESE = {"type2_combo": "CCS", "chademo": "CHAdeMO", "type2": "Type 2", "type2_cable": "Type 2"}


def query_aree_servizio(paese):
    """Tutte le aree di servizio e tutte le colonnine del paese: l'abbinamento si fa in Python.
    (Un around a partire dalle aree, cioè da poligoni, restituiva solo una piccola parte
    delle colonnine.)"""
    return f"""
[out:json][timeout:300];
area["ISO3166-1"="{paese}"][admin_level=2]->.paese;
nwr["highway"="services"](area.paese);
out tags geom;
nwr["amenity"="charging_station"](area.paese);
out tags center;
"""


def query_autostrade_vicine(punti):
    righe = "\n".join(f'  way(around:{AUTOSTRADE_VICINE_M},{lat},{lon})["highway"="motorway"];' for lat, lon in punti)
    return f"[out:json][timeout:240];\n(\n{righe}\n);\nout tags geom;\n"


def indice_spaziale(elementi, margine_m):
    """Griglia di celle CELLA_GRADI → elementi il cui ingombro (più il margine) tocca la cella."""
    griglia = {}
    margine = margine_m / 111000
    for el in elementi:
        punti = [(el["lat"], el["lon"])] if el["type"] == "node" else [p for linea in linee(el) for p in linea]
        if not punti:
            continue
        lat_min, lat_max = min(p[0] for p in punti) - margine, max(p[0] for p in punti) + margine
        lon_min, lon_max = min(p[1] for p in punti) - margine, max(p[1] for p in punti) + margine
        for i in range(math.floor(lat_min / CELLA_GRADI), math.floor(lat_max / CELLA_GRADI) + 1):
            for j in range(math.floor(lon_min / CELLA_GRADI), math.floor(lon_max / CELLA_GRADI) + 1):
                griglia.setdefault((i, j), []).append(el)
    return griglia


def colonnine_in_aree_servizio(elementi):
    """(aree di servizio con almeno una colonnina, colonnine dentro un'area di servizio)."""
    aree = [e for e in elementi if e.get("tags", {}).get("highway") == "services"]
    colonnine = [e for e in elementi if e.get("tags", {}).get("amenity") == "charging_station"]
    griglia = indice_spaziale(aree, AREA_SERVIZIO_MAX_M)
    aree_trovate, dentro = {}, []
    for c in colonnine:
        p = posizione(c)
        if not p:
            continue
        candidate = griglia.get((math.floor(p[0] / CELLA_GRADI), math.floor(p[1] / CELLA_GRADI)), [])
        vicine = [a for a in candidate if distanza_elemento_m(p, a) <= AREA_SERVIZIO_MAX_M]
        if vicine:
            dentro.append(c)
            for a in vicine:
                aree_trovate[(a["type"], a["id"])] = a
    return list(aree_trovate.values()), dentro


def potenza_kw(valore):
    """"150 kW" → 150, "22kW;11 kW" → 22, "50000 W" e "50000" → 50 (in OSM a volte è in watt
    senza unità). None se non si capisce."""
    potenze = []
    for parte in (valore or "").split(";"):
        m = re.match(r"^\s*(\d+(?:[.,]\d+)?)\s*(kw|w)?\s*$", parte, re.I)
        if m:
            numero = float(m.group(1).replace(",", "."))
            unita = (m.group(2) or "").lower()
            potenze.append(numero / 1000 if unita == "w" or (not unita and numero >= 1000) else numero)
    return max(potenze, default=None)


def ricarica_veloce(tags):
    """La colonnina ha almeno una presa DC (CCS, CHAdeMO, Supercharger) o almeno POTENZA_VELOCE_KW."""
    for presa in PRESE_VELOCI:
        n = tags.get(f"socket:{presa}", "")
        if n.isdigit() and int(n) > 0:
            return True
    uscite = [v for k, v in tags.items() if k.endswith(":output") or k == "charging_station:output"]
    if any((potenza_kw(v) or 0) >= POTENZA_VELOCE_KW for v in uscite):
        return True
    return any(NOME_VELOCE.search(tags.get(k, "")) for k in ("name", "operator", "network", "brand"))


def carica_tracciato_autostrade(file=FILE_AUTOSTRADE):
    """Griglia cella → segmenti ((lat, lon), (lat, lon), sigla) dal tracciato locale; vuota se manca il file."""
    if not file.exists():
        return {}
    dati = json.loads(file.read_text(encoding="utf-8"))
    sigle = [s["codice"] or s["nome"] for s in dati["strade"]]
    griglia = {}
    for strada, _, lat0, lon0, *differenze in dati["linee"]:
        a = (lat0 / SCALA_AUTOSTRADE, lon0 / SCALA_AUTOSTRADE)
        for i in range(0, len(differenze), 2):
            b = (a[0] + differenze[i] / SCALA_AUTOSTRADE, a[1] + differenze[i + 1] / SCALA_AUTOSTRADE)
            for r in range(math.floor(min(a[0], b[0]) / CELLA_AUTOSTRADE_GRADI), math.floor(max(a[0], b[0]) / CELLA_AUTOSTRADE_GRADI) + 1):
                for c in range(math.floor(min(a[1], b[1]) / CELLA_AUTOSTRADE_GRADI), math.floor(max(a[1], b[1]) / CELLA_AUTOSTRADE_GRADI) + 1):
                    griglia.setdefault((r, c), []).append((a, b, sigle[strada]))
            a = b
    return griglia


_tracciato = None


def tracciato():
    global _tracciato
    if _tracciato is None:
        _tracciato = carica_tracciato_autostrade()
    return _tracciato


def tracciato_piu_vicino(p, griglia):
    """(distanza_m, sigla) dell'autostrada del tracciato locale più vicina entro ~2 km (celle adiacenti),
    (inf, "") se non ce n'è."""
    r, c = math.floor(p[0] / CELLA_AUTOSTRADE_GRADI), math.floor(p[1] / CELLA_AUTOSTRADE_GRADI)
    return min(((distanza_segmento_m(p, a, b), sigla)
                for dr in (-1, 0, 1) for dc in (-1, 0, 1) for a, b, sigla in griglia.get((r + dr, c + dc), [])),
               default=(math.inf, ""))


def colonnine_veloci_vicino_autostrada(colonnine, gia_dentro, griglia, massimo_m=USCITA_MAX_M):
    """Colonnine veloci fuori dalle aree di servizio ed entro massimo_m dall'autostrada."""
    dentro = {(c["type"], c["id"]) for c in gia_dentro}
    return [c for c in colonnine
            if (c["type"], c["id"]) not in dentro and posizione(c) and ricarica_veloce(c.get("tags", {}))
            and not OPERATORI_CON_FONTE.search(operatore_di(c.get("tags", {})))
            and tracciato_piu_vicino(posizione(c), griglia)[0] <= massimo_m]


def scarica_aree_servizio(paese, aggiorna):
    """Elementi per la modalità tutti-gli-operatori: aree con colonnine, le colonnine (dentro le aree
    e quelle veloci vicino all'autostrada) e le autostrade vicine.
    Ogni passaggio ha la sua cache: se Overpass fallisce a metà, rilanciando si riparte da lì."""
    # v3: aggiunte le colonnine veloci fuori dalle aree di servizio
    cache = CACHE / f"aree_servizio_v3_{paese}.json"
    if cache.exists() and not aggiorna:
        print(f"{paese}: uso la cache {cache.name} (--aggiorna per riscaricare)")
        return json.loads(cache.read_text(encoding="utf-8"))

    def passaggio(nome, scarica_dati):
        file = CACHE / f"aree_servizio_v3_{paese}_{nome}.json"
        if file.exists() and not aggiorna:
            return json.loads(file.read_text(encoding="utf-8"))
        dati = scarica_dati()
        CACHE.mkdir(exist_ok=True)
        file.write_text(json.dumps(dati), encoding="utf-8")
        return dati

    def base():
        tutto = richiesta_overpass(query_aree_servizio(paese), f"aree di servizio e colonnine in {paese}")
        elementi = tutto.get("elements", [])
        aree, colonnine = colonnine_in_aree_servizio(elementi)
        if not tracciato():
            print(f"  {FILE_AUTOSTRADE.name} mancante: niente colonnine fuori dalle aree di servizio")
        tutte = [e for e in elementi if e.get("tags", {}).get("amenity") == "charging_station"]
        # Si tengono quelle entro USCITA_MAX_M: elabora() applica il limite più stretto, così
        # cambiarlo non richiede di riscaricare
        return {"aree": aree, "colonnine": colonnine,
                "fuori": colonnine_veloci_vicino_autostrada(tutte, colonnine, tracciato())}

    dati = passaggio("base", base)
    aree, colonnine, fuori = dati["aree"], dati["colonnine"], dati["fuori"]
    print(f"  {paese}: {len(colonnine)} colonnine in {len(aree)} aree di servizio, "
          f"{len(fuori)} colonnine veloci vicino all'autostrada")

    # Le autostrade si chiedono solo attorno alle aree: per le colonnine fuori basta il tracciato locale
    punti = [tuple(round(v, 5) for v in posizione(a)) for a in aree if posizione(a)]
    autostrade = {}
    for i in range(0, len(punti), LOTTO_AUTOSTRADE):
        lotto = punti[i:i + LOTTO_AUTOSTRADE]
        descrizione = f"autostrade vicine, aree {i + 1}-{i + len(lotto)} di {len(punti)}"
        risposta = passaggio(f"autostrade_{i // LOTTO_AUTOSTRADE}",
                             lambda: richiesta_overpass(query_autostrade_vicine(lotto), descrizione, vuota_ok=True))
        for el in risposta.get("elements", []):
            autostrade[el["id"]] = el

    risultato = {"elements": aree + colonnine + fuori + list(autostrade.values())}
    cache.write_text(json.dumps(risultato), encoding="utf-8")
    # Completo: le cache dei singoli passaggi (e quelle delle versioni precedenti) non servono più
    for parziale in [*CACHE.glob(f"aree_servizio_v3_{paese}_*.json"), *CACHE.glob(f"aree_servizio_v2_{paese}*.json")]:
        parziale.unlink()
    return risultato


def query_operatore(paese, operatore):
    filtro = re.escape(operatore)
    return f"""
[out:json][timeout:300];
area["ISO3166-1"="{paese}"][admin_level=2]->.paese;
nwr["amenity"="charging_station"](area.paese)->.tutte;
(
  nwr.tutte["operator"~"{filtro}",i];
  nwr.tutte["network"~"{filtro}",i];
  nwr.tutte["brand"~"{filtro}",i];
)->.colonnine;
.colonnine out tags center;
// around funziona solo a partire dai nodi: le colonnine mappate come poligoni vanno scomposte
(way.colonnine; way(r.colonnine);)->.vie;
(node.colonnine; node(w.vie);)->.punti;
way(around.punti:{USCITA_MAX_M})["highway"="motorway"]->.autostrade;
.autostrade out tags geom;
nwr(around.punti:{CARREGGIATA_MAX_M})["highway"~"^(services|rest_area)$"]->.aree;
.aree out tags geom;
"""


def scarica_svincoli(paese, aggiorna):
    """Svincoli autostradali del paese (nodi highway=motorway_junction), con cache propria."""
    cache = CACHE / f"svincoli_{paese}.json"
    if cache.exists() and not aggiorna:
        return json.loads(cache.read_text(encoding="utf-8"))
    query = f"""
[out:json][timeout:180];
area["ISO3166-1"="{paese}"][admin_level=2]->.paese;
node["highway"="motorway_junction"](area.paese);
out skel;
"""
    svincoli = richiesta_overpass(query, f"svincoli in {paese}").get("elements", [])
    for s in svincoli:
        s["tags"] = {"highway": "motorway_junction"}
    CACHE.mkdir(exist_ok=True)
    cache.write_text(json.dumps(svincoli), encoding="utf-8")
    return svincoli


def scarica(paese, operatore, aggiorna=False):
    """Risposta Overpass per un paese; salvata in tools/cache/ e riusata se già presente.
    operatore None = tutte le colonnine nelle aree di servizio, più gli svincoli."""
    if operatore is None:
        risposta = scarica_aree_servizio(paese, aggiorna)
        svincoli = scarica_svincoli(paese, aggiorna)
        print(f"  {paese}: {len(svincoli)} svincoli autostradali")
        return {"elements": risposta["elements"] + svincoli}
    cache = CACHE / f"{operatore.lower()}_{paese}.json"
    if cache.exists() and not aggiorna:
        print(f"{paese}: uso la cache {cache.name} (--aggiorna per riscaricare)")
        return json.loads(cache.read_text(encoding="utf-8"))

    risposta = richiesta_overpass(query_operatore(paese, operatore), f"{operatore} in {paese}")
    CACHE.mkdir(exist_ok=True)
    cache.write_text(json.dumps(risposta), encoding="utf-8")
    return risposta


def post_overpass(server, query):
    import requests
    try:
        r = requests.post(server, data={"data": query}, headers=HEADERS, timeout=360)
    except requests.exceptions.SSLError:
        # Il Python di sistema di macOS (LibreSSL) non completa l'handshake con alcuni server
        esito = subprocess.run(["curl", "-sS", "--fail", "-m", "360", "-A", HEADERS["User-Agent"],
                                "--data-urlencode", "data@-", server],
                               input=query, capture_output=True, text=True)
        if esito.returncode:
            raise ValueError(esito.stderr.strip())
        return json.loads(esito.stdout)
    if r.status_code in (429, 502, 503, 504):
        raise requests.HTTPError(f"HTTP {r.status_code}")
    r.raise_for_status()
    return r.json()


def richiesta_overpass(query, descrizione, vuota_ok=False):
    import requests
    errori = []
    for server in OVERPASS:
        for tentativo in range(1, TENTATIVI_PER_SERVER + 1):
            print(f"Overpass ({server.split('/')[2]}, tentativo {tentativo}): {descrizione}...")
            try:
                risposta = post_overpass(server, query)
                # Su timeout o memoria esaurita Overpass risponde 200 con dati parziali e un "remark"
                avviso = risposta.get("remark", "")
                if "error" in avviso.lower():
                    raise ValueError(f"risposta parziale: {avviso}")
                # Alcuni mirror non hanno le aree dei paesi e rispondono 200 senza elementi
                if not risposta.get("elements") and not vuota_ok:
                    raise ValueError("risposta vuota")
                return risposta
            except (requests.RequestException, ValueError) as err:
                errori.append(f"{server}: {err}")
                print(f"  fallito: {err}")
                if tentativo < TENTATIVI_PER_SERVER:
                    time.sleep(30 * tentativo)
    raise RuntimeError("Tutti i server Overpass hanno fallito:\n" + "\n".join(errori))


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
        kw = potenza_kw(tags.get(f"socket:{chiave}:output", ""))
        potenza = f"{kw:g} kW" if kw else ""
        risultato += [{"modello": f"{nome} {potenza}".strip()}] * int(n)
    return risultato


def colonnina(el):
    tags = el.get("tags", {})
    return {
        "codice": f"osm:{el['type']}/{el['id']}",
        "modello": tags.get("name") or tags.get("operator") or tags.get("network") or "",
        "operatore": operatore_di(tags),
        "connettori": connettori(tags),
    }


def operatore_di(tags):
    nome = (tags.get("operator") or tags.get("network") or tags.get("brand") or "").strip()
    nome = normalizza_operatore(nome)
    return next((canonico for regola, canonico in NOMI_OPERATORI if regola.search(nome)), nome)


def normalizza_operatore(nome):
    # "Tank & Rast; innogy; e-on": si tiene il primo
    nome = nome.split(";")[0].strip()
    return "" if NON_OPERATORI.match(nome) else nome


def elabora(risposta, paese, operatore, dettagli=False):
    """Converte la risposta Overpass in aree nel formato dell'app (vedi data/*.json).
    operatore None = tutti gli operatori: colonnine dentro aree di servizio e colonnine veloci
    raggiungibili uscendo, escluse quelle degli operatori che hanno già una fonte dedicata
    (Free To X, IONITY)."""
    elementi = risposta.get("elements", [])
    colonnine = [e for e in elementi if e.get("tags", {}).get("amenity") == "charging_station"]
    if operatore is None:
        colonnine = [c for c in colonnine if not OPERATORI_CON_FONTE.search(operatore_di(c.get("tags", {})))]
    autostrade = [e for e in elementi if e.get("tags", {}).get("highway") == "motorway"]
    aree_servizio = [e for e in elementi if e.get("tags", {}).get("highway") in ("services", "rest_area")]
    svincoli = [e for e in elementi if e.get("tags", {}).get("highway") == "motorway_junction"]
    griglia_svincoli = indice_spaziale(svincoli, SVINCOLO_MAX_M)
    if operatore is None and not svincoli:
        print(f"  {paese}: nessuno svincolo scaricato, le colonnine vicino alle uscite non vengono filtrate")

    aree = {}
    for c in colonnine:
        p = posizione(c)
        if not p:
            continue
        dist_autostrada, via, direzione = autostrada_piu_vicina(p, autostrade)
        area_servizio = min(aree_servizio, key=lambda a: distanza_elemento_m(p, a), default=None)
        dist_area = distanza_elemento_m(p, area_servizio) if area_servizio else math.inf
        in_area = (dist_area <= AREA_SERVIZIO_MAX_M and dist_autostrada <= CARREGGIATA_MAX_M
                   and not NOME_AUTOHOF.search(area_servizio["tags"].get("name", "")))

        if dettagli:
            esito = "scartata" if dist_autostrada > USCITA_MAX_M else "area di servizio" if in_area else "uscita"
            nome_area = area_servizio["tags"].get("name", "?") if area_servizio else "-"
            print(f"  {c.get('tags', {}).get('name', c['id'])!s:40.40} {p[0]:.5f},{p[1]:.5f}  "
                  f"autostrada {dist_autostrada:6.0f} m  area '{nome_area}' {dist_area:6.0f} m  → {esito}")

        # Tutti gli operatori: fuori dalle aree di servizio sarebbero colonnine qualsiasi.
        # Si tengono quelle dentro un'area, anche se lontana dall'autostrada (da verificare),
        # e quelle veloci vicino all'autostrada (uscita), misurata sul tracciato locale, e a uno svincolo
        dentro_area_lontana = not in_area and dist_area == 0
        fuori_veloce = operatore is None and not in_area and not dentro_area_lontana
        if fuori_veloce:
            if not ricarica_veloce(c.get("tags", {})):
                continue
            dist_autostrada, sigla_locale = tracciato_piu_vicino(p, tracciato())
            if dist_autostrada > USCITA_VELOCI_MAX_M:
                continue
            vicini = griglia_svincoli.get((math.floor(p[0] / CELLA_GRADI), math.floor(p[1] / CELLA_GRADI)), [])
            if svincoli and not any(distanza_elemento_m(p, s) <= SVINCOLO_MAX_M for s in vicini):
                continue
        elif dist_autostrada > USCITA_MAX_M:
            continue

        chiave = f"osm:{area_servizio['type']}/{area_servizio['id']}" if in_area else colonnina(c)["codice"]
        if chiave in aree:
            aree[chiave]["colonnine"].append(colonnina(c))
            continue

        tags_area = area_servizio["tags"] if in_area or dentro_area_lontana else {}
        strada = sigla_locale if fuori_veloce else codice_autostrada(via["tags"])
        aree[chiave] = {
            "codice": chiave,
            "nome": tags_area.get("name") or c.get("tags", {}).get("name")
                    or f"{operatore or (colonnina(c)['operatore'] or 'Colonnina' if not in_area else 'Area di servizio')} {strada}".strip(),
            "strada": strada,
            "direzione": via["tags"].get("destination", "") if in_area else "",
            "direzione_geografica": punto_cardinale(direzione) if in_area and direzione is not None else "ND",
            "exitRequired": not in_area,
            "lat": round(p[0], 6),
            "lon": round(p[1], 6),
            "paese": paese,
            "operatore": operatore,
            "distanzaAutostradaM": round(dist_autostrada),
            "tipoArea": tags_area.get("highway"),
            "dentroAreaServizio": area_servizio["tags"].get("name") or True if dentro_area_lontana else None,
            "colonnine": [colonnina(c)],
        }

    risultato = raggruppa_vicine(list(aree.values()))
    if operatore is None:
        for area in risultato:
            area["operatore"] = ", ".join(sorted({c["operatore"] for c in area["colonnine"] if c["operatore"]})) or "sconosciuto"
    return risultato


PAROLE_IGNORATE = {"area", "di", "servizio", "ads", "del", "della", "al", "s", "san", "sant", "santo", "santa"}


def parole(nome):
    return set(re.sub(r"[^a-zàèéìòùäöüß0-9]+", " ", (nome or "").lower()).split()) - PAROLE_IGNORATE


def nome_coincide(nostro, osm):
    """Tutte le parole significative del nostro nome compaiono in quello OSM.
    "S.MARTINO EST" ↔ "Area di servizio San Martino Est"; il lato (est/ovest) deve coincidere."""
    nostre = parole(nostro)
    return bool(nostre) and nostre <= parole(osm)


def carica_aree_ufficiali(fonti=FONTI_UFFICIALI):
    aree = []
    for nome in fonti:
        file = DATA / nome
        if file.exists():
            aree += [a for a in json.loads(file.read_text(encoding="utf-8")).get("listaAree", [])
                     if a.get("lat") is not None and a.get("lon") is not None]
    return aree


def motivi_dubbio(area, aree_ufficiali):
    """Ragioni per cui la classificazione automatica di un'area non è affidabile."""
    motivi = []
    distanza = area.get("distanzaAutostradaM")
    if not area["exitRequired"]:
        if area["direzione_geografica"] == "ND":
            motivi.append("carreggiata non determinata")
        if area.get("tipoArea") == "rest_area":
            motivi.append("piazzola di sosta (rest_area), di solito senza servizi")
        if distanza is not None and distanza > AREA_LONTANA_M and not NOME_AREA_SERVIZIO.search(area["nome"]):
            motivi.append(f"a {distanza} m dall'autostrada, lontana per un'area di servizio")
    else:
        if area.get("dentroAreaServizio"):
            nome = area["dentroAreaServizio"] if isinstance(area["dentroAreaServizio"], str) else "un'area di servizio"
            motivi.append(f"dentro {nome} ma a {distanza} m dall'autostrada")
        if NOME_AREA_SERVIZIO.search(area["nome"]):
            motivi.append("il nome indica un'area di servizio")
        if distanza is not None and distanza <= USCITA_VICINA_M and not NOME_AUTOHOF.search(area["nome"]):
            motivi.append(f"a {distanza} m dall'autostrada ma nessuna area di servizio mappata")
        p = (area["lat"], area["lon"])
        vicina = min(aree_ufficiali, default=None,
                     key=lambda u: distanza_segmento_m(p, (u["lat"], u["lon"]), (u["lat"], u["lon"])))
        if vicina and distanza_segmento_m(p, (vicina["lat"], vicina["lon"]), (vicina["lat"], vicina["lon"])) <= AREA_UFFICIALE_M:
            motivi.append(f"vicina all'area di servizio {vicina['nome']}")
    return motivi


def classifica(aree, aree_ufficiali):
    for area in aree:
        motivi = motivi_dubbio(area, aree_ufficiali)
        area["daVerificare"] = bool(motivi)
        area["motivo"] = "; ".join(motivi)
    return aree


def raggruppa_vicine(aree, raggio_m=RAGGRUPPA_M):
    """Unisce ogni area fuori autostrada alla sede più vicina entro raggio_m: OSM mappa
    spesso ogni colonnina di una sede come elemento separato, a volte appena fuori dal
    perimetro dell'area di servizio. Le aree di servizio restano distinte (una per carreggiata)."""
    risultato = [a for a in aree if not a["exitRequired"]]
    for area in (a for a in aree if a["exitRequired"]):
        p = (area["lat"], area["lon"])
        vicine = [(distanza_segmento_m(p, (r["lat"], r["lon"]), (r["lat"], r["lon"])), r) for r in risultato]
        distanza, vicina = min(vicine, key=lambda v: v[0], default=(math.inf, None))
        if distanza <= raggio_m:
            vicina["colonnine"] += area["colonnine"]
        else:
            risultato.append(area)
    return risultato


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--operatore", default="IONITY")
    parser.add_argument("--tutti-gli-operatori", action="store_true",
                        help="colonnine di qualsiasi operatore nelle aree di servizio, tranne Free To X e "
                             "IONITY che hanno una fonte propria (output: osm_aree_servizio.json); le aree "
                             "presenti anche in altre fonti le unisce tools/Compila_Aree.py")
    parser.add_argument("--paesi", default="IT,DE,CH,AT", help="codici ISO separati da virgola")
    parser.add_argument("--unisci", action="store_true",
                        help="conserva nel file di output le aree degli altri paesi (e le loro correzioni)")
    parser.add_argument("--output", help="file in data/ (default: <operatore>_osm.json)")
    parser.add_argument("--aggiorna", action="store_true", help="riscarica ignorando tools/cache/")
    parser.add_argument("--dettagli", action="store_true", help="distanze e classificazione di ogni colonnina")
    args = parser.parse_args()
    operatore = None if args.tutti_gli_operatori else args.operatore

    predefinito = f"{operatore.lower()}_osm.json" if operatore else "osm_aree_servizio.json"
    output = DATA / (args.output or predefinito)
    precedenti = json.loads(output.read_text(encoding="utf-8"))["listaAree"] if output.exists() else []
    paesi = [p.strip().upper() for p in args.paesi.split(",")]

    aree, falliti = [], []
    ufficiali = carica_aree_ufficiali()
    for paese in paesi:
        try:
            risposta = scarica(paese, operatore, args.aggiorna)
        except RuntimeError as err:
            # Un paese che fallisce non deve far perdere gli altri: si tengono i suoi dati precedenti
            vecchie = [a for a in precedenti if a["paese"] == paese]
            print(f"  {paese}: DOWNLOAD NON RIUSCITO ({str(err).splitlines()[0].rstrip(':')}); tengo le {len(vecchie)} "
                  "aree del download precedente")
            falliti.append(paese)
            aree += vecchie
            continue
        trovate = elabora(risposta, paese, operatore, args.dettagli)
        trovate = classifica(trovate, ufficiali)
        print(f"  {paese}: {len(trovate)} aree ({sum(a['exitRequired'] for a in trovate)} fuori autostrada, "
              f"{sum(a['daVerificare'] for a in trovate)} da verificare)")
        aree += trovate

    if args.unisci:
        aree = [a for a in precedenti if a["paese"] not in paesi] + aree
    output.write_text(json.dumps({
        "listaAree": aree,
        "data_download": datetime.now(timezone.utc).isoformat(),
        "fonte": "© OpenStreetMap contributors, ODbL",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(aree)} aree salvate in {output}")
    if falliti:
        # Codice d'uscita diverso da 0: i comandi concatenati con && (compilazione, commit) non partono
        sys.exit(f"Download non riuscito per {', '.join(falliti)} (server Overpass sovraccarichi). "
                 "Rilancia lo stesso comando più tardi: riparte da dove si è fermato.")


if __name__ == "__main__":
    main()
