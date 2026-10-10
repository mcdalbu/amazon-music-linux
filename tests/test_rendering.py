import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native'))
from rendering import frame_rate, configure_renderer

class DisplayTimingTest(unittest.TestCase):
    def test_renderer_follows_gpu_mode_after_restart_and_preserves_user_override(self):
        environment={}
        self.assertTrue(configure_renderer(environment,False,True));self.assertEqual(environment['GSK_RENDERER'],'gl')
        environment.pop('GSK_RENDERER')  # Automatically selected renderer is removed before exec.
        self.assertTrue(configure_renderer(environment,True,True));self.assertEqual(environment['GSK_RENDERER'],'vulkan')
        self.assertFalse(configure_renderer(environment,False,True));self.assertEqual(environment['GSK_RENDERER'],'vulkan')
        old_gtk={};configure_renderer(old_gtk,True,False);self.assertEqual(old_gtk['GSK_RENDERER'],'gl')
    def test_follow_monitor_instead_of_capping_at_60(self):
        for hz in [60,75,90,120,144,165,240]:
            with self.subTest(hz=hz):self.assertEqual(frame_rate(hz*1000,16667),hz)
        self.assertEqual(frame_rate(59940),60)
    def test_frame_clock_when_monitor_does_not_report_timing(self):
        self.assertEqual(frame_rate(0,8333),120)
        self.assertEqual(frame_rate(0,6944),144)
        self.assertEqual(frame_rate(),60)
    def test_bitmap_api_limit_and_invalid_timing(self):
        self.assertEqual(frame_rate(360000),240)
        self.assertEqual(frame_rate(float('nan'),float('inf')),60)
        self.assertEqual(frame_rate(-1000,-10),60)
