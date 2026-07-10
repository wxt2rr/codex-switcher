import importlib.util
import os
import unittest
from unittest.mock import patch


SCRIPT_PATH = os.path.join(os.path.dirname(__file__), "profile-metrics.py")
SPEC = importlib.util.spec_from_file_location("profile_metrics", SCRIPT_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC is not None and SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class ProfileMetricsTests(unittest.TestCase):
    def test_collect_api_metrics_marks_unauthorized(self) -> None:
        with patch.object(
            MODULE,
            "request_usage",
            return_value={"ok": False, "error": "unauthorized", "http_code": 401},
        ):
            metrics = MODULE.collect_api_metrics("token", "account", "http://127.0.0.1:7899", 4)

        self.assertEqual(metrics.get("source"), "api")
        self.assertEqual(metrics.get("error"), "unauthorized")
        self.assertEqual(metrics.get("http_code"), 401)
        self.assertEqual(metrics.get("windows"), {})

    def test_request_usage_without_token_is_expired(self) -> None:
        result = MODULE.request_usage("", "account", "http://127.0.0.1:7899", 4)
        self.assertFalse(result.get("ok"))
        self.assertEqual(result.get("error"), "expired")

    def test_pick_error_usage_label(self) -> None:
        self.assertEqual(MODULE.pick_error_usage_label("expired"), "expired")
        self.assertEqual(MODULE.pick_error_usage_label("unauthorized"), "unauthorized")
        self.assertEqual(MODULE.pick_error_usage_label("network-failed"), "network-failed")
        self.assertEqual(MODULE.pick_error_usage_label("anything-else"), "api-failed")


if __name__ == "__main__":
    unittest.main()
