import unittest
from types import SimpleNamespace

import acquire


class AcquisitionFailureProtocolTests(unittest.TestCase):
    def test_only_settled_network_budgets_can_emit_measured_typed_failure(self):
        budget = acquire.NetworkBudget(1_000)
        budget.add("https://stac.overturemaps.org/2026-09-23.1/doc.json", 321)
        self.assertTrue(budget.settled)
        failure = acquire.typed_budget_failure("selected-item-count", budget)
        self.assertEqual(failure.reason, "selected-item-count")
        self.assertEqual(failure.network_bytes_measured, 321)
        with self.assertRaises(acquire.BudgetExceeded):
            acquire.typed_budget_failure("feature-row-budget", budget, {"phase": "late-read"})

        reservation = budget.reserve(100)
        self.assertFalse(budget.settled)
        with self.assertRaises(acquire.BudgetExceeded):
            acquire.typed_budget_failure("feature-row-budget", budget)
        budget.release(reservation)
        with self.assertRaises(ValueError):
            acquire.AdapterBudgetFailure("disk-budget", 321)

    def test_feature_row_limit_has_a_distinct_internal_reason(self):
        class Connection:
            def execute(self, _query):
                return self

            def fetchall(self):
                return [(), ()]

        connection = Connection()
        proxy = SimpleNamespace(assets=[], base_url="http://127.0.0.1:4567")
        with self.assertRaises(acquire.FeatureRowLimitExceeded):
            acquire.read_layer(connection, "buildings", [{"url": "https://assets.example/release/part.parquet"}], proxy,
                               {"region": {"bounds": [-1, 5, 0, 6]}}, [], 1)

    def test_protocol_reason_set_is_exact_and_measurement_requires_integer(self):
        budget = acquire.NetworkBudget(100)
        for reason in ("selected-item-count", "feature-row-budget", "geojson-output-bytes"):
            failure = acquire.typed_budget_failure(reason, budget)
            self.assertEqual(failure.network_bytes_measured, 0)
        for reason in ("network-budget", "disk-budget", "output-byte-budget"):
            with self.assertRaises(ValueError):
                acquire.AdapterBudgetFailure(reason, 0)
        for measured in (-1, True, 1.25):
            with self.assertRaises(ValueError):
                acquire.AdapterBudgetFailure("geojson-output-bytes", measured)


if __name__ == "__main__":
    unittest.main()
