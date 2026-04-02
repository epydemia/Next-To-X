import json
import requests
import time

def forward_geocode_a22_stations(input_file, output_file):
    """
    Forward geocode A22 stations (indirizzo → lat/lon) using OpenStreetmap Nominatim.
    """
    with open(input_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    lista_aree = data.get("listaAree", [])
    total = len(lista_aree)

    headers = {"User-Agent": "A22-ColonnineJS/1.0"}

    for idx, area in enumerate(lista_aree):
        # Build search query from station name and A22
        nome = area.get("nome", "").strip()
        query = f"{nome}, A22 Brennero, Italy"

        try:
            print(f"Geocoding {idx+1}/{total}: {nome}...", end=" ")
            url = f"https://nominatim.openstreetmap.org/search?q={query}&format=json&limit=1"
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()

            results = response.json()
            if results:
                lat = float(results[0]['lat'])
                lon = float(results[0]['lon'])
                area['lat'] = lat
                area['lon'] = lon
                print(f"✓ ({lat:.4f}, {lon:.4f})")
            else:
                print(f"✗ No results found")
                # Fallback: try with just the km position
                km = area.get("km", 0)
                # A22 runs roughly North-South from km 1 to km 309
                # Approximate coordinates along the highway
                approx_lat = 46.5 - (km / 309) * 1.5  # Rough approximation
                approx_lon = 11.5  # A22 is roughly at lon 11.5
                area['lat'] = approx_lat
                area['lon'] = approx_lon
                print(f"  Using approximation: ({approx_lat:.4f}, {approx_lon:.4f})")

            time.sleep(1)  # Rate limit to 1 req/sec per Nominatim policy

        except Exception as e:
            print(f"✗ Error: {e}")
            # Fallback to approximate coordinates
            km = area.get("km", 0)
            approx_lat = 46.5 - (km / 309) * 1.5
            approx_lon = 11.5
            area['lat'] = approx_lat
            area['lon'] = approx_lon

    # Save the geocoded data
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Forward geocoding complete. Saved to: {output_file}")


if __name__ == "__main__":
    input_file = "data/a22_brennero.json.original.json"
    output_file = "data/a22_brennero_geocoded.json"

    forward_geocode_a22_stations(input_file, output_file)
