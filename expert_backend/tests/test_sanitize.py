# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

"""Tests for the sanitize_for_json utility function."""

import numpy as np
import pytest

from expert_backend.services.recommender_service import sanitize_for_json


class TestSanitizeForJson:
    """Tests for recursive JSON sanitization of NumPy/Python types."""

    def test_native_int(self):
        assert sanitize_for_json(42) == 42
        assert isinstance(sanitize_for_json(42), int)

    def test_native_float(self):
        assert sanitize_for_json(3.14) == 3.14
        assert isinstance(sanitize_for_json(3.14), float)

    def test_native_string(self):
        assert sanitize_for_json("hello") == "hello"

    def test_native_bool(self):
        # In Python, bool is a subclass of int, so sanitize_for_json(True)
        # hits the (np.integer, int) branch and returns int(True) == 1
        assert sanitize_for_json(True) == 1
        assert sanitize_for_json(False) == 0

    def test_none(self):
        assert sanitize_for_json(None) is None

    def test_numpy_int32(self):
        val = np.int32(10)
        result = sanitize_for_json(val)
        assert result == 10
        assert isinstance(result, int)

    def test_numpy_int64(self):
        val = np.int64(999999)
        result = sanitize_for_json(val)
        assert result == 999999
        assert isinstance(result, int)

    def test_numpy_float32(self):
        val = np.float32(2.5)
        result = sanitize_for_json(val)
        assert isinstance(result, float)
        assert abs(result - 2.5) < 0.01

    def test_numpy_float64(self):
        val = np.float64(1.23456789)
        result = sanitize_for_json(val)
        assert isinstance(result, float)
        assert result == pytest.approx(1.23456789)

    def test_numpy_1d_array(self):
        arr = np.array([1, 2, 3])
        result = sanitize_for_json(arr)
        assert result == [1, 2, 3]
        assert all(isinstance(v, int) for v in result)

    def test_numpy_2d_array(self):
        arr = np.array([[1.0, 2.0], [3.0, 4.0]])
        result = sanitize_for_json(arr)
        assert result == [[1.0, 2.0], [3.0, 4.0]]

    def test_empty_numpy_array(self):
        arr = np.array([])
        result = sanitize_for_json(arr)
        assert result == []

    def test_dict_with_numpy_values(self):
        data = {"a": np.int64(1), "b": np.float64(2.5), "c": "text"}
        result = sanitize_for_json(data)
        assert result == {"a": 1, "b": 2.5, "c": "text"}
        assert isinstance(result["a"], int)
        assert isinstance(result["b"], float)

    def test_dict_keys_converted_to_str(self):
        data = {1: "one", 2: "two"}
        result = sanitize_for_json(data)
        assert result == {"1": "one", "2": "two"}

    def test_nested_dict(self):
        data = {
            "outer": {
                "inner": np.array([1, 2, 3]),
                "value": np.float64(1.5),
            }
        }
        result = sanitize_for_json(data)
        assert result == {"outer": {"inner": [1, 2, 3], "value": 1.5}}

    def test_list_with_mixed_numpy(self):
        data = [np.int32(1), np.float64(2.0), "three", None]
        result = sanitize_for_json(data)
        assert result == [1, 2.0, "three", None]

    def test_tuple_converted_to_list(self):
        data = (np.int64(1), np.int64(2))
        result = sanitize_for_json(data)
        assert result == [1, 2]

    def test_empty_dict(self):
        assert sanitize_for_json({}) == {}

    def test_empty_list(self):
        assert sanitize_for_json([]) == []

    def test_deeply_nested_structure(self):
        data = {
            "level1": [
                {"level2": np.array([np.float64(1.1), np.float64(2.2)])},
                {"level2": np.int32(42)},
            ]
        }
        result = sanitize_for_json(data)
        assert result["level1"][0]["level2"] == [1.1, 2.2]
        assert result["level1"][1]["level2"] == 42

    def test_object_with_to_dict(self):
        class FakeObj:
            def to_dict(self):
                return {"key": np.int64(5)}

        result = sanitize_for_json(FakeObj())
        assert result == {"key": 5}

    def test_object_with_vars(self):
        class SimpleObj:
            def __init__(self):
                self.x = np.float64(1.0)
                self.y = np.float64(2.0)

        result = sanitize_for_json(SimpleObj())
        assert result == {"x": 1.0, "y": 2.0}

    def test_fallback_to_str(self):
        """Objects that can't be serialized fall back to str()."""

        class Opaque:
            def __str__(self):
                return "opaque_value"

            def __init__(self):
                pass

            # Make vars() raise TypeError
            @property
            def __dict__(self):
                raise TypeError("no dict")

        result = sanitize_for_json(Opaque())
        assert isinstance(result, str)

    def test_numpy_bool(self):
        val = np.bool_(True)
        result = sanitize_for_json(val)
        # np.bool_ may not be a subclass of np.integer in newer numpy,
        # so it may fall through to str representation
        assert result in (1, True, "True")
