"""
fetch_osm_names.py
==================
Batch-fetches real names (RTE codes, human-readable names) for all OSM objects
referenced by the French PyPSA-EUR network from the Overpass API.

Produces:  data/pypsa_eur_fr{voltage}/osm_names.json

Structure:
  {
    "substations": {
      "way/100087916": {"name": "BOUTRE", "ref_rte": "BOUTRE", "ref_rte_nom": "BOUTRE", "power": "substation"},
      "relation/13260100": {"name": "HAVRE (LE) (CENTRALE)", ...},
      ...
    },
    "circuits": {
      "relation/6221844": {"name": "Avelin - Weppes 1", "ref_rte": "AVELIL71WEPPE", "power": "circuit"},
      ...
    }
  }

The script caches results in osm_names.json. Re-running it will skip already-fetched IDs
unless --force is passed.

Usage:
    python scripts/fetch_osm_names.py                          # default: 400 kV
    python scripts/fetch_osm_names.py --voltages 225,400       # 225 + 400 kV
    python scripts/fetch_osm_names.py --voltages 225,400 --output-dir data/pypsa_eur_fr225_400
    python scripts/fetch_osm_names.py --force                  # re-fetch all
"""

import argparse
import os
import re
import sys
import json
import time
import logging
import urllib.request
import urllib.parse
import pandas as pd

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

# ─── Parse command-line arguments ────────────────────────────────────────────
parser = argparse.ArgumentParser(description="Fetch OSM names for PyPSA-EUR network")
parser.add_argument(
    "--voltages",
    type=str,
    default="400",
    help="Target voltage levels (comma-separated, e.g., '225,400'). Default: 400",
)
parser.add_argument(
    "--output-dir",
    type=str,
    default=None,
    help="Output directory (default: data/pypsa_eur_fr{voltage})",
)
parser.add_argument(
    "--force",
    action="store_true",
    help="Re-fetch all names, ignoring cache",
)
parser.add_argument(
    "--cache-from",
    type=str,
    default=None,
    help="Seed cache from another osm_names.json (e.g., data/pypsa_eur_fr400/osm_names.json)",
)

# Support legacy --force without argparse
args, _unknown = parser.parse_known_args()
if "--force" in _unknown:
    args.force = True

# ─── Configuration ────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.join(SCRIPT_DIR, "..", "..")
DATA_DIR = os.path.join(BASE_DIR, "data", "pypsa_eur_osm")

TARGET_VOLTAGES = [float(v.strip()) for v in args.voltages.split(",")]
TARGET_COUNTRY = "FR"

if args.output_dir:
    OUT_DIR = args.output_dir if os.path.isabs(args.output_dir) else os.path.join(BASE_DIR, args.output_dir)
else:
    v_str = "_".join(str(int(v)) for v in TARGET_VOLTAGES)
    OUT_DIR = os.path.join(BASE_DIR, "data", f"pypsa_eur_fr{v_str}")
os.makedirs(OUT_DIR, exist_ok=True)

OUTPUT_FILE = os.path.join(OUT_DIR, "osm_names.json")
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

log.info(f"Target voltages: {TARGET_VOLTAGES} kV")
log.info(f"Output directory: {OUT_DIR}")

# Overpass API rate limiting
BATCH_SIZE = 30  # IDs per query (conservative to avoid timeouts)
DELAY_BETWEEN_REQUESTS = 5  # seconds


USER_AGENT = "Co-Study4Grid/1.0 (fetch_osm_names.py; +https://github.com/)"


def _overpass_query(query: str, retries: int = 4) -> dict:
    """Execute an Overpass API query with retries, using POST to avoid URL length issues."""
    data_bytes = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req_obj = urllib.request.Request(
        OVERPASS_URL,
        data=data_bytes,
        method="POST",
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    for attempt in range(retries):
        try:
            resp = urllib.request.urlopen(req_obj, timeout=60)
            return json.loads(resp.read())
        except Exception as e:
            if attempt < retries - 1:
                wait = DELAY_BETWEEN_REQUESTS * (2 ** attempt)
                log.warning(f"  Overpass error: {e} — retrying in {wait}s …")
                time.sleep(wait)
            else:
                log.error(f"  Overpass failed after {retries} attempts: {e}")
                return {"elements": []}
    return {"elements": []}


def _extract_tags(element: dict) -> dict:
    """Extract relevant tags from an OSM element."""
    tags = element.get("tags", {})
    result = {}

    # Name hierarchy: ref:FR:RTE_nom > ref:FR:RTE > name > (empty)
    ref_rte_nom = tags.get("ref:FR:RTE_nom", "")
    ref_rte = tags.get("ref:FR:RTE", "")
    name = tags.get("name", "")

    if ref_rte_nom:
        result["ref_rte_nom"] = ref_rte_nom
    if ref_rte:
        result["ref_rte"] = ref_rte
    if name:
        result["name"] = name

    # Best human-readable name
    result["display_name"] = ref_rte_nom or ref_rte or name or ""

    # Power type
    power = tags.get("power", "")
    if power:
        result["power"] = power

    # Voltage
    voltage = tags.get("voltage", "")
    if voltage:
        result["voltage"] = voltage

    # Operator
    operator = tags.get("operator:short", "") or tags.get("operator", "")
    if operator:
        result["operator"] = operator

    # Circuits (for lines)
    circuits = tags.get("circuits", "")
    if circuits:
        result["circuits"] = circuits

    return result


def _batch_fetch(osm_type: str, osm_ids: list, existing: dict) -> dict:
    """Fetch tags for a list of OSM IDs of the same type, in batches."""
    # Filter out already-fetched IDs
    to_fetch = [oid for oid in osm_ids if f"{osm_type}/{oid}" not in existing]

    if not to_fetch:
        log.info(f"  All {len(osm_ids)} {osm_type}s already cached")
        return {}

    log.info(f"  Fetching {len(to_fetch)} {osm_type}s ({len(osm_ids) - len(to_fetch)} already cached)")

    results = {}
    n_batches = (len(to_fetch) + BATCH_SIZE - 1) // BATCH_SIZE
    for i in range(0, len(to_fetch), BATCH_SIZE):
        batch = to_fetch[i:i + BATCH_SIZE]
        id_list = ",".join(batch)

        if osm_type == "relation":
            query = f"[out:json];relation(id:{id_list});out tags;"
        else:
            query = f"[out:json];way(id:{id_list});out tags;"

        batch_num = i // BATCH_SIZE + 1
        log.info(f"    Batch {batch_num}/{n_batches}: {len(batch)} {osm_type}s …")
        data = _overpass_query(query)

        for el in data.get("elements", []):
            key = f"{el['type']}/{el['id']}"
            results[key] = _extract_tags(el)

        # Rate limiting between batches
        if i + BATCH_SIZE < len(to_fetch):
            time.sleep(DELAY_BETWEEN_REQUESTS)

    return results


def _parse_bus_osm_id(bus_index: str) -> tuple:
    """
    Extract the base OSM type and numeric ID from a bus index string.

    Examples:
        'relation/13260100-400'           -> ('relation', '13260100')
        'virtual_relation/19874522:0-400' -> ('relation', '19874522')
        'way/100087916-400'               -> ('way', '100087916')
        'virtual_way/1346026649:1-400'    -> ('way', '1346026649')
    """
    base = re.sub(r"-\d+$", "", bus_index)       # strip voltage suffix
    base = re.sub(r"^virtual_", "", base)         # strip virtual_ prefix
    base = re.sub(r":[a-z0-9:]+$", "", base)      # strip :0, :a:1, etc.
    m = re.match(r"(relation|way)/(\d+)", base)
    if m:
        return m.group(1), m.group(2)
    return None, None


def _parse_line_osm_id(line_index: str) -> tuple:
    """
    Extract the base OSM type and numeric ID from a line index string.

    Examples:
        'merged_relation/6221844:a-400+1'  -> ('relation', '6221844')
        'merged_way/100497456-400+1'       -> ('way', '100497456')
    """
    base = re.sub(r"^merged_", "", line_index)
    base = re.sub(r"[+]\d+$", "", base)           # strip circuit suffix
    base = re.sub(r"-\d+$", "", base)              # strip voltage suffix
    base = re.sub(r":[a-z0-9:]+$", "", base)       # strip segment suffix
    m = re.match(r"(relation|way)/(\d+)", base)
    if m:
        return m.group(1), m.group(2)
    return None, None


def main():
    force = args.force

    # Load existing cache
    existing = {}

    # Seed from another osm_names.json (e.g., reuse fr400 cache for fr225_400)
    if args.cache_from and os.path.exists(args.cache_from):
        with open(args.cache_from, encoding="utf-8") as f:
            seed = json.load(f)
        for section in ["substations", "circuits"]:
            for key, val in seed.get(section, {}).items():
                existing[key] = val
        log.info(f"Seeded {len(existing)} entries from {args.cache_from}")

    if os.path.exists(OUTPUT_FILE) and not force:
        with open(OUTPUT_FILE, encoding="utf-8") as f:
            cache = json.load(f)
        # Flatten for lookup (overwrites seed entries if present)
        for section in ["substations", "circuits"]:
            for key, val in cache.get(section, {}).items():
                existing[key] = val
        log.info(f"Loaded {len(existing)} cached entries from {OUTPUT_FILE}")

    # ── Load and filter buses ──
    log.info("Loading OSM CSVs …")
    buses = pd.read_csv(os.path.join(DATA_DIR, "buses.csv"), index_col=0)
    fr400 = buses[
        (buses["country"] == TARGET_COUNTRY)
        & (buses["voltage"].isin(TARGET_VOLTAGES))
        & (buses["dc"] == "f")
        & (buses["under_construction"] == "f")
    ]

    lines = pd.read_csv(os.path.join(DATA_DIR, "lines.csv"), index_col=0, quotechar="'")
    fr_lines = lines[
        lines["bus0"].isin(fr400.index) & lines["bus1"].isin(fr400.index)
        & (lines["under_construction"] == "f")
    ]

    log.info(f"  {len(fr400)} FR buses, {len(fr_lines)} FR lines")

    # ── Collect OSM IDs to query ──

    # 1) Substation IDs: from bus index (the bus itself references a substation)
    bus_relations = set()
    bus_ways = set()
    bus_id_to_osm = {}  # bus_index -> "type/id"

    for idx in fr400.index:
        osm_type, osm_id = _parse_bus_osm_id(idx)
        if osm_type and osm_id:
            bus_id_to_osm[idx] = f"{osm_type}/{osm_id}"
            if osm_type == "relation":
                bus_relations.add(osm_id)
            else:
                bus_ways.add(osm_id)

    log.info(f"  Bus OSM IDs: {len(bus_relations)} relations + {len(bus_ways)} ways = {len(bus_relations) + len(bus_ways)}")

    # 2) Circuit/line IDs: from line index
    line_relations = set()
    line_ways = set()
    line_id_to_osm = {}  # line_index -> "type/id"

    for idx in fr_lines.index:
        osm_type, osm_id = _parse_line_osm_id(idx)
        if osm_type and osm_id:
            line_id_to_osm[idx] = f"{osm_type}/{osm_id}"
            if osm_type == "relation":
                line_relations.add(osm_id)
            else:
                line_ways.add(osm_id)

    log.info(f"  Line OSM IDs: {len(line_relations)} relations + {len(line_ways)} ways = {len(line_relations) + len(line_ways)}")

    # ── Fetch from Overpass ──
    all_results = dict(existing)

    def _save_intermediate():
        """Save intermediate results so progress isn't lost on failure."""
        with open(OUTPUT_FILE + ".partial", "w", encoding="utf-8") as fp:
            json.dump({"raw_results": all_results}, fp, indent=2, ensure_ascii=False)

    # Substations (from bus IDs)
    log.info("Fetching substation names …")
    if bus_relations:
        all_results.update(_batch_fetch("relation", sorted(bus_relations), all_results))
        _save_intermediate()
    if bus_ways:
        all_results.update(_batch_fetch("way", sorted(bus_ways), all_results))
        _save_intermediate()

    # Circuits (from line IDs)
    log.info("Fetching circuit/line names …")
    if line_relations:
        all_results.update(_batch_fetch("relation", sorted(line_relations), all_results))
        _save_intermediate()
    if line_ways:
        all_results.update(_batch_fetch("way", sorted(line_ways), all_results))
        _save_intermediate()

    # ── Organize into sections ──
    substations = {}
    circuits = {}

    for key, val in all_results.items():
        power = val.get("power", "")
        if power == "substation":
            substations[key] = val
        elif power in ("circuit", "line", "cable", "minor_line"):
            circuits[key] = val
        else:
            # Default: bus-referenced IDs are substations, line-referenced are circuits
            osm_id = key.split("/")[-1] if "/" in key else key
            if osm_id in bus_relations or osm_id in bus_ways:
                substations[key] = val
            elif osm_id in line_relations or osm_id in line_ways:
                circuits[key] = val
            else:
                substations[key] = val  # fallback

    # ── Save bus_id → OSM key mapping for the conversion script ──
    bus_mapping = {}
    for bus_idx, osm_key in bus_id_to_osm.items():
        entry = substations.get(osm_key) or all_results.get(osm_key) or {}
        bus_mapping[bus_idx] = {
            "osm_key": osm_key,
            "display_name": entry.get("display_name", ""),
        }

    line_mapping = {}
    for line_idx, osm_key in line_id_to_osm.items():
        entry = circuits.get(osm_key) or all_results.get(osm_key) or {}
        line_mapping[line_idx] = {
            "osm_key": osm_key,
            "display_name": entry.get("display_name", ""),
            "ref_rte": entry.get("ref_rte", ""),
            "name": entry.get("name", ""),
        }

    output = {
        "substations": substations,
        "circuits": circuits,
        "bus_to_name": bus_mapping,
        "line_to_name": line_mapping,
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    log.info(f"\nWritten: {OUTPUT_FILE}")
    log.info(f"  {len(substations)} substations, {len(circuits)} circuits")
    log.info(f"  {len(bus_mapping)} bus→name mappings, {len(line_mapping)} line→name mappings")

    # Print sample
    log.info("\nSample substation names:")
    for key, val in sorted(substations.items())[:10]:
        log.info(f"  {key}: {val.get('display_name', '?')}")

    log.info("\nSample circuit names:")
    for key, val in sorted(circuits.items())[:10]:
        log.info(f"  {key}: {val.get('display_name', '?')}")


if __name__ == "__main__":
    main()
