# PyPSA-Eur OSM to XIIDM Conversion Pipeline

This document captures the full investigation, implementation, pitfalls, and results of converting the PyPSA-Eur OpenStreetMap power grid dataset into a pypowsybl-compatible XIIDM network file for use in Co-Study4Grid.

## Objective

Build a **non-anonymized** XIIDM network of the French 400 kV transmission grid with real geographical coordinates, operational limits, and a load scenario that produces meaningful N-1 overloads for contingency analysis in Co-Study4Grid.

## Data Source

**Zenodo Record 18619025** — PyPSA-Eur OSM network components (raw CSV exports from OpenStreetMap).

Downloaded files (stored in `data/pypsa_eur_osm/`):

| File | Size | Records | Key columns |
|------|------|---------|-------------|
| `buses.csv` | 805 KB | 6 863 | voltage, dc, symbol, under_construction, x (lon), y (lat), country |
| `lines.csv` | 19.8 MB | 9 162 | bus0, bus1, r, x, b, s_nom, i_nom, circuits, v_nom, geometry |
| `transformers.csv` | 122 KB | 878 | bus0, bus1, s_nom |
| `links.csv` | 323 KB | — | (HVDC links, not used) |
| `converters.csv` | 9 KB | — | (AC/DC converters, not used) |

**CSV parsing note**: `lines.csv` and `transformers.csv` require `quotechar="'"` because the `geometry` column contains LINESTRING coordinates with embedded commas.

## Pipeline Overview

The conversion is split into three scripts run sequentially:

1. **`scripts/convert_pypsa_to_xiidm.py`** — Builds the base XIIDM from OSM CSVs
2. **`scripts/add_limits_and_overloads.py`** — Adds operational limits and a geographic load pattern that produces N-1 overloads
3. **`scripts/add_detailed_topology.py`** — Introduces double-busbar topology with coupling breakers at major substations

```
Raw CSVs (Zenodo)
    │
    ▼
convert_pypsa_to_xiidm.py
    │  Filter → FR 380/400kV AC, main connected component
    │  Build → substations, VLs, buses, generators, loads, lines, transformers
    │  Export → network.xiidm (base, no limits)
    │  Write  → grid_layout.json, bus_id_mapping.json
    │
    ▼
add_limits_and_overloads.py
    │  Re-runs conversion (gets fresh network object)
    │  Apply → geographic load/gen dispatch (SE gen → NW load)
    │  Compute → AC loadflow, analyze corridor flows
    │  Set → operational limits (parallel corridor tuning)
    │  Export → network.xiidm (with limits, single-bus topology)
    │
    ▼
add_detailed_topology.py
    │  Re-runs add_limits_and_overloads.py (gets network with limits)
    │  Identify → VLs with ≥4 branches (99 substations)
    │  Create → second busbar + coupling breaker per eligible VL
    │  Dispatch → branches round-robin across the two busbars
    │  Generate → coupling breaker opening actions in actions.json
    │  Export → network.xiidm (final, with limits + detailed topology)
    │
    ▼
Output: data/pypsa_eur_fr400/
    ├── network.xiidm       (~600 KB, 99 coupling breakers)
    ├── grid_layout.json    (25 KB, ~580 entries)
    ├── actions.json        (~160 KB, 897 actions)
    └── bus_id_mapping.json (8.6 KB)
```

### How to run

```bash
cd /home/marotant/dev/AntiGravity/ExpertAssist

# Full pipeline (each script re-runs its predecessor):
venv_expert_assist_py310/bin/python scripts/add_detailed_topology.py

# Or step by step:
venv_expert_assist_py310/bin/python scripts/convert_pypsa_to_xiidm.py
venv_expert_assist_py310/bin/python scripts/add_limits_and_overloads.py
venv_expert_assist_py310/bin/python scripts/add_detailed_topology.py
```

## Conversion Details

### Filtering (Step 2 of convert script)

Starting from 6 863 European buses, we filter to:
- `country == "FR"` (France only)
- `voltage in [380, 400]` (EHV transmission level)
- `dc == "f"` (AC only, no HVDC)
- `under_construction == "f"`

Lines are kept only if both endpoints pass the bus filter. Transformers are similarly filtered.

After filtering: **192 buses, 398 lines, 2 transformers**.

### Connected Component (Step 3)

A NetworkX graph verifies connectivity. The main connected component retains all 192 buses (no islands in this particular subset).

### IIDM Topology Model (Step 4)

Each OSM bus maps to one IIDM entity chain:

```
Substation  →  VoltageLevel  →  Bus (bus-breaker topology)
```

**Critical constraint**: IIDM 2-winding transformers require both voltage levels to be in the **same substation**. The script builds a `bus_to_ss` mapping that merges transformer-connected buses into shared substations. Without this, pypowsybl raises: `"both voltage ids must be on the same substation"`.

Naming conventions:
- Substation: `SS_{safe_id(osm_bus_id)}`
- Voltage level: `VL_{safe_id(osm_bus_id)}`
- Bus: `{safe_id(osm_bus_id)}`
- Generator: `G_{safe_id(osm_bus_id)}`
- Load: `L_{safe_id(osm_bus_id)}`
- Line: `{safe_id(osm_line_id)}` (with `_N` suffix for duplicates)
- Transformer: `T_{safe_id(osm_trafo_id)}`

where `safe_id()` replaces non-alphanumeric characters with underscores.

### Generators and Loads (Step 5)

The base script creates one generator and one load per bus with placeholder values. The `add_limits_and_overloads.py` script then replaces these with a geographic dispatch:
- **Generation** concentrated in **south-east France** (Rhone valley / nuclear corridor): `P = max(5, 40 + SE_score * 25)` MW
- **Load** concentrated in **north-west France** (Paris / Brittany): `P = max(2, 25 + NW_score * 15)` MW
- Total generation ~8 290 MW, total load ~4 440 MW (slack absorbs the difference)
- All 192 generators have `voltage_regulator_on = True` for AC convergence

### Line Impedances (Step 6)

Physical parameters come directly from OSM data:
- `r` = resistance (Ohm), divided by number of circuits, floored at 1e-4
- `x` = reactance (Ohm), divided by number of circuits, floored at 1e-3
- `b` = susceptance (S), multiplied by number of circuits, split equally to b1/b2
- `g1 = g2 = 0`

These are in physical units (Ohm/S), not per-unit — pypowsybl handles the conversion internally.

### Grid Layout (Step 9)

`grid_layout.json` stores `[longitude, latitude]` for each bus. Two key formats are written per bus to ensure compatibility with Co-Study4Grid's backend:
- `"{safe_id}"` — the bare bus identifier
- `"VL_{safe_id}_0"` — the bus-breaker bus ID form used by pypowsybl

This enables geographical NAD rendering via `NadParameters(layout_type=GEOGRAPHICAL)` with `fixed_positions`.

## Operational Limits and Overload Scenario

### Why limits matter

Without operational limits in the XIIDM, Co-Study4Grid cannot detect overloads during N-1 contingency analysis. The OSM dataset provides `i_nom` (thermal current rating in kA) and `s_nom` (apparent power rating in MVA) for each line, but these are not automatically included in the XIIDM export.

### Default OSM rating

For French 400 kV lines: `i_nom = 2.580 kA` (2 580 A), `s_nom` ranges from 1 787 to 3 575 MVA.

### Limit tuning strategy

Setting all limits to the full OSM rating (2 580 A) results in very low loading (~5-30%) because the synthetic load scenario is modest compared to real French consumption (~60 GW vs our ~4.4 GW). Simply increasing loads risks AC loadflow divergence.

Instead, we **calibrate limits based on actual corridor flows**:

1. Run AC loadflow with the geographic dispatch
2. Identify **115 parallel line groups** (lines sharing the same two voltage levels)
3. For each parallel group with significant flow (> 20 A total):
   - Compute `post_trip_current = total_corridor_current / (n_lines - 1)`
   - Set `limit = post_trip_current / 1.08`
   - Guard: `limit >= max_line_current * 1.05` (no N-state overload)
4. Non-corridor lines keep the default 2 580 A rating

This ensures:
- **N-state**: corridor lines loaded at 50-92% (no overload)
- **N-1**: tripping one parallel line pushes remaining lines to ~108% (clear overload)

### Limit creation API

```python
# Each line needs TWO entries (side ONE and side TWO)
limit_entries = []
for lid in lines.index:
    for side in ["ONE", "TWO"]:
        limit_entries.append({
            "element_id": lid,
            "name": f"permanent_limit_{side.lower()}",
            "side": side,
            "type": "CURRENT",
            "value": limit_value_in_amps,
            "acceptable_duration": -1,   # permanent limit
            "fictitious": False,
        })

limits_df = pd.DataFrame(limit_entries).set_index("element_id")
network.create_operational_limits(limits_df)
```

**Important**: `update_operational_limits()` cannot modify the `value` field (raises `"Series 'name' is not modifiable"`). To change limits, you must rebuild the network from scratch and create limits at build time.

### Results

- **796 operational limit entries** (398 lines x 2 sides)
- **253 lines** with custom (reduced) limits on parallel corridors
- **145 lines** with default 2 580 A limits (non-corridor or trivially loaded)

N-1 verification (229 contingencies tested):

| Metric | Value |
|--------|-------|
| Contingencies with >100% overload | **62** |
| Peak overload | **113.4%** (trip `relation_5995927-400`) |
| Max overloaded lines per contingency | **4** (trip `relation_5995939-400`) |
| Stressed (80-100%) contingencies | ~120 |

Example overload scenarios (top 10 by severity):

| Tripped line | Max loading | Overloaded lines |
|---|---|---|
| `relation_5995927-400` | 113.4% | 3 |
| `relation_5995932-400` | 113.4% | 3 |
| `relation_5995921-400` | 111.9% | 3 |
| `relation_5995925-400` | 111.9% | 3 |
| `way_182026371-400` | 110.7% | 3 |
| `way_182026368-400` | 110.0% | 3 |
| `way_182026370-400` | 109.6% | 3 |
| `way_182026375_a-400` | 109.3% | 3 |
| `relation_6359585-400` | 108.3% | 1 |
| `relation_5952075_c-400` | 108.2% | 1 |

The full list of 62 contingencies with detailed per-line overload data is stored in:

**`data/pypsa_eur_fr400/n1_overload_contingencies.json`**

Each entry contains:
- `tripped_line` — the line disconnected as the N-1 contingency
- `tripped_vl1`, `tripped_vl2` — voltage levels at each end of the tripped line
- `max_loading_pct` — peak loading observed anywhere in the network
- `most_loaded_line` — the line with peak loading
- `n_overloaded_lines` — count of lines exceeding 100%
- `overloaded_lines[]` — list with `line_id`, `loading_pct`, `current_a`, `limit_a` for each overloaded line

This file can be used to directly replay interesting contingencies in Co-Study4Grid without re-running the full N-1 scan.

## Co-Study4Grid Integration

### Config file

`config_pypsa_eur_fr400.json`:

```json
{
    "network_path": ".../data/pypsa_eur_fr400/network.xiidm",
    "action_file_path": ".../data/pypsa_eur_fr400/actions.json",
    "layout_path": ".../data/pypsa_eur_fr400/grid_layout.json",
    "output_folder_path": ".../sessions",
    "pypowsybl_fast_mode": true
}
```

### Actions file

`actions.json` contains 798 disconnection actions in the format expected by `expert_op4grid_recommender`:

```json
{
    "disco_LINE_ID": {
        "description": "Disconnect line LINE_ID between VL1 and VL2",
        "description_unitaire": "Disconnect line LINE_ID"
    }
}
```

One `disco_*` action per line (398) and transformer (2), totaling 400 disconnectable elements. Some lines have alternate action entries, bringing the total to 798.

### Verified capabilities

All backend features work with this network:
- Network loading via `POST /api/config`
- Branch listing via `GET /api/branches` (400 disconnectable elements)
- AC loadflow convergence (both N-state and all N-1 states tested)
- NAD geographical diagram generation (429 KB SVG with real coordinates)
- SLD generation for individual voltage levels
- N-1 contingency simulation with overload detection

## Key Pitfalls and Lessons Learned

### 1. MATPOWER import is binary-only

pypowsybl's MATPOWER importer only reads **binary `.mat` files** (MATLAB 5.0 format), not text `.m` files. This forced the pivot from "export to MATPOWER then import" to building the network directly via pypowsybl's `create_*` API.

### 2. DataFrame `id` must be the index

All pypowsybl `create_*` methods expect the element `id` as the DataFrame **index**, not as a regular column. Passing it as a column raises: `"Data of column 'id' has the wrong type, expected string"`.

### 3. Transformer substation constraint

IIDM requires both voltage levels of a 2-winding transformer to be in the **same substation**. The conversion script must merge transformer-connected buses into shared substations before creating voltage levels.

### 4. `substation_id` is not a transformer column

When creating transformers via `create_2_windings_transformers()`, do **not** include `substation_id` in the DataFrame — it's inferred from the voltage level IDs. Including it raises `"No column named substation_id"`.

### 5. AC loadflow needs distributed voltage regulation

A single slack generator cannot maintain voltage across 192 buses. All generators must have `voltage_regulator_on = True` and `distributed_slack = True` for AC convergence.

### 6. Operational limits are immutable after creation

`update_operational_limits()` cannot change the `value` field. To adjust limits, rebuild the entire network and create limits at build time.

### 7. `get_operational_limits()` returns a MultiIndex DataFrame

The returned DataFrame has a 5-level MultiIndex: `(element_id, side, type, acceptable_duration, group_name)`. To look up a limit by element ID, use `idx[0]` on each row's index tuple.

### 8. NAD layout_type is a NadParameters attribute

`layout_type` is a parameter of `NadParameters()`, not of `get_network_area_diagram()`. Pass it as:
```python
nad_params = pp.network.NadParameters(layout_type=pp.network.NadLayoutType.GEOGRAPHICAL)
svg = network.get_network_area_diagram(nad_parameters=nad_params, fixed_positions=pos_df)
```

The returned object is an `Svg` type, not a string — use `str(svg)` to get the SVG content.

### 9. CSV quoting for geometry columns

`lines.csv` contains a `geometry` column with LINESTRING coordinates that include commas. Without `quotechar="'"`, pandas reports `"Expected 31 fields in line 3, saw 179"`.

## Detailed Topology (Double-Busbar)

### Motivation

The base network uses a simple bus-breaker topology with one bus per voltage level. This limits the action space to line disconnections only. Real transmission substations have multiple busbars connected by coupling breakers. Opening a coupling breaker splits a substation into two electrical nodes, redistributing power flows — a key remedial action for grid operators.

### Eligibility criterion

A substation receives a double-busbar layout if it has **≥4 branches** (lines + transformers) connected to it. This threshold ensures that splitting the substation produces a meaningful two-node topology with at least 2 branches on each side.

In the France 400 kV network: **99 out of 192 substations** are eligible, ranging from 4 to 15 branches.

### Implementation (`add_detailed_topology.py`)

For each eligible voltage level:

1. **Second bus creation**: A new configured bus `{safe_id}_B2` is created in the same voltage level alongside the existing `{safe_id}` bus.

2. **Coupling breaker**: A `BREAKER`-type switch `{VL_id}_COUPL` connects the two buses. It is **closed by default**, so in the initial N-state both buses form a single electrical node (no impact on loadflow).

3. **Branch dispatch**: Branches are distributed **round-robin** (alternating) across the two busbars. For a VL with 10 branches, buses get 5 each. Generators and loads are similarly split.

4. **Action generation**: An `open_coupler_{VL_id}` action is added to `actions.json` for each eligible VL, using the standard switch action format:

```json
{
  "open_coupler_VL_way_24020601-400": {
    "description": "Opening coupling breaker in substation 'VL_way_24020601-400' (15 branches → split into 2 nodes)",
    "description_unitaire": "Ouverture du couplage 'VL_way_24020601-400_COUPL' dans le poste 'VL_way_24020601-400'",
    "switches": {
      "VL_way_24020601-400_COUPL": true
    },
    "VoltageLevelId": "VL_way_24020601-400"
  }
}
```

### Verification

After adding the detailed topology:
- **AC loadflow converges** with coupling breakers closed (identical to the single-bus solution)
- **Opening any coupling breaker** creates a second electrical bus and AC loadflow still converges
- The `NetworkTopologyCache` (Union-Find) correctly computes `set_bus` assignments when processing these switch actions
- **897 total actions**: 400 disconnection + 398 alternate disconnections + 99 coupling breaker openings

### Topology statistics

| Metric | Value |
|--------|-------|
| Substations with double busbars | 99 |
| Substations with single bus | 93 |
| Total coupling breakers | 99 |
| Branches on bus 1 (per eligible VL) | ⌈N/2⌉ |
| Branches on bus 2 (per eligible VL) | ⌊N/2⌋ |

## Scaling Notes

This pipeline processes the **France 400 kV** subset (192 buses, 398 lines). To scale:

- **More voltage levels**: Remove the `TARGET_VOLTAGES` filter to include 225 kV, 150 kV, etc.
- **More countries**: Change `TARGET_COUNTRY` or accept multiple countries.
- **Full European grid**: Remove country filter entirely (6 863 buses, 9 162 lines).
- **Load scenario tuning**: Adjust the geographic dispatch coefficients or use real load data from ENTSO-E transparency platform.

The main constraint is AC loadflow convergence — larger networks with more generators and non-trivial dispatch are harder to converge. Consider starting with DC loadflow for initial validation, then tuning for AC.
