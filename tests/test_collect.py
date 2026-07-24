import json
from pathlib import Path
import unittest

from scripts.collect import collapse_channels, merge_inventory, parse_upstream_payload, tracking_for_entry


class CollapseChannelsTest(unittest.TestCase):
    def test_collapses_architectures_and_preserves_variants(self):
        channel_map = [
            {"channel": {"track": "latest", "risk": "stable", "architecture": "amd64"}, "version": "1.2.0"},
            {"channel": {"track": "latest", "risk": "stable", "architecture": "arm64"}, "version": "1.2.0"},
            {"channel": {"track": "latest", "risk": "stable", "architecture": "armhf"}, "version": "1.1.9"},
            {"channel": {"track": "2", "risk": "stable", "architecture": "amd64"}, "version": "2.0.0"},
            {"channel": {"track": "latest", "risk": "edge", "architecture": "amd64"}, "version": "1.3.0"},
        ]

        channels = collapse_channels(channel_map)

        self.assertEqual(channels["stable"]["version"], "1.2.0")
        self.assertEqual(channels["stable"]["versions"], ["1.2.0", "1.1.9"])
        self.assertEqual(channels["edge"]["version"], "1.3.0")
        self.assertIsNone(channels["candidate"]["version"])


class MergeInventoryTest(unittest.TestCase):
    def test_keeps_configured_unpublished_snaps_and_discovers_store_snaps(self):
        configured = [{"name": "tessl"}, {"name": "azimuth"}]
        discovered = ["azimuth", "mindustry"]

        self.assertEqual(
            [entry["name"] for entry in merge_inventory(configured, discovered)],
            ["azimuth", "mindustry", "tessl"],
        )


class UpstreamPayloadTest(unittest.TestCase):
    def test_parses_github_and_codeberg_release_tags(self):
        self.assertEqual(
            parse_upstream_payload("github", {"tag_name": "v2.4.1"}), "v2.4.1"
        )
        self.assertEqual(
            parse_upstream_payload("codeberg", {"tag_name": "v11.0.0"}), "v11.0.0"
        )

    def test_parses_npm_latest_version(self):
        self.assertEqual(parse_upstream_payload("npm", {"version": "0.92.0"}), "0.92.0")


    def test_rejects_non_version_tags(self):
        with self.assertRaises(ValueError):
            parse_upstream_payload("github", {"tag_name": "public"})


class TrackingMetadataTest(unittest.TestCase):
    def test_defaults_to_automatic_tracking(self):
        self.assertEqual(tracking_for_entry({"name": "example"}), {"mode": "automatic"})

    def test_preserves_explicit_tracking_metadata(self):
        tracking = {
            "mode": "static",
            "url": "https://example.com/story",
            "note": "Intentionally unchanged",
        }
        self.assertEqual(tracking_for_entry({"name": "example", "tracking": tracking}), tracking)

    def test_known_sources_and_null_are_explicitly_classified(self):
        config = json.loads(Path("config/snaps.json").read_text())
        entries = {entry["name"]: entry for entry in config["snaps"]}
        expected_manual = {
            "zx-pokemaster": "https://github.com/popey/zx-pokemaster-snap",
            "pwbm": "https://github.com/popey/pwbm",
            "add-flatpak": "https://github.com/popey/add-flatpak",
            "sfxr": "https://github.com/popey/sfxr-snap",
            "lapin": "https://github.com/popey/lapin-snap",
            "openboardview": "https://github.com/popey/openboardview-snap",
        }
        for name, url in expected_manual.items():
            self.assertEqual(entries[name]["tracking"]["mode"], "manual")
            self.assertEqual(entries[name]["tracking"]["url"], url)
        self.assertEqual(entries["null"]["tracking"]["mode"], "static")
        self.assertEqual(entries["null"]["tracking"]["url"], "https://popey.com/blog/2021/01/null/")


if __name__ == "__main__":
    unittest.main()
