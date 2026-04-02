import json
from datetime import datetime

def scrape_a22_charging_stations():
    """
    Extracts A22 Brennero charging stations from their official website data.
    Returns a JSON structure matching the Free to X format for compatible data loading.

    The station data is extracted from the official A22 page:
    https://www.autobrennero.it/it/in-viaggio/sosta-e-servizi/colonnine-elettriche-per-auto/
    """

    # Station data extracted from the A22 Brennero official website
    stations = [
        {
            "km": 1.3,
            "nome": "Plessi Museum al Passo del Brennero",
            "direzione": "NORD",
            "chargers": [
                {"count": 24, "type": "Tesla Supercharger", "power": "Variable"},
                {"count": 2, "type": "Ultra-rapid", "power": "150 kW"},
                {"count": 1, "type": "AC", "power": "22 kW"}
            ]
        },
        {
            "km": 38.031,
            "nome": "Bressanone / Val Pusteria",
            "direzione": "NORD",
            "chargers": [
                {"count": 2, "type": "Multi-standard rapid", "power": "50 kW"}
            ]
        },
        {
            "km": 63.6,
            "nome": "Isarco est",
            "direzione": "NORD",
            "chargers": [
                {"count": 2, "type": "Ultra-rapid", "power": "150 kW"}
            ]
        },
        {
            "km": 128.913,
            "nome": "Paganella est",
            "direzione": "NORD",
            "chargers": [
                {"count": 2, "type": "Ultra-rapid", "power": "150 kW"},
                {"count": 1, "type": "Multi-standard rapid", "power": "50 kW"}
            ]
        },
        {
            "km": 129.004,
            "nome": "Paganella ovest",
            "direzione": "SUD",
            "chargers": [
                {"count": 2, "type": "Ultra-rapid", "power": "150 kW"},
                {"count": 1, "type": "Multi-standard rapid", "power": "50 kW"}
            ]
        },
        {
            "km": 159.69,
            "nome": "Nogaredo est",
            "direzione": "NORD",
            "chargers": [
                {"count": 2, "type": "Multi-standard rapid", "power": "50 kW"}
            ]
        },
        {
            "km": 159.69,
            "nome": "Nogaredo ovest",
            "direzione": "SUD",
            "chargers": [
                {"count": 2, "type": "Multi-standard rapid", "power": "50 kW"}
            ]
        },
        {
            "km": 166.739,
            "nome": "Rovereto Sud",
            "direzione": "SUD",
            "chargers": [
                {"count": 3, "type": "Multi-standard rapid", "power": "50 kW"}
            ]
        },
        {
            "km": 206.669,
            "nome": "Affi",
            "direzione": "SUD",
            "chargers": [
                {"count": 24, "type": "Tesla Supercharger", "power": "Variable"},
                {"count": 2, "type": "Multi-standard rapid", "power": "50 kW"}
            ]
        },
        {
            "km": 208.0,
            "nome": "Garda est",
            "direzione": "NORD",
            "chargers": [
                {"count": 2, "type": "Ultra-rapid", "power": "150 kW"}
            ]
        },
        {
            "km": 208.0,
            "nome": "Garda ovest",
            "direzione": "SUD",
            "chargers": [
                {"count": 2, "type": "Ultra-rapid", "power": "150 kW"}
            ]
        },
        {
            "km": 240.8,
            "nome": "Povegliano est",
            "direzione": "NORD",
            "chargers": [
                {"count": 2, "type": "Ultra-rapid", "power": "150 kW"}
            ]
        },
        {
            "km": 256.181,
            "nome": "Mantova Nord",
            "direzione": "SUD",
            "chargers": [
                {"count": 2, "type": "Multi-standard rapid", "power": "50 kW"},
                {"count": 1, "type": "AC", "power": "22 kW"}
            ]
        },
        {
            "km": 268.603,
            "nome": "Po ovest",
            "direzione": "SUD",
            "chargers": [
                {"count": 2, "type": "Multi-standard rapid", "power": "50 kW"},
                {"count": 1, "type": "AC", "power": "22 kW"}
            ]
        },
        {
            "km": 309.0,
            "nome": "Campogalliano est",
            "direzione": "NORD",
            "chargers": [
                {"count": 2, "type": "Ultra-rapid", "power": "150 kW"}
            ]
        },
        {
            "km": 309.0,
            "nome": "Campogalliano ovest",
            "direzione": "SUD",
            "chargers": [
                {"count": 2, "type": "Ultra-rapid", "power": "150 kW"}
            ]
        }
    ]

    # Convert to Free to X compatible format
    lista_aree = []
    for idx, station in enumerate(stations, 1):
        area_code = f"A22_{idx:03d}"

        # Build colonnine array
        colonnine = []
        for charger_idx, charger in enumerate(station["chargers"], 1):
            colonna = {
                "codice": f"A22_{area_code}_{charger_idx}",
                "modello": f"{charger['type']} {charger['power']}",
                "codiceModello": get_charger_code(charger["type"]),
                "connettori": get_connectors(charger["type"])
            }
            colonnine.append(colonna)

        area = {
            "codice": area_code,
            "c_ads": area_code,
            "nome": station["nome"],
            "strada": "A22 BRENNERO",
            "direzione": station["direzione"],
            "km": station["km"],
            "lat": None,  # Will be filled by reverse geocoding
            "lon": None,  # Will be filled by reverse geocoding
            "radius": 5,
            "isAds": True,
            "colonnine": colonnine
        }
        lista_aree.append(area)

    # Create output structure
    output_data = {
        "listaAree": lista_aree,
        "data_download": datetime.utcnow().isoformat(),
        "source": "A22 Brennero official website (https://www.autobrennero.it/)"
    }

    return output_data


def get_charger_code(charger_type):
    """Map charger type to numeric code (matching Free to X convention)."""
    type_lower = charger_type.lower()
    if "tesla" in type_lower:
        return 20  # Tesla Supercharger
    elif "ultra" in type_lower:
        return 1   # HPC 300 kW (ultra-rapid)
    elif "50" in type_lower or "multi" in type_lower:
        return 11  # CCS Rapid 50 kW
    elif "22" in type_lower or "ac" in type_lower:
        return 12  # AC 22 kW
    else:
        return 0


def get_connectors(charger_type):
    """Return connector types based on charger type."""
    type_lower = charger_type.lower()

    if "tesla" in type_lower:
        return [{"codice": "Tesla", "modello": "Tesla Supercharger"}]

    connectors = []
    if "ultra" in type_lower or "150" in type_lower:
        # Ultra-rapid uses CCS
        connectors.append({"codice": "CCS", "modello": "CCS Ricarica DC"})
    elif "50" in type_lower or "multi" in type_lower:
        # Multi-standard 50kW typically has CCS and Type2
        connectors.append({"codice": "CCS", "modello": "CCS Ricarica DC"})
        connectors.append({"codice": "Type2AC", "modello": "Type 2 AC"})
    elif "22" in type_lower or "ac" in type_lower:
        # AC 22 kW uses Type 2
        connectors.append({"codice": "Type2AC", "modello": "Type 2 AC"})

    return connectors if connectors else [{"codice": "Unknown", "modello": "Unknown"}]


def save_to_json(data, output_path="a22_brennero.json"):
    """Save the scraped data to JSON file."""
    try:
        original_output_path = output_path + ".original.json"
        with open(original_output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"File JSON salvato con successo in: {original_output_path}")
        print(f"Stazioni caricate: {len(data['listaAree'])}")
    except Exception as e:
        print(f"Errore durante il salvataggio: {e}")


if __name__ == "__main__":
    print("🔄 Inizio dell'estrazione dati A22 Brennero...")
    data = scrape_a22_charging_stations()

    if data:
        # Save to data directory (go up from tools/)
        import os
        data_dir = os.path.join(os.path.dirname(__file__), '..', 'data')
        os.makedirs(data_dir, exist_ok=True)
        output_file = os.path.join(data_dir, "a22_brennero.json")
        save_to_json(data, output_file)
        print("\n✅ Estrazione completata!")
    else:
        print("\n❌ Estrazione fallita.")
