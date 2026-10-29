# ⚡ Next-To-X

**Next-To-X** is a lightweight web app for driving on Italian highways: it follows your GPS position and heading and shows the next EV charging station ahead of you, on your side of the highway.

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

## External services

- [Leaflet](https://leafletjs.com/) (via cdnjs) for the map
- [Esri basemaps](https://www.esri.com/) for map tiles
- [OpenStreetMap Nominatim](https://nominatim.org/) for reverse geocoding (throttled)
