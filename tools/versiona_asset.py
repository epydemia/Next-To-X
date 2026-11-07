"""Aggiunge ?v=<versione> ai CSS e agli script delle pagine e a ogni import relativo dei moduli.

Lo usa il workflow di pubblicazione (.github/workflows/static.yml) sulla copia da pubblicare,
non sul repository: a ogni rilascio cambiano gli URL, quindi i browser scaricano subito i
file nuovi invece di aspettare la scadenza della cache di GitHub Pages (10 minuti).
Tutti i file ricevono la stessa versione: un modulo importato con due URL diversi verrebbe
caricato due volte, con due stati separati.

Uso:  python3 tools/versiona_asset.py <versione> [cartella]   (default: la radice del repository)
"""
import re
import sys
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent

LINK_PAGINE = re.compile(r'((?:href|src)=")((?:css|js)/[^"?#]+\.(?:css|js))"')
IMPORT_RELATIVI = re.compile(r"""(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}/[^'"?#]+\.js)\2""")


def versiona(versione, radice=RADICE):
    if not re.fullmatch(r"[A-Za-z0-9._-]+", versione):
        raise ValueError(f"versione non valida: {versione!r}")
    query = f"?v={versione}"
    modificati = 0
    for html in radice.glob("*.html"):
        modificati += riscrivi(html, lambda t: LINK_PAGINE.sub(lambda m: f'{m[1]}{m[2]}{query}"', t))
    for modulo in (radice / "js").rglob("*.js"):
        modificati += riscrivi(modulo, lambda t: IMPORT_RELATIVI.sub(lambda m: f"{m[1]}{m[2]}{m[3]}{query}{m[2]}", t))
    return modificati


def riscrivi(percorso, trasforma):
    testo = percorso.read_text(encoding="utf-8")
    nuovo = trasforma(testo)
    if nuovo == testo:
        return 0
    percorso.write_text(nuovo, encoding="utf-8")
    return 1


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    cartella = Path(sys.argv[2]) if len(sys.argv) == 3 else RADICE
    print(f"{versiona(sys.argv[1], cartella)} file con versione {sys.argv[1]}")
