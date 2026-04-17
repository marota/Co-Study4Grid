# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import os
from pathlib import Path
from unittest.mock import patch, mock_open, MagicMock

import numpy as np
import pytest

from expert_backend.services.recommender_service import RecommenderService
from expert_backend.main import ConfigRequest
from expert_op4grid_recommender import config

class TestRecommenderService:
    @patch("expert_backend.services.recommender_service.enrich_actions_lazy")
    @patch("expert_backend.services.recommender_service.load_actions")
    @patch("expert_backend.services.network_service.network_service")
    @patch("builtins.open", new_callable=mock_open)
    def test_update_config_applies_settings(self, mock_file, mock_network_service, mock_load_actions, mock_enrich):
        # Set up mocks
        mock_load_actions.return_value = {"existing_action": {}}
        mock_network_service.get_disconnectable_elements.return_value = ["line1", "line2"]
        mock_network_service.get_monitored_elements.return_value = ["line1"]
        
        service = RecommenderService()
        
        # Test paths
        network_path = "/tmp/test_network.xiidm"
        action_path = "/tmp/test_actions.json"
        layout_path = "/tmp/test_layout.json"

        # Create a sample config request with test data paths and custom values
        settings = ConfigRequest(
            network_path=network_path,
            action_file_path=action_path,
            layout_path=layout_path,
            min_line_reconnections=5.0,
            min_close_coupling=4.0,
            min_open_coupling=3.0,
            min_line_disconnections=2.0,
            n_prioritized_actions=20,
            monitoring_factor=0.85,
            pre_existing_overload_threshold=0.05,
            ignore_reconnections=True,
            pypowsybl_fast_mode=False
        )

        service.update_config(settings)

        # Verify that config module was updated correctly
        assert config.ENV_PATH == Path(network_path)
        assert config.ENV_NAME == "test_network.xiidm"
        assert config.ENV_FOLDER == Path("/tmp")
        assert config.ACTION_FILE_PATH == Path(action_path)
        assert config.LAYOUT_FILE_PATH == Path(layout_path)
        
        assert config.MIN_LINE_RECONNECTIONS == 5.0
        assert config.MIN_CLOSE_COUPLING == 4.0
        assert config.MIN_OPEN_COUPLING == 3.0
        assert config.MIN_LINE_DISCONNECTIONS == 2.0
        assert config.N_PRIORITIZED_ACTIONS == 20
        assert config.MONITORING_FACTOR_THERMAL_LIMITS == 0.85
        assert config.PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD == 0.05
        
        # Verify the new settings are applied
        assert config.IGNORE_RECONNECTIONS is True
        assert config.PYPOWSYBL_FAST_MODE is False

        # Verify side effects (mocks)
        mock_load_actions.assert_called_once_with(Path(action_path))
        # Since disco_ actions were not in mock_load_actions.return_value, it should have auto-generated them
        # and called open(action_path, 'w')
        mock_file.assert_called_with(Path(action_path), 'w')
        
    def test_update_config_defaults(self):
        # We also want to verify that default settings work as expected
        with patch("expert_backend.services.recommender_service.load_actions") as mock_load, \
             patch("expert_backend.services.recommender_service.enrich_actions_lazy") as mock_enrich, \
             patch("expert_backend.services.network_service.network_service") as mock_ns, \
             patch("builtins.open", mock_open()):
            
            mock_load.return_value = {"disco_line1": {}} # already has disco
            service = RecommenderService()
            
            settings = ConfigRequest(
                network_path="/tmp/net",
                action_file_path="/tmp/act.json"
                # using defaults for the rest
            )
            
            service.update_config(settings)
            
            # Defaults check (based on main.py)
            assert config.IGNORE_RECONNECTIONS is False
            assert config.PYPOWSYBL_FAST_MODE is True
            assert config.MONITORING_FACTOR_THERMAL_LIMITS == 0.95
            assert config.PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD == 0.02


class TestRestoreAnalysisContext:
    """Tests for RecommenderService.restore_analysis_context()."""

    def test_restore_sets_analysis_context(self):
        service = RecommenderService()
        assert service._analysis_context is None

        service.restore_analysis_context(
            lines_we_care_about=["LINE_A", "LINE_B"],
            disconnected_element="LINE_X",
            lines_overloaded=["LINE_A"],
        )

        assert service._analysis_context is not None
        assert service._analysis_context["lines_we_care_about"] == ["LINE_A", "LINE_B"]
        assert service._analysis_context["lines_overloaded"] == ["LINE_A"]
        assert service._last_disconnected_element == "LINE_X"

    def test_restore_with_none_lines(self):
        service = RecommenderService()
        service.restore_analysis_context(lines_we_care_about=None)

        assert service._analysis_context is not None
        assert service._analysis_context["lines_we_care_about"] is None

    def test_restore_with_computed_pairs(self):
        service = RecommenderService()
        pairs = {"act1+act2": {"max_rho": 0.5, "betas": [0.1, 0.2]}}
        service.restore_analysis_context(
            lines_we_care_about=["L1"],
            computed_pairs=pairs,
        )

        assert service._saved_computed_pairs == pairs
        assert service.get_saved_computed_pairs() == pairs

    def test_restore_without_computed_pairs(self):
        service = RecommenderService()
        service.restore_analysis_context(lines_we_care_about=["L1"])

        assert service._saved_computed_pairs is None
        assert service.get_saved_computed_pairs() is None

    def test_restore_without_optional_fields(self):
        service = RecommenderService()
        service.restore_analysis_context(lines_we_care_about=["L1", "L2"])

        assert service._analysis_context["lines_we_care_about"] == ["L1", "L2"]
        assert "lines_overloaded" not in service._analysis_context
        assert service._last_disconnected_element is None

    def test_restore_updates_disconnected_element(self):
        service = RecommenderService()
        service._last_disconnected_element = "OLD_LINE"
        service.restore_analysis_context(
            lines_we_care_about=["L1"],
            disconnected_element="NEW_LINE",
        )
        assert service._last_disconnected_element == "NEW_LINE"

    def test_restore_does_not_overwrite_disconnected_element_if_none(self):
        service = RecommenderService()
        service._last_disconnected_element = "EXISTING"
        service.restore_analysis_context(
            lines_we_care_about=["L1"],
            disconnected_element=None,
        )
        # None is falsy, so it should not overwrite
        assert service._last_disconnected_element == "EXISTING"

    def test_reset_clears_restored_context(self):
        service = RecommenderService()
        service.restore_analysis_context(
            lines_we_care_about=["L1"],
            computed_pairs={"p": {}},
        )
        assert service._analysis_context is not None
        assert service._saved_computed_pairs is not None

        service.reset()
        assert service._analysis_context is None
        assert service._saved_computed_pairs is None


class TestGetMonitoringParametersWithContext:
    """Tests that _get_monitoring_parameters uses restored analysis context."""

    def _make_mock_obs(self, line_names):
        obs = MagicMock()
        obs.name_line = line_names
        obs._network_manager = MagicMock()
        network = MagicMock()
        obs._network_manager.network = network
        # Return empty limits so branches_with_limits defaults to set()
        import pandas as pd
        network.get_operational_limits.return_value = pd.DataFrame()
        return obs

    def test_uses_context_lines_we_care_about(self):
        service = RecommenderService()
        service._analysis_context = {
            "lines_we_care_about": ["LINE_A", "LINE_C"]
        }
        obs = self._make_mock_obs(["LINE_A", "LINE_B", "LINE_C"])

        lines, _ = service._get_monitoring_parameters(obs)
        assert lines == ["LINE_A", "LINE_C"]

    def test_fallback_without_context(self):
        service = RecommenderService()
        service._analysis_context = None
        obs = self._make_mock_obs(["LINE_A", "LINE_B"])

        # With IGNORE_LINES_MONITORING=True (default), falls back to all lines
        original = getattr(config, 'IGNORE_LINES_MONITORING', True)
        config.IGNORE_LINES_MONITORING = True
        try:
            lines, _ = service._get_monitoring_parameters(obs)
            assert lines == ["LINE_A", "LINE_B"]
        finally:
            config.IGNORE_LINES_MONITORING = original

    def test_context_with_none_care_falls_back_to_all_lines(self):
        service = RecommenderService()
        service._analysis_context = {"lines_we_care_about": None}
        obs = self._make_mock_obs(["L1", "L2", "L3"])

        lines, _ = service._get_monitoring_parameters(obs)
        assert lines == ["L1", "L2", "L3"]


class TestPrefetchBaseNad:
    """Tests for the base-NAD prefetch (perf #2 — see docs/perf-nad-prefetch.md).

    The prefetch runs concurrently with `setup_environment_configs_pypowsybl`
    inside `update_config` so the subsequent `/api/network-diagram` XHR can
    skip the ~6 s of pypowsybl NAD regeneration entirely.
    """

    def test_initial_state_has_no_prefetch(self):
        service = RecommenderService()
        assert service._prefetched_base_nad is None
        assert service._prefetched_base_nad_event is None
        assert service.get_prefetched_base_nad() is None

    def test_prefetch_populates_cache_on_success(self):
        service = RecommenderService()

        expected = {"svg": "<svg>prefetched</svg>", "metadata": None}
        # `_get_base_network()` is called in the main thread to pre-warm
        # the network cache; the worker then calls `get_network_diagram`
        # on the hot cache. Patch both so we don't need pypowsybl.
        with patch.object(service, "_get_base_network", return_value=MagicMock()), \
             patch.object(service, "get_network_diagram", return_value=expected):
            service.prefetch_base_nad_async()
            # Block until the worker completes.
            result = service.get_prefetched_base_nad(timeout=10)

        assert result == expected
        assert service._prefetched_base_nad_error is None

    def test_prefetch_surfaces_worker_exception(self):
        service = RecommenderService()

        boom = RuntimeError("pypowsybl exploded")
        with patch.object(service, "_get_base_network", return_value=MagicMock()), \
             patch.object(service, "get_network_diagram", side_effect=boom):
            service.prefetch_base_nad_async()
            with pytest.raises(RuntimeError, match="pypowsybl exploded"):
                service.get_prefetched_base_nad(timeout=10)

    def test_prefetch_records_network_load_error_without_spawning_worker(self):
        """If `_get_base_network()` fails in the main thread, no worker
        should be started — the error is recorded directly and the event
        is pre-set so the next `get_prefetched_base_nad()` re-raises
        instantly."""
        service = RecommenderService()

        boom = FileNotFoundError("network file gone")
        with patch.object(service, "_get_base_network", side_effect=boom):
            service.prefetch_base_nad_async()
        # Worker thread was never started.
        assert service._prefetched_base_nad_thread is None
        # Event is pre-set so there is no wait.
        assert service._prefetched_base_nad_event is not None
        assert service._prefetched_base_nad_event.is_set()
        with pytest.raises(FileNotFoundError):
            service.get_prefetched_base_nad(timeout=0.1)

    def test_reset_drains_pending_prefetch_and_clears_state(self):
        """A dangling worker thread that finishes after reset() would
        otherwise write stale SVG into the next study's cache. `reset()`
        must join the worker and then zero the fields."""
        service = RecommenderService()
        expected = {"svg": "<svg>first_study</svg>", "metadata": None}
        with patch.object(service, "_get_base_network", return_value=MagicMock()), \
             patch.object(service, "get_network_diagram", return_value=expected):
            service.prefetch_base_nad_async()
            # Make sure the worker ran to completion before reset.
            service.get_prefetched_base_nad(timeout=10)

        service.reset()
        assert service._prefetched_base_nad is None
        assert service._prefetched_base_nad_error is None
        assert service._prefetched_base_nad_event is None
        assert service._prefetched_base_nad_thread is None
        assert service.get_prefetched_base_nad() is None

    def test_timeout_returns_none_without_raising(self):
        """When the caller runs out of patience, `get_prefetched_base_nad`
        returns None (signalling 'fall through to fresh compute') rather
        than raising, so the endpoint stays usable. The worker keeps
        running — its eventual result will be discarded on the next reset."""
        service = RecommenderService()

        import threading
        release = threading.Event()

        def slow_get_diagram():
            release.wait(timeout=5)
            return {"svg": "<svg/>", "metadata": None}

        try:
            with patch.object(service, "_get_base_network", return_value=MagicMock()), \
                 patch.object(service, "get_network_diagram", side_effect=slow_get_diagram):
                service.prefetch_base_nad_async()
                result = service.get_prefetched_base_nad(timeout=0.05)
                assert result is None
        finally:
            # Let the worker finish so the daemon thread doesn't linger.
            release.set()
            if service._prefetched_base_nad_thread is not None:
                service._prefetched_base_nad_thread.join(timeout=5)



