import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('appearance', Path(__file__).resolve().parents[1] / 'native/appearance.py')
appearance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(appearance)


class AppearanceTest(unittest.TestCase):
    def test_portal_preference_wins_over_gtk_and_gsettings(self):
        self.assertEqual(appearance.resolve_theme(1, 'default', 'Adwaita'), 'dark')
        self.assertEqual(appearance.resolve_theme(2, 'prefer-dark', 'Adwaita-dark'), 'light')

    def test_fallback_with_missing_or_unspecified_portal(self):
        for value in [None, 0, 9]:
            self.assertEqual(appearance.resolve_theme(value, 'prefer-dark'), 'dark')
            self.assertEqual(appearance.resolve_theme(value, 'prefer-light'), 'light')
            self.assertEqual(appearance.resolve_theme(value, 'default', 'Adwaita-dark'), 'dark')
            self.assertEqual(appearance.resolve_theme(value), 'system')

    def test_nested_variants_from_legacy_and_current_portals(self):
        GLib = appearance.GLib
        self.assertEqual(appearance.unpack_variant(GLib.Variant('(v)', (GLib.Variant('u', 1),))), 1)
        self.assertEqual(appearance.unpack_variant(GLib.Variant('(v)', (GLib.Variant('v', GLib.Variant('u', 2)),))), 2)
