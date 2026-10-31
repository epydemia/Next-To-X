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
├── config.js               Data sources, map tiles, tunable constants
├── core/                   Pure logic, no DOM
│   ├── geo.js              Distance, bearing, heading helpers
│   ├── autostrade.js       Highway table (names, axis) and code lookup
│   ├── dati.js             Loads the JSON data sources
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
data/                       Station datasets (JSON)
tools/                      Python scripts that download and geocode the datasets
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

## Adding a data source

Add an entry to `SORGENTI_DATI` in `js/config.js` pointing at a JSON file in `data/` with the shape `{ "listaAree": [...] }`. Each area needs at least `codice`, `nome`, `strada`, `lat`, `lon`; `direzione_geografica` and `exitRequired` improve filtering.

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

The OSM script marks uncertain sites as `daVerificare` with a reason (e.g. close to the motorway but no service area mapped, name says "Autohof"). Open `stazioni.html`, click **❓ Da verificare**: the map switches to satellite and walks through the doubtful sites; for each choose *In area di servizio*, *Fuori, richiede uscita* or *Non autostradale*, then **Salva** (pick the `data/` folder) or **Scarica**. Decisions go to `data/revisioni.json`, keyed by area code, and the app applies them on load, so they survive a new download.

`Download_OSM_Colonnine.py` keeps only chargers in a motorway service area (carriageway taken from the direction of the nearest one-way motorway) or within 1.5 km of a motorway (`exitRequired`). It works for other operators and countries too; add the output file to `SORGENTI_DATI`.

### Unified format (work in progress)

`python tools/Compila_Aree.py` converts every source into one format (highway code and section, carriageway, destination, access type, operators, chargers with connector type and power in kW) and checks it: errors stop the build, warnings are listed with `--avvisi`. Areas that are the same place in different sources (same name within 300 m, or within 60 m, carriageways not opposite) are merged into one record with all operators, the most authoritative source winning on conflicts; then `data/revisioni.json` is applied (corrections are recorded in `correzioni`, excluded areas flagged `esclusa`). Output: `data/aree.json`, **not used by the app yet** (next step: switch the app and the editor to this file). Run it again after updating any source or saving revisions. The format is documented at the top of the script; tests: `python -m unittest discover tools`.

## External services

- [Leaflet](https://leafletjs.com/) (via cdnjs) for the map
- [Esri basemaps](https://www.esri.com/) for map tiles
- [OpenStreetMap Nominatim](https://nominatim.org/) for reverse geocoding (throttled)
- [Overpass API](https://overpass-api.de/) for OpenStreetMap charger data (© OpenStreetMap contributors, ODbL)
