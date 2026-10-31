# ⚡ Next-To-X

**Next-To-X** is a lightweight web app for driving on highways in Italy, Germany, Switzerland and Austria: it follows your GPS position and heading and shows the next EV charging station ahead of you, on your side of the highway.

Live: published on GitHub Pages on every push to `main` (`.github/workflows/static.yml`).

---

## Pages

| Page | Purpose |
| --- | --- |
| `index.html` | Driving app: map, next station, distance bar, nearby stations list |
| `stazioni.html` | Station editor: browse all stations, fix positions, save the JSON files back |
| `autostrade.html` | Overview of stations along a highway, split by carriageway |

## Project structure

```
index.html, stazioni.html, autostrade.html
css/app.css                 Driving app styles (dark theme)
js/
├── config.js               Data file, source labels, map tiles, tunable constants
├── core/                   Pure logic, no DOM
│   ├── geo.js              Distance, bearing, heading helpers
│   ├── autostrade.js       Highway table (names, axis) and code lookup
│   ├── dati.js             Loads data/aree.json and applies revisioni.json
│   └── filtroStazioni.js   Which stations are ahead / next
├── app/                    Driving app (index.html)
│   ├── main.js             Entry point: wires everything together
│   ├── posizione.js        GPS, heading, reverse geocoding → position state
│   ├── simulazione.js      Simulated position: default route or CSV track
│   ├── mappa.js            Leaflet map, user marker, station markers
│   └── hud.js              HUD, next-station panel, distance bar, table
└── pages/
    ├── stazioni.js         Station editor
    └── autostrade.js       Highway overview
data/                       aree.json (what the pages read), the per-source files it is built from, revisioni.json
tools/                      Python scripts that download, check and compile the datasets
```

Data flow in the driving app: `posizione.js` produces a position state (`coords`, `heading`, `strada`, `codiceAutostrada`) → `main.js` passes it to `filtroStazioni.js` → the result is drawn by `mappa.js` and `hud.js`.

## Running locally

ES modules need an HTTP server:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Geolocation requires `localhost` or HTTPS.

## Simulated position

Open ⚙ → **Simula posizione**. The app replays a default route on the A14, or a CSV track you upload (TeslaFi export format: `Latitude`, `Longitude`, optional `Timestamp (CEST)`), 10× faster than real time.

## How the data is organised

The pages read a single file, `data/aree.json`, built by `python tools/Compila_Aree.py` from the files of each source (`free_to_x_reverse.json`, `a22_brennero_geocoded.json`, `ionity_osm.json`, `osm_aree_servizio.json`). **Run it after updating any source.** Manual corrections live in `data/revisioni.json` and are applied by the pages on load, so saving them from the editor takes effect without recompiling.

To add a source: write a converter in `tools/Compila_Aree.py` (add it to `SORGENTI`, its name to `FONTI` and `PRIORITA_FONTI`), and a label in `FONTI` in `js/config.js`.

## Updating the data

| Source | Command | Output |
| --- | --- | --- |
| Free To X (Italy) | `python tools/Download_Free_To_X.py && python tools/ReverseGeocoding.py` | `data/free_to_x_reverse.json` |
| IONITY (Italy, Germany, Switzerland, Austria) from OpenStreetMap | `python tools/Download_OSM_Colonnine.py --operatore IONITY --paesi IT,DE,CH,AT` | `data/ionity_osm.json` |
| Every other operator in motorway service areas (e.g. ASTM network: A4 Torino-Milano, A6, A10, A12…) | `python tools/Download_OSM_Colonnine.py --tutti-gli-operatori --paesi IT,CH,AT` | `data/osm_aree_servizio.json` |

`--tutti-gli-operatori` starts from the service areas instead of an operator, keeps only chargers inside them, and skips areas already in Free To X, A22 or IONITY (same name within 500 m or same spot). Run it after the other sources. Add `--unisci` to refresh only the listed countries and keep the others in the output file untouched.

### Cross-checking Free To X and A22 with OpenStreetMap

`python tools/Crosscheck_OSM.py` matches every Free To X / A22 area with the OSM service area of the same name (or the nearest within 500 m) and writes `reports/crosscheck_osm.md`: areas far from their OSM position, carriageways that disagree with the direction of the OSM motorway, and charger operators mapped in each area.

### Reviewing the classification

The OSM script marks uncertain sites as `daVerificare` with a reason (e.g. close to the motorway but no service area mapped, name says "Autohof"). Open `stazioni.html`, click **❓ Da verificare**: the map switches to satellite and walks through the doubtful sites; for each choose *In area di servizio*, *Fuori, richiede uscita* or *Non autostradale*, then **Salva** (pick the `data/` folder) or **Scarica**. Right-click a marker → *Sposta stazione* to fix a position. Every change goes to `data/revisioni.json` (the source files are never modified) and the pages apply it on load, so it survives a new download.

`Download_OSM_Colonnine.py` keeps only chargers in a motorway service area (carriageway taken from the direction of the nearest one-way motorway) or within 1.5 km of a motorway (`exitRequired`). It works for other operators and countries too; to use a new output file, add it to `SORGENTI` in `tools/Compila_Aree.py`.

### Unified format

`python tools/Compila_Aree.py` converts every source into one format (highway code and section, carriageway, destination, access type, operators, chargers with connector type and power in kW) and checks it: errors stop the build, warnings are listed with `--avvisi`. Areas that are the same place in different sources (same name within 300 m, or within 60 m, carriageways not opposite) are merged into one record with all operators, the most authoritative source winning on conflicts; then `data/revisioni.json` is applied (corrections are recorded in `correzioni`, excluded areas flagged `esclusa`). Output: `data/aree.json`, read by the app, the editor and the highway overview. The original values of corrected fields are kept in `correzioni`, so the pages can re-apply the current revisions from scratch. The format is documented at the top of the script; tests: `python -m unittest discover tools`.

## External services

- [Leaflet](https://leafletjs.com/) (via cdnjs) for the map
- [Esri basemaps](https://www.esri.com/) for map tiles
- [OpenStreetMap Nominatim](https://nominatim.org/) for reverse geocoding (throttled)
- [Overpass API](https://overpass-api.de/) for OpenStreetMap charger data (© OpenStreetMap contributors, ODbL)

## Anonymous statistics

The pages send a few anonymous counts to [GoatCounter](https://www.goatcounter.com) (`js/statistiche.js`), without cookies and without loading third-party scripts: page visits (`/app`, `/editor`, `/autostrade`), how the app started (`avvio/gps`, `avvio/gps-non-disponibile`, `avvio/simulazione`), and, while driving, the operator and country of each station proposed as next (`prossima/IT/free-to-x`, once per station per visit) or tapped in the distance bar (`tocco/…`). Never coordinates, routes, station names or identifiers. Nothing is sent when the "Statistiche anonime" setting is off, with Do Not Track, on localhost, or (for driving events) in simulation.

## Licenses and attribution

- **Leaflet**: BSD-2-Clause.
- **Esri basemaps**: proprietary, Esri terms of use; every data provider must be credited. The map reads the exact credit line from each Esri service at load time (`js/sfondi.js`).
- **OpenStreetMap data** (Nominatim, Overpass): © OpenStreetMap contributors, ODbL 1.0. The files derived from it in `data/` are distributed under ODbL as well: see `data/README.md`.
