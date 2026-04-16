# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import pypowsybl.network as pn
import os

class NetworkService:
    def __init__(self):
        self.network = None

    def load_network(self, network_path: str):
        if not os.path.exists(network_path):
            raise FileNotFoundError(f"Network file/directory not found: {network_path}")
        
        # Determine if it's a file or directory and load accordingly
        # Assuming bare_env is a directory of xiidm files or a single xiidm file
        # pypowsybl can load from file. 
        # If it's a directory, we might need to pick the xiidm file inside.
        if os.path.isdir(network_path):
            files = [f for f in os.listdir(network_path) if f.endswith('.xiidm') or f.endswith('.xml')]
            if not files:
                 raise FileNotFoundError(f"No .xiidm or .xml file found in {network_path}")
            file_path = os.path.join(network_path, files[0])
        else:
            file_path = network_path

        self.network = pn.load(file_path)
        return {"message": "Network loaded successfully", "id": self.network.id}

    def get_disconnectable_elements(self):
        if not self.network:
            raise ValueError("Network not loaded")

        # get lines and two winding transformers
        lines = self.network.get_lines()
        transformers = self.network.get_2_windings_transformers()

        elements = []
        if lines is not None and not lines.empty:
            elements.extend(lines.index.tolist())
        if transformers is not None and not transformers.empty:
            elements.extend(transformers.index.tolist())

        return sorted(elements)

    def get_element_names(self):
        """Return {element_id: display_name} for all lines and transformers.

        The display name is the pypowsybl ``name`` field when it is set and
        differs from the element ID; otherwise the ID itself.
        """
        if not self.network:
            raise ValueError("Network not loaded")

        name_map: dict[str, str] = {}

        lines = self.network.get_lines()
        if lines is not None and not lines.empty and 'name' in lines.columns:
            for eid, row in lines.iterrows():
                n = row.get('name')
                if n and str(n) != str(eid) and str(n) != 'nan':
                    name_map[eid] = str(n)

        transformers = self.network.get_2_windings_transformers()
        if transformers is not None and not transformers.empty and 'name' in transformers.columns:
            for eid, row in transformers.iterrows():
                n = row.get('name')
                if n and str(n) != str(eid) and str(n) != 'nan':
                    name_map[eid] = str(n)

        return name_map

    def get_monitored_elements(self):
        """Return the list of element IDs that have at least one permanent operational limit."""
        if not self.network:
            raise ValueError("Network not loaded")

        limits = self.network.get_operational_limits()
        if limits is None or limits.empty:
            return []

        limits = limits.reset_index()
        # Filter for limits of type 'CURRENT' with acceptable_duration == -1 (permanent)
        # Note: some networks might use 'THERMAL' or other types, but 'CURRENT' is standard for ampere limits.
        # Expert Assist uses 'CURRENT' (see recommender_service.py:601)
        permanent_limits = limits[(limits['type'] == 'CURRENT') & (limits['acceptable_duration'] == -1)]
        if permanent_limits.empty:
            return []
            
        ids = sorted(permanent_limits['element_id'].unique().tolist())
        return ids

    def get_voltage_levels(self):
        if not self.network:
            raise ValueError("Network not loaded")

        voltage_levels = self.network.get_voltage_levels()
        if voltage_levels is not None and not voltage_levels.empty:
            return sorted(voltage_levels.index.tolist())
        return []

    def get_voltage_level_names(self):
        """Return {vl_id: display_name} for all voltage levels."""
        if not self.network:
            raise ValueError("Network not loaded")

        name_map: dict[str, str] = {}
        voltage_levels = self.network.get_voltage_levels()
        if voltage_levels is not None and not voltage_levels.empty and 'name' in voltage_levels.columns:
            for vl_id, row in voltage_levels.iterrows():
                n = row.get('name')
                if n and str(n) != str(vl_id) and str(n) != 'nan':
                    name_map[vl_id] = str(n)

        return name_map

    def get_nominal_voltages(self):
        """Return {vl_id: nominal_v_kv} mapping for all voltage levels, snapped to detected grid values."""
        if not self.network:
            raise ValueError("Network not loaded")

        voltage_levels = self.network.get_voltage_levels()
        if voltage_levels is None or voltage_levels.empty:
            return {}

        # 1. Collect all unique nominal voltages
        raw_voltages = sorted(voltage_levels['nominal_v'].unique())
        if not raw_voltages:
            return {}

        # 2. Cluster voltages within 2% of each other
        clusters = []
        if raw_voltages:
            current_cluster = [raw_voltages[0]]
            for v in raw_voltages[1:]:
                # If v is within 2% of the cluster average, add it
                avg = sum(current_cluster) / len(current_cluster)
                if abs(v - avg) / avg < 0.02:
                    current_cluster.append(v)
                else:
                    clusters.append(current_cluster)
                    current_cluster = [v]
            clusters.append(current_cluster)

        # 3. Create representative cleaned values for each cluster
        # Map each raw voltage to its clean representative
        raw_to_clean = {}
        for cluster in clusters:
            avg = sum(cluster) / len(cluster)
            # Bucketing: anything < 25kV goes into the 25kV bucket
            if avg < 25:
                clean_v = 25.0
            else:
                # Clean representative: round to int
                clean_v = round(avg, 0)
            
            for v in cluster:
                raw_to_clean[v] = clean_v

        # 4. Map each voltage level to its clean representative
        return {vl_id: raw_to_clean[float(row['nominal_v'])] for vl_id, row in voltage_levels.iterrows()}

    def get_element_voltage_levels(self, element_id: str):
        """Resolve an equipment ID (line, transformer, or VL) to its voltage level IDs."""
        if not self.network:
            raise ValueError("Network not loaded")

        # Check if it's already a voltage level
        voltage_levels = self.network.get_voltage_levels()
        if voltage_levels is not None and element_id in voltage_levels.index:
            return [element_id]

        # Check lines (have voltage_level1_id and voltage_level2_id columns)
        lines = self.network.get_lines()
        if lines is not None and element_id in lines.index:
            row = lines.loc[element_id]
            vls = set()
            if 'voltage_level1_id' in row.index:
                vls.add(row['voltage_level1_id'])
            if 'voltage_level2_id' in row.index:
                vls.add(row['voltage_level2_id'])
            return sorted(vls)

        # Check 2-winding transformers
        transformers = self.network.get_2_windings_transformers()
        if transformers is not None and element_id in transformers.index:
            row = transformers.loc[element_id]
            vls = set()
            if 'voltage_level1_id' in row.index:
                vls.add(row['voltage_level1_id'])
            if 'voltage_level2_id' in row.index:
                vls.add(row['voltage_level2_id'])
            return sorted(vls)

        return []

    def get_load_voltage_level(self, load_id: str) -> str | None:
        """Return the voltage level ID that a given load belongs to."""
        if not self.network:
            raise ValueError("Network not loaded")

        loads = self.network.get_loads()
        if loads is not None and load_id in loads.index:
            row = loads.loc[load_id]
            if 'voltage_level_id' in row.index:
                return row['voltage_level_id']
        return None

    def get_load_voltage_levels_bulk(self, load_ids: list[str]) -> dict[str, str]:
        """Return {load_id: voltage_level_id} for a list of loads."""
        if not self.network:
            raise ValueError("Network not loaded")

        loads = self.network.get_loads()
        if loads is None or loads.empty:
            return {}

        result = {}
    def get_generator_voltage_level(self, gen_id: str) -> str | None:
        """Return the voltage level ID that a given generator belongs to."""
        if not self.network:
            raise ValueError("Network not loaded")

        generators = self.network.get_generators()
        if generators is not None and gen_id in generators.index:
            row = generators.loc[gen_id]
            if 'voltage_level_id' in row.index:
                return row['voltage_level_id']
        return None

    def get_generator_type(self, gen_id: str) -> str | None:
        """Return the energy source type of a given generator."""
        if not self.network:
            raise ValueError("Network not loaded")

        generators = self.network.get_generators()
        if generators is not None and gen_id in generators.index:
            row = generators.loc[gen_id]
            if 'energy_source' in row.index:
                return row['energy_source']
        return None

    def get_generator_types_bulk(self, gen_ids: list[str]) -> dict[str, str]:
        """Return {gen_id: energy_source} for a list of generators."""
        if not self.network:
            raise ValueError("Network not loaded")

        generators = self.network.get_generators()
        if generators is None or generators.empty:
            return {}

        result = {}
        for gid in gen_ids:
            if gid in generators.index:
                row = generators.loc[gid]
                if 'energy_source' in row.index:
                    result[gid] = row['energy_source']
        return result

network_service = NetworkService()
