"""Converte tutte le fonti di aree di servizio in un formato unico e lo verifica.

Ogni fonte (Free To X, A22, IONITY, altri operatori da OSM) ha campi e convenzioni
diverse; qui un convertitore per fonte produce record nel FORMATO UNICO descritto sotto,
e un controllo segnala errori (bloccanti) e avvisi. Output: data/aree.json.

Passi successivi (non ancora fatti): unire le aree che sono lo stesso posto fisico
in fonti diverse, e far leggere data/aree.json all'app.

Formato di un'area:
  id             "ftx:493", "a22:A22_001", "osm:way/123" (le aree OSM tengono l'id OSM:
                 la stessa area in due fonti OSM ha lo stesso id, utile per unirle)
  codiceOrigine  chiave usata finora da revisioni.json (codice originale o "nome:...")
  fonte          "free_to_x" | "a22" | "test" | "ionity" | "osm"
  nome, paese    paese ISO a due lettere
  autostrada     sigla ("A1", "A7", "RA3"…) o null
  tratta         es. "Milano-Napoli" o null
  carreggiata    NORD, NORDEST, … NORDOVEST o null se non nota
  destinazione   città o direzione indicata dalla fonte, o null
  accesso        "area_servizio" | "uscita" (fuori dal casello) | "fuori_autostrada"
  lat, lon, km   km = progressiva chilometrica o null
  indirizzo      indirizzo da reverse geocoding o null
  distanzaAutostradaM  solo fonti OSM, altrimenti null
  operatori      elenco ordinato degli operatori delle colonnine
  colonnine      [{id, operatore, modello, potenzaKw, attivaDal, guasti,
                   connettori: [{tipo, potenzaKw}]}]
                 tipo: CCS | CHAdeMO | Type 2 | Tesla | altro
  verifica       motivo per cui va controllata a mano, o null

Uso:  python tools/Compila_Aree.py            (scrive data/aree.json)
      python tools/Compila_Aree.py --controlla (solo controllo, non scrive)
"""
import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
OUTPUT = DATA / "aree.json"

CARREGGIATE = ["NORD", "NORDEST", "EST", "SUDEST", "SUD", "SUDOVEST", "OVEST", "NORDOVEST"]
ACCESSI = {"area_servizio", "uscita", "fuori_autostrada"}
TIPI_CONNETTORE = {"CCS", "CHAdeMO", "Type 2", "Tesla", "altro"}
FONTI = {"free_to_x", "a22", "test", "ionity", "osm"}

# Area geografica plausibile per le fonti attuali (Europa)
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 34.0, 56.0, -10.0, 30.0
POTENZA_MAX_KW = 1000
POTENZA_MAX_AC_KW = 43


# --- Conversioni di base ---

def leggibile(testo):
    """"ARDA EST" → "Arda Est"; i testi già in maiuscolo/minuscolo misto restano invariati."""
    testo = (testo or "").strip()
    if not testo:
        return None
    if not testo.isupper():
        return testo
    parole = testo.title().split(" ")
    return " ".join(p.lower() if i and p.lower() in PAROLE_MINUSCOLE else p for i, p in enumerate(parole))


PAROLE_MINUSCOLE = {"di", "del", "della", "dei", "delle", "al", "alla", "e", "da", "in"}


def carreggiata(valore):
    valore = (valore or "").strip().upper()
    return valore if valore in CARREGGIATE else None


def potenza_kw(testo):
    """"HPC 300 kW" → 300, "CCS 350" → 350, "Type 2 Ricarica AC (22 kW)" → 22, "CCS" → None."""
    # Il "2" di "Type 2" non è una potenza
    testo = re.sub(r"\btype\s?2|\btyp\s?2", " ", (testo or "").lower())
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:kw\b|$)", testo.strip())
    return float(m.group(1).replace(",", ".")) if m else None


def tipo_connettore(testo):
    t = (testo or "").lower()
    if "ccs" in t or "combo" in t:
        return "CCS"
    if "chademo" in t:
        return "CHAdeMO"
    if "tesla" in t or "supercharger" in t:
        return "Tesla"
    if re.search(r"type\s?2|typ\s?2|mennekes", t):
        return "Type 2"
    return "altro"


def data_iso(millisecondi):
    if not millisecondi:
        return None
    return datetime.fromtimestamp(millisecondi / 1000, timezone.utc).date().isoformat()


def codice_origine(area):
    """Chiave con cui l'app e revisioni.json identificano oggi un'area (vedi idArea in js/core/dati.js)."""
    return str(area["codice"]) if area.get("codice") is not None else f"nome:{area['nome']}"


def sigla_e_tratta(strada):
    """"A1 MILANO-NAPOLI" → ("A1", "Milano-Napoli"); "A22 BRENNERO" → ("A22", "Brennero")."""
    strada = (strada or "").strip()
    m = re.match(r"^([A-Z]{1,3}\s?\d+[A-Za-z]*)\s*(.*)$", strada)
    if not m:
        return None, leggibile(strada)
    return m.group(1).replace(" ", ""), leggibile(m.group(2))


def area_base(area, fonte, id_):
    return {
        "id": id_,
        "codiceOrigine": codice_origine(area),
        "fonte": fonte,
        "nome": leggibile(area.get("nome")) or "",
        "paese": area.get("paese") or "IT",
        "autostrada": None,
        "tratta": None,
        "carreggiata": None,
        "destinazione": None,
        "accesso": "area_servizio",
        "lat": area.get("lat"),
        "lon": area.get("lon"),
        "km": area.get("km") if isinstance(area.get("km"), (int, float)) else None,
        "indirizzo": None,
        "distanzaAutostradaM": None,
        "operatori": [],
        "colonnine": [],
        "verifica": area.get("motivo") if area.get("daVerificare") else None,
    }


def con_operatori(area):
    area["operatori"] = sorted({c["operatore"] for c in area["colonnine"] if c["operatore"]})
    return area


# --- Convertitori per fonte ---

def colonnine_autostrade(area, operatore):
    """Colonnine nel formato Free To X / A22: potenza nel modello della colonnina,
    connettori senza potenza (salvo le prese AC, es. "Type 2 Ricarica AC (22 kW)")."""
    risultato = []
    for c in area.get("colonnine", []):
        connettori = [{"tipo": tipo_connettore(n.get("modello")), "potenzaKw": potenza_kw(n.get("modello"))}
                      for n in c.get("connettori", [])]
        risultato.append({
            "id": str(c.get("codice")),
            "operatore": operatore,
            "modello": c.get("modello"),
            "potenzaKw": potenza_kw(c.get("modello")),
            "attivaDal": data_iso(c.get("dataAttivazione")),
            "guasti": c.get("guasti") or None,
            "connettori": connettori,
        })
    return risultato


def da_free_to_x(area, fonte="free_to_x"):
    prefisso = "ftx" if fonte == "free_to_x" else fonte
    if area.get("codice") is not None:
        id_ = f"{prefisso}:{area['codice']}"
    else:
        id_ = f"{prefisso}:" + re.sub(r"[^a-z0-9]+", "-", area["nome"].lower()).strip("-")
    r = area_base(area, fonte, id_)
    r["autostrada"], r["tratta"] = sigla_e_tratta(area.get("strada"))
    r["carreggiata"] = carreggiata(area.get("direzione_geografica"))
    r["destinazione"] = leggibile(area.get("direzione"))
    r["indirizzo"] = area.get("stradaReverse") or None
    # Senza autostrada (es. aeroporti di Milano) la stazione non è su un'autostrada
    if not r["autostrada"]:
        r["accesso"] = "fuori_autostrada"
    r["colonnine"] = colonnine_autostrade(area, "Free To X")
    return con_operatori(r)


def da_a22(area):
    r = area_base(area, "a22", f"a22:{area['codice']}")
    r["autostrada"], r["tratta"] = sigla_e_tratta(area.get("strada"))
    # Nei dati A22 "direzione" contiene la carreggiata (NORD/SUD), non una destinazione
    r["carreggiata"] = carreggiata(area.get("direzione_geografica")) or carreggiata(area.get("direzione"))
    r["accesso"] = "uscita" if area.get("exitRequired") else "area_servizio"
    r["colonnine"] = colonnine_autostrade(area, "Autostrada del Brennero")
    for c in r["colonnine"]:
        if any(n["tipo"] == "Tesla" for n in c["connettori"]):
            c["operatore"] = "Tesla"
    return con_operatori(r)


def da_osm(area, fonte):
    r = area_base(area, fonte, area["codice"])
    r["autostrada"] = area.get("strada") or None
    r["carreggiata"] = carreggiata(area.get("direzione_geografica"))
    r["destinazione"] = leggibile(area.get("direzione"))
    r["accesso"] = "uscita" if area.get("exitRequired") else "area_servizio"
    r["distanzaAutostradaM"] = area.get("distanzaAutostradaM")
    operatore_area = area.get("operatore") if fonte == "ionity" else None
    for c in area.get("colonnine", []):
        connettori = [{"tipo": tipo_connettore(n.get("modello")), "potenzaKw": potenza_kw(n.get("modello"))}
                      for n in c.get("connettori", [])]
        potenze = [n["potenzaKw"] for n in connettori if n["potenzaKw"]]
        r["colonnine"].append({
            "id": c["codice"],
            "operatore": c.get("operatore") or operatore_area or None,
            "modello": c.get("modello") or None,
            "potenzaKw": max(potenze) if potenze else None,
            "attivaDal": None,
            "guasti": None,
            "connettori": connettori,
        })
    return con_operatori(r)


SORGENTI = [
    ("free_to_x_reverse.json", lambda a: da_free_to_x(a)),
    ("a22_brennero_geocoded.json", da_a22),
    ("test.json", lambda a: da_free_to_x(a, "test")),
    ("ionity_osm.json", lambda a: da_osm(a, "ionity")),
    ("osm_aree_servizio.json", lambda a: da_osm(a, "osm")),
]


def converti_tutto():
    aree = []
    for file, converti in SORGENTI:
        percorso = DATA / file
        if not percorso.exists():
            print(f"  {file}: assente, saltato")
            continue
        grezze = json.loads(percorso.read_text(encoding="utf-8")).get("listaAree", [])
        aree += [converti(a) for a in grezze]
    return aree


# --- Controllo ---

def controlla(aree):
    """(errori, avvisi): gli errori rendono i dati inutilizzabili, gli avvisi vanno guardati."""
    errori, avvisi = [], {}
    visti = {}
    for a in aree:
        chi = f"{a.get('fonte')} {a.get('id')} ({a.get('nome')})"
        for campo, tipo in [("id", str), ("nome", str), ("paese", str), ("fonte", str), ("accesso", str),
                            ("lat", (int, float)), ("lon", (int, float)), ("operatori", list), ("colonnine", list)]:
            if not isinstance(a.get(campo), tipo):
                errori.append(f"{chi}: campo '{campo}' mancante o del tipo sbagliato")
        if a.get("fonte") not in FONTI:
            errori.append(f"{chi}: fonte sconosciuta")
        if a.get("accesso") not in ACCESSI:
            errori.append(f"{chi}: accesso '{a.get('accesso')}' non valido")
        if a.get("carreggiata") is not None and a["carreggiata"] not in CARREGGIATE:
            errori.append(f"{chi}: carreggiata '{a['carreggiata']}' non valida")
        if not re.fullmatch(r"[A-Z]{2}", a.get("paese") or ""):
            errori.append(f"{chi}: paese '{a.get('paese')}' non è un codice ISO")
        if isinstance(a.get("lat"), (int, float)) and isinstance(a.get("lon"), (int, float)):
            if not (LAT_MIN <= a["lat"] <= LAT_MAX and LON_MIN <= a["lon"] <= LON_MAX):
                errori.append(f"{chi}: coordinate {a['lat']}, {a['lon']} fuori dall'Europa")

        chiave = (a.get("fonte"), a.get("id"))
        if chiave in visti:
            errori.append(f"{chi}: id ripetuto nella stessa fonte")
        visti[chiave] = a

        if a.get("accesso") == "area_servizio" and not a.get("autostrada"):
            avvisi.setdefault(f"{chi}: area di servizio senza autostrada")
        if a.get("accesso") == "area_servizio" and a.get("carreggiata") is None:
            avvisi.setdefault(f"{chi}: area di servizio senza carreggiata")
        if not a.get("colonnine"):
            avvisi.setdefault(f"{chi}: nessuna colonnina")
        for c in a.get("colonnine", []):
            for n in c.get("connettori", []):
                if n.get("tipo") not in TIPI_CONNETTORE:
                    errori.append(f"{chi}: tipo connettore '{n.get('tipo')}' non valido")
                p = n.get("potenzaKw")
                if p is not None and not (0 < p <= POTENZA_MAX_KW):
                    errori.append(f"{chi}: potenza {p} kW fuori scala")
                elif p is not None and n.get("tipo") == "Type 2" and p > POTENZA_MAX_AC_KW:
                    avvisi.setdefault(f"{chi}: presa Type 2 da {p:g} kW, improbabile per la ricarica AC")
    return errori, list(avvisi)


def doppioni_tra_fonti(aree):
    """Id presenti in più fonti: sono la stessa area OSM, da unire nel passo successivo."""
    per_id = {}
    for a in aree:
        per_id.setdefault(a["id"], set()).add(a["fonte"])
    return {i: sorted(f) for i, f in per_id.items() if len(f) > 1}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--controlla", action="store_true", help="solo controllo, non scrive data/aree.json")
    parser.add_argument("--avvisi", action="store_true", help="elenca tutti gli avvisi")
    args = parser.parse_args()

    aree = converti_tutto()
    errori, avvisi = controlla(aree)

    per_fonte = {}
    for a in aree:
        per_fonte[a["fonte"]] = per_fonte.get(a["fonte"], 0) + 1
    print(f"{len(aree)} aree: " + ", ".join(f"{f} {n}" for f, n in per_fonte.items()))
    doppioni = doppioni_tra_fonti(aree)
    if doppioni:
        print(f"{len(doppioni)} aree presenti in più fonti (da unire): {list(doppioni.items())[:5]}")

    tipi_avviso = {}
    for av in avvisi:
        tipo = av.split(": ", 1)[1].split(" da ")[0].split(" '")[0]
        tipi_avviso[tipo] = tipi_avviso.get(tipo, 0) + 1
    print(f"{len(avvisi)} avvisi: {tipi_avviso}")
    if args.avvisi:
        for av in avvisi:
            print("  avviso:", av)
    for e in errori:
        print("  ERRORE:", e)
    if errori:
        print(f"{len(errori)} errori: data/aree.json non scritto")
        sys.exit(1)

    if not args.controlla:
        OUTPUT.write_text(json.dumps({
            "versione": 1,
            "generato": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "aree": aree,
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Scritto {OUTPUT.relative_to(DATA.parent)}")


if __name__ == "__main__":
    main()
