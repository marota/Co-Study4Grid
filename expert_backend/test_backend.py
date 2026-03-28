# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import requests
import json

BASE_URL = "http://localhost:8000"

def test_config():
    url = f"{BASE_URL}/config"
    payload = {
        "network_path": "/home/marotant/dev/Expert_op4grid_recommender/data/bare_env_20240828T0100Z_dijon_only",
        "action_file_path": "/home/marotant/dev/Expert_op4grid_recommender/data/action_space/reduced_model_actions_20240828T0100Z_new_dijon.json"
    }
    response = requests.post(url, json=payload)
    print(f"Config Response: {response.status_code}")
    print(response.json())

def test_branches():
    url = f"{BASE_URL}/branches"
    response = requests.get(url)
    print(f"Branches Response: {response.status_code}")
    # Print first few branches to avoid spam
    data = response.json()
    if "branches" in data:
        print(f"Branches found: {len(data['branches'])}")
        print(f"Sample branches: {data['branches'][:5]}")
    else:
        print(data)

def test_run_analysis():
    url = f"{BASE_URL}/run-analysis"
    # Testing with a known disconnectable element if possible, or just checking the call structure
    # The user suggested "P.SAOL31RONCI"
    payload = {
        "disconnected_element": "P.SAOL31RONCI"
    }
    print(f"Running analysis for {payload['disconnected_element']}...")
    try:
        response = requests.post(url, json=payload, timeout=60) # Increased timeout for analysis
        print(f"Run Analysis Response: {response.status_code}")
        print(response.json())
    except Exception as e:
        print(f"Analysis request failed or timed out: {e}")

if __name__ == "__main__":
    print("Testing Config...")
    test_config()
    print("\nTesting Branches...")
    test_branches()
    print("\nTesting Run Analysis...")
    test_run_analysis()
