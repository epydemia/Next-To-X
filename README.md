<p align="center"><img src="img/logo.png" alt="Next-To-X" width="240"></p>

# Next-To-X

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

## Publishing

Every push to `main` is published by `.github/workflows/static.yml`. Before uploading, `tools/versiona_asset.py` adds `?v=<commit>` to the CSS and scripts of the pages and to every relative module import, so browsers fetch the new files at once instead of waiting for the GitHub Pages cache (10 minutes). Data files are fetched with `cache: 'no-cache'`, so they are revalidated on every load. GitHub Pages must use **GitHub Actions** as its source (Settings → Pages).

## Running locally

ES modules need an HTTP server:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Geolocation requires `localhost` or HTTPS.

## Simulated position

Open the page with `?debug=true` (e.g. `index.html?debug=true`), then ⚙ → **Simula posizione**: without the parameter the setting is hidden and the app always uses the real GPS. The app replays a default route on the A14, or a CSV track you upload (TeslaFi export format: `Latitude`, `Longitude`, optional `Timestamp (CEST)`), 10× faster than real time.

## Which chargers are in the app

The app is for long motorway trips: it should propose a charger you can actually reach and use without a long detour. So it does not list every charger near a motorway, only those that are either **in a service area on your carriageway** or **fast and just past an exit**. Every station has an access type, shown in the app:

| Access | Meaning | In the app |
| --- | --- | --- |
| `area_servizio` | Inside a motorway service area, reachable without leaving the motorway | Proposed only for the carriageway it is on |
| `uscita` (⚠️) | Just past an exit (fuel station, Autohof, Supercharger): you leave the motorway and come back | Proposed in both directions; hidden by the **Solo aree di servizio** setting |
| `fuori_autostrada` | Not on a motorway (e.g. Free To X sites at airports) | Never proposed while driving on a motorway; on the map as a grey marker |

The app proposes a station when it is on the motorway being driven (same code, e.g. A9, and same country), on your carriageway unless it is an exit station, ahead of you and within the search radius.

### Sources

| Source | What it contains | Why |
| --- | --- | --- |
| Free To X (Autostrade per l'Italia) | Every Free To X service area in Italy, with the official carriageway | Official list, the most reliable for the Italian network |
| A22 Brennero (Autostrada del Brennero) | Chargers along the A22 | Official list of the A22 concessionaire |
| IONITY from OpenStreetMap (IT, DE, CH, AT) | IONITY in service areas, and IONITY within 1.5 km of a motorway as exit stations | IONITY sites are almost all on motorways; OSM maps them well |
| All other operators from OpenStreetMap (IT, DE, CH, AT) | Chargers of any operator in service areas, and fast chargers just past an exit (rules below) | Covers operators without an official list (EnBW, Tesla, Aral pulse, E.ON Drive, Allego, GOFAST, SMATRICS…) |

When the same place is in more than one source (same OSM object; same name within 300 m; or within 60 m, carriageways not opposite), it becomes **one station with all its operators**, the most authoritative source winning on conflicts (Free To X > A22 > OSM > IONITY).

### Rules for OpenStreetMap chargers

`tools/Download_OSM_Colonnine.py --tutti-gli-operatori` applies these rules; every threshold is a constant at the top of the script.

**In a service area** (`highway=services`): a charger within 150 m of a service area that is within 400 m of a motorway is in that area, **whatever its power** (in a service area even a slow charger needs no detour). The carriageway is the direction of travel of the nearest one-way motorway. Autohöfe tagged as service areas (name "Autohof", "Truck Stop") are exit stations instead: you have to leave the motorway to reach them.

**Just past an exit**: a charger outside any service area is kept only if **all** of these hold:

| Rule | Why |
| --- | --- |
| Fast: a CCS, CHAdeMO or Supercharger socket, at least 50 kW, or a name such as Supercharger, Fastned, Aral pulse, HPC | Leaving the motorway is only worth it for a fast charge; slow AC chargers near a motorway are almost always town chargers |
| Within 1 km of a motorway | Further away it is a detour |
| Within 800 m of a motorway junction (`highway=motorway_junction`) | Being close to the motorway is not enough: in towns the motorway passes close to many chargers that are kilometres from an exit |
| Not a supermarket or shopping centre (Lidl, Aldi/Hofer, IKEA, Kaufland, Rewe, Edeka, Migros, Coop, Spar, Billa, DIY stores…) | They usually follow the shop's opening hours |

**Tesla Superchargers are the exception** to the last two rules: they are open around the clock, often sit in a supermarket car park, and are kept up to 1.5 km from a junction. Chargers within 300 m of each other are one site (e.g. Tesla, EnBW and EWE Go at the A9 Langenbruck exit), so the app shows one station with all operators.

**Not included**, on purpose:
- chargers further than 1 km from a motorway, or 800 m from a junction (1.5 km for Tesla);
- slow (AC) chargers outside service areas;
- supermarket and shopping-centre chargers (except Tesla);
- Free To X and IONITY chargers in the all-operators download, because they have their own source and are merged in when the areas are compiled;
- countries other than Italy, Germany, Switzerland and Austria.

**Not included because of the map data**: a charger missing from OpenStreetMap, or tagged without its sockets or power (it cannot be recognised as fast), is not in the app until it is mapped. Fixing it on [openstreetmap.org](https://www.openstreetmap.org) and downloading again is the cleanest way to add it.

### Doubtful sites

Sites whose classification may be wrong are marked `daVerificare` with a reason and can be reviewed in the editor (see [Reviewing the classification](#reviewing-the-classification)):
- a "service area" charger with no carriageway, or more than 200 m from the motorway when the name does not say service area;
- an exit station within 100 m of the motorway (probably an unmapped service area), whose name says service area, or within 300 m of an official service area.

### Current data

As of this release (`data/aree.json`):

| Country | In a service area | Exit | Off the motorway |
| --- | --- | --- | --- |
| Italy | 161 | 155 | 5 |
| Germany | 389 | 1004 | 0 |
| Switzerland | 31 | 186 | 0 |
| Austria | 39 | 198 | 0 |

## How the data is organised

The pages read a single file, `data/aree.json`, built by `python3 tools/Compila_Aree.py` from the files of each source (`free_to_x_reverse.json`, `a22_brennero_geocoded.json`, `ionity_osm.json`, `osm_aree_servizio.json`). **Run it after updating any source.** Manual corrections live in `data/revisioni.json` and are applied by the pages on load, so saving them from the editor takes effect without recompiling.

To add a source: write a converter in `tools/Compila_Aree.py` (add it to `SORGENTI`, its name to `FONTI` and `PRIORITA_FONTI`), and a label in `FONTI` in `js/config.js`.

## Updating the data

| Source | Command | Output |
| --- | --- | --- |
| Free To X (Italy) | `python3 tools/Download_Free_To_X.py && python3 tools/ReverseGeocoding.py` | `data/free_to_x_reverse.json` |
| IONITY (Italy, Germany, Switzerland, Austria) from OpenStreetMap | `python3 tools/Download_OSM_Colonnine.py --operatore IONITY --paesi IT,DE,CH,AT` | `data/ionity_osm.json` |
| Every other operator in motorway service areas and fast chargers by the exits (e.g. ASTM network in Italy, EnBW/Tesla/Aral pulse in Germany) | `python3 tools/Download_OSM_Colonnine.py --tutti-gli-operatori --paesi IT,DE,CH,AT` | `data/osm_aree_servizio.json` |

Which chargers each command keeps, and why, is explained in [Which chargers are in the app](#which-chargers-are-in-the-app). Add `--unisci` to refresh only the listed countries and keep the others in the output file untouched. If Overpass fails for a country, its areas from the previous download are kept, the script exits with an error, and running it again resumes from the step that failed (every step is cached in `tools/cache/`; `--aggiorna` downloads everything again). Chain the next commands with `&&` so they do not run after a failure. Generate `data/autostrade.json` (`python3 tools/Download_OSM_Autostrade.py`) before the all-operators download: it is used to measure the distance of exit chargers from the motorway.

### Cross-checking Free To X and A22 with OpenStreetMap

`python3 tools/Crosscheck_OSM.py` matches every Free To X / A22 area with the OSM service area of the same name (or the nearest within 500 m) and writes `reports/crosscheck_osm.md`: areas far from their OSM position, carriageways that disagree with the direction of the OSM motorway, and charger operators mapped in each area.

### Reviewing the classification

The OSM script marks uncertain sites as `daVerificare` with a reason (e.g. close to the motorway but no service area mapped, name says "Autohof"). Open `stazioni.html`, click **❓ Da verificare**: the map switches to satellite and walks through the doubtful sites; for each choose *In area di servizio*, *Fuori, richiede uscita* or *Non autostradale*, then **Salva** (pick the `data/` folder) or **Scarica**. Right-click a marker → *Sposta stazione* to fix a position. Every change goes to `data/revisioni.json` (the source files are never modified) and the pages apply it on load, so it survives a new download.

### Unified format

`python3 tools/Compila_Aree.py` converts every source into one format (highway code and section, carriageway, destination, access type, operators, chargers with connector type and power in kW) and checks it: errors stop the build, warnings are listed with `--avvisi`. Areas that are the same place in different sources (same name within 300 m, or within 60 m, carriageways not opposite) are merged into one record with all operators, the most authoritative source winning on conflicts; then `data/revisioni.json` is applied (corrections are recorded in `correzioni`, excluded areas flagged `esclusa`). Output: `data/aree.json`, read by the app, the editor and the highway overview. The original values of corrected fields are kept in `correzioni`, so the pages can re-apply the current revisions from scratch. The format is documented at the top of the script; tests: `python3 -m unittest discover tools`.

## External services

- [Leaflet](https://leafletjs.com/) (via cdnjs) for the map
- [Esri basemaps](https://www.esri.com/) for map tiles
- [OpenStreetMap Nominatim](https://nominatim.org/) for reverse geocoding (throttled)
- [Overpass API](https://overpass-api.de/) for OpenStreetMap charger data (© OpenStreetMap contributors, ODbL)

## Notices, independence and privacy

On first launch the app shows a short notice (`js/app/avvertenze.js`) before asking for the location permission: do not handle the phone while driving, the data is indicative, the location is not stored, and the app is independent (not affiliated with Free To X, Autostrade per l'Italia, Autostrada del Brennero or any charging operator). It comes back only if `VERSIONE` in that file changes.

`info.html` (linked from the notice and from the settings) is the full Italian page: notices and no warranty, independence and trademarks, privacy, data sources and licenses. Privacy in short: the GPS position is used in the browser and never received or stored by the project; on motorways the road comes from the local network; **off motorways the coordinates are sent to Nominatim** (OpenStreetMap Foundation) to get the road name, at most every 10 s while moving; map tiles come from Esri; hosting is GitHub Pages. Keep that page in sync when any of this changes.

## Anonymous statistics

The pages send a few anonymous counts to [GoatCounter](https://www.goatcounter.com) (`js/statistiche.js`), without cookies and without loading third-party scripts: page visits (`/app`, `/editor`, `/autostrade`), how the app started (`avvio/gps`, `avvio/gps-non-disponibile`, `avvio/simulazione`), and, while driving, the operator and country of each station proposed as next (`prossima/IT/free-to-x`, once per station per visit) or tapped in the distance bar (`tocco/…`). Never coordinates, routes, station names or identifiers. Nothing is sent when the "Statistiche anonime" setting is off, with Do Not Track, on localhost, or (for driving events) in simulation.

## Licenses and attribution

- **App code**: MIT, see [`LICENSE`](LICENSE). The data in `data/` keeps the licenses of its sources (below and `data/README.md`).
- **Leaflet**: BSD-2-Clause.
- **Inter font**: SIL Open Font License 1.1, served from `css/font/` (not from Google Fonts, so no visitor IP reaches a third party just to draw text).
- **Esri basemaps**: proprietary, Esri terms of use; every data provider must be credited. The map reads the exact credit line from each Esri service at load time (`js/sfondi.js`).
- **OpenStreetMap data** (Nominatim, Overpass): © OpenStreetMap contributors, ODbL 1.0. The files derived from it in `data/` are distributed under ODbL as well: see `data/README.md`.
