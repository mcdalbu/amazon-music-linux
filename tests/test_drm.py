import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native'))
from drm import drm_state
class DrmTest(unittest.TestCase):
    def test_first_download_only_requires_restart(self):
        component={'status':'updated','version':'4.10.2934.0'}
        self.assertEqual(drm_state(component,False),'restart')
        self.assertEqual(drm_state(component,False,{'4.10.2934.0'}),'unavailable')
    def test_eme_verifies_readiness(self):
        self.assertEqual(drm_state({'status':'new','version':'4.10.2934.0'},False),'unavailable')
        self.assertEqual(drm_state(None,True),'ready')
        self.assertEqual(drm_state({'status':'updated','version':'4.10.3112.0'},True),'ready')
        self.assertEqual(drm_state({'status':'new','version':'4.10.3112.0'},False),'unavailable')
    def test_registration_is_not_installation(self):
        self.assertEqual(drm_state({'status':'unavailable','version':'0.0.0.0'},False),'unavailable')
        self.assertEqual(drm_state({'status':'updated','version':'0.0.0.0'},False),'unavailable')
        self.assertEqual(drm_state({'status':'preparing'},False),'preparing')
