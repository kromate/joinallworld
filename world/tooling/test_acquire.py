import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import acquire


class StaticStacStubTests(unittest.TestCase):
    def test_builds_release_item_index_and_selects_only_bbox_overlaps(self):
        release = "2026-09-23.1"
        building_collection = f"https://stac.overturemaps.org/{release}/buildings/building/collection.json"
        road_collection = f"https://stac.overturemaps.org/{release}/transportation/segment/collection.json"
        item_urls = {
            building_collection: [f"https://stac.overturemaps.org/{release}/buildings/building/item-{i}.json" for i in range(3)],
            road_collection: [f"https://stac.overturemaps.org/{release}/transportation/segment/item-{i}.json" for i in range(2)],
        }
        boxes = {
            item_urls[building_collection][0]: [-1, 5, 0, 6],
            item_urls[building_collection][1]: [40, 20, 41, 21],
            item_urls[building_collection][2]: [179, -1, 180, 1],
            item_urls[road_collection][0]: [179, -1, 180, 1],
            item_urls[road_collection][1]: [-10, 0, -9, 1],
        }
        docs = {}
        for coll, urls in item_urls.items():
            docs[coll] = {"links": [{"rel": "item", "href": url} for url in urls]}
        for url, bbox in boxes.items():
            docs[url] = {"type": "Feature", "id": Path(url).stem, "bbox": bbox,
                         "assets": {"aws": {"href": f"https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/{release}/part-{Path(url).stem}.parquet", "file:size": 1000}}}
        calls = []
        budget = acquire.NetworkBudget(100_000)

        def stub(url, _budget, _host, _release):
            calls.append(url)
            body = json.dumps(docs[url]).encode()
            _budget.add(url, len(body), '"etag-stub"')
            return docs[url], '"etag-stub"', len(body)

        config = {
            "stac": {"allowedAssetHost": "overturemaps-us-west-2.s3.us-west-2.amazonaws.com", "collections": {
                "buildings": {"url": building_collection, "itemCount": 3},
                "roads": {"url": road_collection, "itemCount": 2},
            }},
        }
        request = {"release": release, "layers": ["buildings", "roads"],
                   "region": {"bounds": [179.5, -0.5, -179.5, 0.5]}}
        with tempfile.TemporaryDirectory() as temp, patch.object(acquire, "request_json", stub):
            selected, _, receipt = acquire.select_item_index(request, config, Path(temp), budget, Path(temp), acquire.IndexDiskBudget(Path(temp) / release, 100_000))
            self.assertEqual([x["id"] for x in selected["buildings"]], ["item-2"])
            self.assertEqual([x["id"] for x in selected["roads"]], ["item-0"])
            self.assertEqual(receipt["itemCount"], 5)
            self.assertEqual(len(calls), 7)
            self.assertEqual(budget.total, sum(len(json.dumps(docs[url]).encode()) for url in calls))
            # Simulate interruption before the aggregate index is written. Per-item
            # receipts persist, so rebuilding it does not refetch completed items.
            (Path(temp) / release / "item-index.json").unlink()
            (Path(temp) / release / "item-index.receipt.json").unlink()
            second = acquire.NetworkBudget(100_000)
            selected_again, _, _ = acquire.select_item_index(request, config, Path(temp), second, Path(temp), acquire.IndexDiskBudget(Path(temp) / release, 100_000))
            self.assertEqual(selected_again, selected)
            self.assertEqual(second.total, 0)
            self.assertEqual(len(calls), 7)

    def test_road_query_filters_transportation_to_road_subtype(self):
        class Connection:
            query = ""

            def execute(self, query):
                self.query = query
                return self

            def fetchall(self):
                return []

        connection = Connection()
        proxy = SimpleNamespace(assets=[], base_url="http://127.0.0.1:4567")
        item = {"url": "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/2026-09-23.1/roads.parquet"}
        result = acquire.read_layer(connection, "roads", [item], proxy,
                                    {"region": {"bounds": [-1, 5, 0, 6]}}, [], 100)
        self.assertEqual(result, [])
        self.assertIn("subtype = 'road'", connection.query)
        self.assertIn("ST_Intersects", connection.query)

    def test_network_response_budget_fails_closed(self):
        budget = acquire.NetworkBudget(10)
        budget.add("https://stac.overturemaps.org/release/catalog.json", 8)
        with self.assertRaises(acquire.BudgetExceeded):
            budget.add("https://stac.overturemaps.org/release/item.json", 3)
        self.assertEqual(budget.total, 8)

    def test_network_reservations_prevent_concurrent_overdraw(self):
        budget = acquire.NetworkBudget(100)
        first = budget.reserve(60)
        with self.assertRaises(acquire.BudgetExceeded):
            budget.reserve(41)
        second = budget.reserve(40)
        budget.consume(first, "https://a.example/data", 50)
        budget.consume(second, "https://b.example/data", 30)
        budget.release(first)
        budget.release(second)
        self.assertEqual(budget.total, 80)
        self.assertEqual(budget.remaining, 20)


if __name__ == "__main__":
    unittest.main()
