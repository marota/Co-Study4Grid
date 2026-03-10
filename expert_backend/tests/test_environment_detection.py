import pytest
import os
from pathlib import Path
from datetime import datetime
from expert_op4grid_recommender import config
from expert_op4grid_recommender.environment_pypowsybl import setup_environment_configs_pypowsybl

def test_non_reconnectable_detection_with_date():
    """
    Verify that non-reconnectable lines are detected correctly even when an analysis_date is provided.
    This was previously a bug where the detection was bypassed if analysis_date was not None.
    """
    # 1. Setup paths relative to ExpertAssist root
    project_root = Path(__file__).parent.parent.parent
    test_env_path = project_root / "data" / "bare_env_small_grid_test"
    
    if not test_env_path.exists():
        pytest.skip(f"Test data not found at {test_env_path}")

    # 2. Configure the environment
    original_env_name = config.ENV_NAME
    original_env_path = config.ENV_PATH
    
    config.ENV_NAME = "bare_env_small_grid_test"
    config.ENV_PATH = test_env_path
    
    # 3. Use a dummy date - before the fix, this would skip topology-based detection
    dummy_date = datetime(2024, 1, 1)
    
    try:
        # 4. Initialize environment
        # We call the real setup_environment_configs_pypowsybl which now has the fix
        env, obs, env_path, chronic_name, layout, dict_actions, lines_non_reco, lines_care = \
            setup_environment_configs_pypowsybl(analysis_date=dummy_date)
        
        # 5. Verify detected lines
        # Expected lines for bare_env_small_grid_test (from the fix verification)
        expected = {'CRENEL71VIELM', 'GEN.PL73VIELM', 'PYMONL61VOUGL', 'CPVANY632', 'PYMONY632'}
        
        detected_set = set(lines_non_reco)
        
        missing = expected - detected_set
        assert not missing, f"Non-reconnectable lines missing from detection: {missing}. Detected: {detected_set}"
        
        print(f"Verified: {len(expected)} lines correctly detected with date={dummy_date}")
        
    finally:
        # Restore configuration
        config.ENV_NAME = original_env_name
        config.ENV_PATH = original_env_path

if __name__ == "__main__":
    test_non_reconnectable_detection_with_date()
