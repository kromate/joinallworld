import json
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import sys
import tempfile
import threading
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


class RangeProxyDiagnosticsTests(unittest.TestCase):
    def make_upstream(self):
        state = {"requests": 0}

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt, *args):
                return

            def do_GET(self):
                state["requests"] += 1
                if self.path.endswith("/drop"):
                    self.connection.close()
                    return
                if self.path.endswith("/truncated"):
                    self.send_response(206)
                    self.send_header("Content-Length", "3")
                    self.send_header("Content-Range", "bytes 0-2/3")
                    self.end_headers()
                    self.wfile.write(b"a")
                    return
                if self.headers.get("Range") != "bytes=0-2":
                    self.send_error(416)
                    return
                body = b"abc"
                self.send_response(206)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Content-Range", "bytes 0-2/3")
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("ETag", '"fixture"')
                self.end_headers()
                self.wfile.write(body)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return server, thread, state

    def make_proxy(self, budget):
        return acquire.RangeProxy([
            {"id": "broken-item", "layer": "buildings", "url": "https://assets.example/release/drop", "fileBytes": 3},
            {"id": "valid-item", "layer": "roads", "url": "https://assets.example/release/good", "fileBytes": 3},
            {"id": "truncated-item", "layer": "buildings", "url": "https://assets.example/release/truncated", "fileBytes": 3},
        ], budget, "assets.example", "release", concurrency=1)

    @staticmethod
    def request(proxy, index):
        client = http.client.HTTPConnection("127.0.0.1", proxy.httpd.server_port, timeout=5)
        try:
            client.request("GET", f"/asset/{index}", headers={"Range": "bytes=0-2"})
            response = client.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            client.close()

    def test_budget_rejection_has_bounded_quota_response_and_releases_reservation(self):
        upstream, thread, state = self.make_upstream()
        budget = acquire.NetworkBudget(8_194)
        proxy = self.make_proxy(budget)
        try:
            with patch.object(acquire.http.client, "HTTPSConnection",
                              side_effect=lambda host, port, timeout: http.client.HTTPConnection("127.0.0.1", upstream.server_port, timeout=timeout)):
                proxy_thread = proxy.start()
                try:
                    status, headers, body = self.request(proxy, 1)
                    self.assertEqual(status, 429)
                    self.assertEqual(headers["X-Joinallworld-Proxy-Error"], "network-budget-exceeded")
                    self.assertEqual(json.loads(body), {"error": "network-budget-exceeded"})
                    self.assertEqual(state["requests"], 0)
                    self.assertEqual(budget.reservations, {})
                    diagnostic = proxy.first_error()
                    self.assertEqual(diagnostic["phase"], "reserve_network_budget")
                    self.assertEqual(diagnostic["errorType"], "BudgetExceeded")
                    self.assertEqual(diagnostic["assetId"], "valid-item")
                    self.assertEqual(diagnostic["range"], "bytes=0-2")

                    # A rejected reservation leaves no phantom charge; a later
                    # bounded request can use the same proxy after capacity is raised.
                    budget.maximum = 100_000
                    status, headers, body = self.request(proxy, 1)
                    self.assertEqual(status, 206)
                    self.assertEqual(body, b"abc")
                    self.assertNotIn("X-Joinallworld-Proxy-Error", headers)
                    self.assertEqual(budget.reservations, {})
                    self.assertLessEqual(budget.total, budget.maximum)
                finally:
                    proxy.close()
                    proxy_thread.join(timeout=2)
        finally:
            upstream.shutdown()
            upstream.server_close()
            thread.join(timeout=2)

    def test_upstream_disconnect_is_reported_and_next_request_releases_resources(self):
        upstream, thread, state = self.make_upstream()
        budget = acquire.NetworkBudget(100_000)
        proxy = self.make_proxy(budget)
        try:
            with patch.object(acquire.http.client, "HTTPSConnection",
                              side_effect=lambda host, port, timeout: http.client.HTTPConnection("127.0.0.1", upstream.server_port, timeout=timeout)):
                proxy_thread = proxy.start()
                try:
                    status, headers, body = self.request(proxy, 0)
                    self.assertEqual(status, 502)
                    self.assertEqual(headers["X-Joinallworld-Proxy-Error"], "upstream-range-failure")
                    self.assertEqual(json.loads(body), {"error": "upstream-range-failure"})
                    diagnostic = proxy.first_error()
                    self.assertEqual(diagnostic["phase"], "upstream_headers")
                    self.assertEqual(diagnostic["assetId"], "broken-item")
                    self.assertEqual(diagnostic["layer"], "buildings")
                    self.assertEqual(diagnostic["range"], "bytes=0-2")
                    self.assertIsNone(diagnostic["upstreamStatus"])
                    self.assertEqual(budget.reservations, {})

                    status, headers, body = self.request(proxy, 1)
                    self.assertEqual(status, 206)
                    self.assertEqual(body, b"abc")
                    self.assertEqual(state["requests"], 2)
                    self.assertEqual(budget.reservations, {})
                    self.assertLessEqual(budget.total, budget.maximum)
                finally:
                    proxy.close()
                    proxy_thread.join(timeout=2)
        finally:
            upstream.shutdown()
            upstream.server_close()
            thread.join(timeout=2)

    def test_adapter_stderr_error_context_includes_first_proxy_failure(self):
        upstream, thread, _ = self.make_upstream()

        class FakeDuckDBConnection:
            def execute(self, query):
                if query.startswith("SELECT "):
                    url = re.search(r"'(http://127\.0\.0\.1:\d+/asset/\d+)'", query).group(1)
                    parsed = acquire.urlsplit(url)
                    client = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=5)
                    try:
                        client.request("GET", parsed.path, headers={"Range": "bytes=0-2"})
                        response = client.getresponse()
                        response.read()
                        if response.status >= 400:
                            raise RuntimeError("Server returned nothing (no headers, no data)")
                    finally:
                        client.close()
                return self

            def fetchall(self):
                return []

            def close(self):
                return None

        class FakeDuckDB:
            @staticmethod
            def connect(database=":memory:"):
                return FakeDuckDBConnection()

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            selected_asset = {"id": "fiji-building-item", "layer": "buildings",
                              "url": "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/2026-09-23.1/drop", "fileBytes": 3}
            request = {"schemaVersion": 1, "id": "fiji-test", "inventoryUnitId": "unit:fiji",
                       "region": {"id": "fiji", "parentId": None, "name": "Fiji", "kind": "cell",
                                  "countryCode": "FJ", "timezone": "Pacific/Fiji",
                                  "bounds": [179.998, -16.8, -179.998, -16.796]},
                       "provider": "overture", "release": "2026-09-23.1", "layers": ["buildings"],
                       "limits": {"networkBytes": 100_000, "outputBytes": 1_000_000,
                                  "features": 100, "durationMs": 60_000, "memoryMb": 512,
                                  "diskBytes": 10_000_000}}
            source_config = json.loads(Path(acquire.__file__).resolve().parents[1].joinpath("acquisition-sources.json").read_text())
            adapter_input = {"request": request, "sourceConfig": source_config,
                             "cacheDir": str(root / "acquisitions" / "staging"),
                             "allowedRoot": str(root), "sourceIndexDir": str(root / "acquisition-index")}
            with patch.dict(sys.modules, {"duckdb": FakeDuckDB}), \
                    patch.object(acquire, "apply_limits"), \
                    patch.object(acquire, "select_item_index",
                                 return_value=({"buildings": [selected_asset]}, [],
                                               {"sha256": "a" * 64, "itemCount": 640, "selectedCount": 1})), \
                    patch.object(acquire.http.client, "HTTPSConnection",
                                 side_effect=lambda host, port, timeout: http.client.HTTPConnection("127.0.0.1", upstream.server_port, timeout=timeout)):
                try:
                    with self.assertRaisesRegex(RuntimeError, "first range proxy failure") as raised:
                        acquire.run(adapter_input)
                    message = str(raised.exception)
                    self.assertIn('"assetId":"fiji-building-item"', message)
                    self.assertIn('"phase":"upstream_headers"', message)
                    self.assertIn('"range":"bytes=0-2"', message)
                    self.assertLess(len(message), 4_000)
                finally:
                    upstream.shutdown()
                    upstream.server_close()
                    thread.join(timeout=2)

    def test_upstream_truncated_body_returns_error_and_releases_resources(self):
        upstream, thread, state = self.make_upstream()
        budget = acquire.NetworkBudget(100_000)
        proxy = self.make_proxy(budget)
        try:
            with patch.object(acquire.http.client, "HTTPSConnection",
                              side_effect=lambda host, port, timeout: http.client.HTTPConnection("127.0.0.1", upstream.server_port, timeout=timeout)):
                proxy_thread = proxy.start()
                try:
                    status, headers, body = self.request(proxy, 2)
                    self.assertEqual(status, 502)
                    self.assertEqual(headers["X-Joinallworld-Proxy-Error"], "upstream-range-failure")
                    self.assertEqual(json.loads(body), {"error": "upstream-range-failure"})
                    diagnostic = proxy.first_error()
                    self.assertEqual(diagnostic["phase"], "read_upstream_body")
                    self.assertEqual(diagnostic["errorType"], "RuntimeError")
                    self.assertEqual(diagnostic["assetId"], "truncated-item")
                    self.assertEqual(diagnostic["upstreamStatus"], 206)
                    self.assertEqual(diagnostic["range"], "bytes=0-2")
                    self.assertGreater(diagnostic["networkBytesObserved"], 1)
                    self.assertEqual(budget.reservations, {})

                    status, _, body = self.request(proxy, 1)
                    self.assertEqual(status, 206)
                    self.assertEqual(body, b"abc")
                    self.assertEqual(state["requests"], 2)
                    self.assertEqual(budget.reservations, {})
                    self.assertLessEqual(budget.total, budget.maximum)
                finally:
                    proxy.close()
                    proxy_thread.join(timeout=2)
        finally:
            upstream.shutdown()
            upstream.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
