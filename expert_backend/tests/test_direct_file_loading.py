import unittest
from unittest.mock import MagicMock, patch, mock_open
from pathlib import Path
from expert_backend.services.recommender_service import RecommenderService
from expert_backend.main import ConfigRequest
from expert_op4grid_recommender import config as recommender_config

class TestDirectFileLoading(unittest.TestCase):
    def setUp(self):
        self.service = RecommenderService()
        self.original_config = {
            'ENV_FOLDER': recommender_config.ENV_FOLDER,
            'ENV_NAME': recommender_config.ENV_NAME,
            'ENV_PATH': recommender_config.ENV_PATH,
            'ACTION_FILE_PATH': recommender_config.ACTION_FILE_PATH,
        }

    def tearDown(self):
        recommender_config.ENV_FOLDER = self.original_config['ENV_FOLDER']
        recommender_config.ENV_NAME = self.original_config['ENV_NAME']
        recommender_config.ENV_PATH = self.original_config['ENV_PATH']
        recommender_config.ACTION_FILE_PATH = self.original_config['ACTION_FILE_PATH']

    @patch("expert_backend.services.recommender_service.load_actions")
    @patch("expert_backend.services.recommender_service.enrich_actions_lazy")
    @patch("expert_backend.services.network_service.network_service")
    @patch("builtins.open", new_callable=mock_open)
    def test_update_config_with_xiidm_file(self, mock_file, mock_ns, mock_enrich, mock_load):
        # Setup mock load_actions to return a real dict to avoid serialization issues
        mock_load.return_value = {"actions": {}}
        
        # Scenario: user provides a .xiidm file as network_path
        # Note: Frontend sends absolute path for network_path when a file is selected
        network_path = "/path/to/data/my_grid.xiidm"
        action_path = "/path/to/actions.json"
        
        settings = ConfigRequest(
            network_path=network_path,
            action_file_path=action_path,
            monitoring_factor=0.95
        )
        
        # Mock Path.exists to return True for the files
        with patch.object(Path, "exists", return_value=True), \
             patch.object(Path, "is_file", side_effect=lambda self: self.name == "my_grid.xiidm" or self.name == "actions.json"), \
             patch.object(Path, "is_dir", side_effect=lambda self: self.name == "data"):
            
            self.service.update_config(settings)
            
            # Verify recommender config was updated correctly.
            # Convert to string for comparison as recommender_config might store Path or string
            self.assertEqual(str(recommender_config.ENV_FOLDER), str(Path(network_path).parent))
            self.assertEqual(recommender_config.ENV_NAME, "my_grid.xiidm")
            self.assertEqual(str(recommender_config.ENV_PATH), network_path)
            self.assertEqual(str(recommender_config.ACTION_FILE_PATH), action_path)

    @patch("pypowsybl.network.load")
    def test_get_base_network_with_file_path(self, mock_load):
        service = RecommenderService()
        
        # Setup scenario where ENV_PATH is a direct file
        network_path = "/path/to/data/grid.xiidm"
        direct_path = Path(network_path)
        
        recommender_config.ENV_PATH = direct_path
        
        mock_net = MagicMock()
        mock_load.return_value = mock_net
        
        with patch.object(Path, "exists", return_value=True), \
             patch.object(Path, "is_dir", return_value=False):
            
            # Call the internal method (no arguments)
            n = service._get_base_network()
            
            # Verify pypowsybl.network.load was called with the direct file path
            mock_load.assert_called_once_with(str(direct_path))
            self.assertEqual(n, mock_net)

if __name__ == "__main__":
    unittest.main()
