"""Local fake-origin tests for RangeProxy's exact-range cache integration."""
import hashlib
import http.client
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import acquire
from range_cache import ExactRangeCache

RELEASE = "2026-09-23.1"
HOST = "overturemaps-us-west-2.s3.us-west-2.amazonaws.com"
URL = f"https://{HOST}/release/{RELEASE}/buildings/part-0.parquet"
BODY = b"0123456789abcdef"
ETAG = '"origin-v1"'


class FakeRangeOrigin:
    def __init__(self):
        self.state = {"requests": [], "etag": ETAG, "mode": "normal", "body": BODY, "pause": None}
        state = self.state

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, fmt, *args):
                return

            def _record(self, method):
                state["requests"].append((method, self.path, dict(self.headers.items())))

            def do_HEAD(self):
                self._record("HEAD")
                mode = state["mode"]
                if mode == "disconnect-head":
                    self.close_connection = True
                    return
                self.send_response(200)
                if mode != "missing-etag":
                    self.send_header("ETag", "W/" + state["etag"] if mode == "weak-etag" else state["etag"])
                self.send_header("Content-Length", str(len(state["body"]) + (1 if mode == "changed-length" else 0)))
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Encoding", "identity")
                self.end_headers()

            def do_GET(self):
                self._record("GET")
                if state["pause"] is not None:
                    state["pause"].wait(timeout=5)
                if self.headers.get("If-Match") not in (None, state["etag"]):
                    self.send_response(412)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                range_value = self.headers.get("Range")
                if not range_value or not range_value.startswith("bytes="):
                    self.send_error(416)
                    return
                first_raw, last_raw = range_value[6:].split("-", 1)
                first = int(first_raw)
                last = min(int(last_raw), len(state["body"]) - 1) if last_raw else len(state["body"]) - 1
                payload = state["body"][first:last + 1]
                mode = state["mode"]
                if mode == "short-content-range":
                    payload = payload[:-1]
                if mode == "oversized-content-range":
                    payload += b"x"
                if mode == "nonidentity":
                    self.send_response(206)
                    self.send_header("Content-Encoding", "gzip")
                else:
                    self.send_response(206)
                if mode != "missing-etag":
                    self.send_header("ETag", "W/" + state["etag"] if mode == "weak-etag" else state["etag"])
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(len(payload)))
                content_end = last + 1 if mode == "oversized-content-range" else last
                if mode == "bad-content-range":
                    self.send_header("Content-Range", f"bytes {first + 1}-{last}/{len(state['body'])}")
                else:
                    self.send_header("Content-Range", f"bytes {first}-{content_end}/{len(state['body'])}")
                self.end_headers()
                if payload:
                    self.wfile.write(payload)

        class QuietThreadingHTTPServer(ThreadingHTTPServer):
            def handle_error(self, request, client_address):
                # Deliberately aborted local test clients can reset keep-alive
                # sockets after malformed-body cases; that is not test output.
                return

        self.server = QuietThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def count(self, method):
        return sum(row[0] == method for row in self.state["requests"])


class RangeProxyCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.path.realpath(tempfile.gettempdir()))
        self.root = Path(self.temp.name).resolve()
        self.origin = FakeRangeOrigin()

    def tearDown(self):
        self.origin.close()
        self.temp.cleanup()

    def make_proxy(self, *, budget_limit=200_000, cache=True, url=URL, body=BODY, concurrency=2,
                   cache_limits=None):
        file_bytes = len(body)
        cache_obj = ExactRangeCache(self.root, self.root, RELEASE, minimum_free_bytes=0,
                                    **(cache_limits or {})) if cache else None
        asset = {"id": "fixture-building", "layer": "buildings", "url": url, "fileBytes": file_bytes}
        budget = acquire.NetworkBudget(budget_limit)
        proxy = acquire.RangeProxy([asset], budget, HOST, RELEASE, concurrency=concurrency, range_cache=cache_obj)
        return proxy, budget, cache_obj

    @staticmethod
    def request_head(proxy, first=2, last=7):
        client = http.client.HTTPConnection("127.0.0.1", proxy.httpd.server_port, timeout=5)
        try:
            client.request("HEAD", "/asset/0", headers={"Range": f"bytes={first}-{last}"})
            response = client.getresponse()
            return response.status, dict(response.getheaders())
        finally:
            client.close()

    @staticmethod
    def request(proxy, first=2, last=7):
        client = http.client.HTTPConnection("127.0.0.1", proxy.httpd.server_port, timeout=5)
        try:
            client.request("GET", "/asset/0", headers={"Range": f"bytes={first}-{last}"})
            response = client.getresponse()
            payload = response.read()
            return response.status, dict(response.getheaders()), payload
        finally:
            client.close()

    def patched_https(self):
        return patch.object(acquire.http.client, "HTTPSConnection",
                            side_effect=lambda host, port, timeout: http.client.HTTPConnection("127.0.0.1", self.origin.server.server_port, timeout=timeout))

    def test_cross_proxy_hit_revalidates_head_and_skips_repeated_get_body(self):
        first, first_budget, cache = self.make_proxy()
        first_thread = first.start()
        try:
            with self.patched_https():
                status, _, body = self.request(first)
            self.assertEqual((status, body), (206, BODY[2:8]))
            self.assertEqual(first_budget.reservations, {})
        finally:
            first.close(); first_thread.join(timeout=2)
        self.assertEqual(self.origin.count("GET"), 1)
        heads_before_second = self.origin.count("HEAD")

        second, second_budget, _ = self.make_proxy()
        second_thread = second.start()
        try:
            with self.patched_https():
                status, headers, body = self.request(second)
            self.assertEqual((status, body), (206, BODY[2:8]))
            self.assertEqual(second_budget.reservations, {})
            self.assertLessEqual(second_budget.total, second_budget.maximum)
            self.assertEqual(headers.get("Content-Range"), f"bytes 2-7/{len(BODY)}")
            diag = second.range_audit()
            self.assertIsInstance(diag, dict)
            self.assertEqual(diag["counters"]["cacheHits"], 1)
            self.assertEqual(diag["counters"]["savedBodyBytes"], len(BODY[2:8]))
            self.assertEqual(diag["counters"]["measuredUpstreamBytes"], second_budget.total)
            self.assertEqual(diag["ranges"][0]["result"], "hit")
            self.assertEqual(diag["ranges"][0]["bodySha256"], hashlib.sha256(BODY[2:8]).hexdigest())
        finally:
            second.close(); second_thread.join(timeout=2)
        self.assertEqual(self.origin.count("HEAD"), heads_before_second + 1, "each cross-proxy hit revalidates the origin once")
        self.assertEqual(self.origin.count("GET"), 1, "a verified cache hit makes no repeated range-body request")

    def test_changed_etag_is_freshly_selected_by_next_proxy_not_old_cache_entry(self):
        first, _, cache = self.make_proxy()
        first_thread = first.start()
        try:
            with self.patched_https():
                self.assertEqual(self.request(first)[0::2], (206, BODY[2:8]))
        finally:
            first.close(); first_thread.join(timeout=2)
        self.origin.state["etag"] = '"origin-v2"'
        second, budget, _ = self.make_proxy()
        second_thread = second.start()
        try:
            with self.patched_https():
                status, _, body = self.request(second)
            self.assertEqual((status, body), (206, BODY[2:8]))
            self.assertEqual(budget.reservations, {})
            self.assertEqual(self.origin.count("GET"), 2)
            row = second.range_audit()["ranges"][-1]
            self.assertEqual(row["result"], "miss")
            self.assertEqual(row["etag"], '"origin-v2"')
            self.assertEqual(cache.get(URL, len(BODY), '"origin-v2"', 2, 7), BODY[2:8])
        finally:
            second.close(); second_thread.join(timeout=2)

    def test_same_proxy_etag_change_fails_conditional_miss_closed(self):
        proxy, budget, _ = self.make_proxy()
        thread = proxy.start()
        try:
            with self.patched_https():
                status, _, payload = self.request(proxy, 2, 7)
                self.assertEqual((status, payload), (206, BODY[2:8]))
                self.origin.state["etag"] = '"origin-v2"'
                status, _, _ = self.request(proxy, 0, 5)
            self.assertEqual(status, 502)
            self.assertEqual(budget.reservations, {})
            self.assertIsNotNone(proxy.first_error())
        finally:
            proxy.close(); thread.join(timeout=2)

    def test_weak_or_missing_head_validators_do_not_enable_persistent_hits(self):
        for mode in ("weak-etag", "missing-etag"):
            with self.subTest(mode=mode):
                self.origin.state.update(requests=[], mode=mode, etag=ETAG)
                proxy, budget, cache = self.make_proxy()
                thread = proxy.start()
                try:
                    with self.patched_https():
                        head_status, _ = self.request_head(proxy)
                        self.assertEqual(head_status, 200)
                        status, _, body = self.request(proxy)
                    self.assertEqual(status, 206)
                    self.assertEqual(body, BODY[2:8])
                    self.assertEqual(budget.reservations, {})
                    self.assertEqual(cache.get(URL, len(BODY), ETAG, 2, 7), None)
                finally:
                    proxy.close(); thread.join(timeout=2)

    def test_head_disconnect_is_not_silently_hidden_by_fallback_get(self):
        self.origin.state["mode"] = "disconnect-head"
        proxy, budget, _ = self.make_proxy()
        thread = proxy.start()
        try:
            with self.patched_https():
                status, _, _ = self.request(proxy)
            self.assertEqual(status, 502)
            self.assertEqual(self.origin.count("HEAD"), 1)
            self.assertEqual(self.origin.count("GET"), 0)
            self.assertIsNotNone(proxy.first_error())
            self.assertEqual(budget.reservations, {})
        finally:
            proxy.close(); thread.join(timeout=2)

    def test_audit_and_network_reservations_settle_before_success_headers(self):
        proxy, budget, _ = self.make_proxy()
        server_thread = proxy.start()
        asset = proxy.assets[0]

        class ObservingClient:
            def __init__(self, expected_result, expected_count):
                self.headers = {"Range": "bytes=2-7"}
                self.expected_result = expected_result
                self.expected_count = expected_count
                self.status = None
                self.sent_headers = {}
                self.body = bytearray()
                self.close_connection = False
                self._world_proxy_response_started = False
                self.wfile = self.Writer(self)

            class Writer:
                def __init__(self, owner):
                    self.owner = owner

                def write(self, data):
                    self.owner.body.extend(data)

            def send_response(self, status, message=None):
                self.status = status

            def send_header(self, name, value):
                self.sent_headers[name] = value

            def end_headers(self):
                audit = proxy.range_audit()
                self.assert_ready(audit)

            def assert_ready(self, audit):
                self_outer.assertEqual(self.status, 206)
                self_outer.assertEqual(budget.reservations, {})
                self_outer.assertEqual(audit["counters"]["rangeRequests"], self.expected_count)
                self_outer.assertEqual(audit["ranges"][-1]["result"], self.expected_result)

        self_outer = self
        try:
            with self.patched_https():
                miss = ObservingClient("miss", 1)
                proxy._upstream(miss, URL, True, len(BODY), asset)
                self.assertEqual(bytes(miss.body), BODY[2:8])
                hit = ObservingClient("hit", 2)
                proxy._upstream(hit, URL, True, len(BODY), asset)
                self.assertEqual(bytes(hit.body), BODY[2:8])
        finally:
            proxy.close()
            server_thread.join(timeout=2)

    def test_malformed_range_responses_are_never_cached_and_release_budget(self):
        for mode in ("bad-content-range", "short-content-range", "oversized-content-range", "nonidentity"):
            with self.subTest(mode=mode):
                self.origin.state.update(requests=[], mode=mode, etag=ETAG)
                proxy, budget, cache = self.make_proxy()
                thread = proxy.start()
                try:
                    with self.patched_https():
                        status, _, _ = self.request(proxy)
                    self.assertEqual(status, 502)
                    self.assertEqual(budget.reservations, {})
                    self.assertIsNone(cache.get(URL, len(BODY), ETAG, 2, 7))
                finally:
                    proxy.close(); thread.join(timeout=2)

    def test_original_budget_still_charges_head_and_miss_headers_body_without_leaks(self):
        proxy, budget, _ = self.make_proxy(budget_limit=100_000, cache=True)
        thread = proxy.start()
        try:
            with self.patched_https():
                status, _, body = self.request(proxy)
            self.assertEqual((status, body), (206, BODY[2:8]))
            self.assertGreater(budget.total, len(body), "upstream status/headers are charged in addition to the range body")
            self.assertLessEqual(budget.total, budget.maximum)
            self.assertEqual(budget.reservations, {})
            counters = proxy.range_audit()["counters"]
            self.assertEqual(counters["measuredUpstreamBytes"], budget.total)
            self.assertEqual(counters["cacheMisses"], 1)
        finally:
            proxy.close(); thread.join(timeout=2)

    def test_cache_disabled_serves_identical_bytes_under_original_budget(self):
        proxy, budget, cache = self.make_proxy(cache=False)
        thread = proxy.start()
        try:
            with self.patched_https():
                status, _, payload = self.request(proxy)
            self.assertEqual((status, payload), (206, BODY[2:8]))
            self.assertIsNone(cache)
            self.assertEqual(budget.reservations, {})
            self.assertGreaterEqual(budget.total, len(payload))
        finally:
            proxy.close(); thread.join(timeout=2)

    def test_standalone_head_bytes_are_counted_once_when_followed_by_range_get(self):
        proxy, budget, _ = self.make_proxy()
        thread = proxy.start()
        try:
            with self.patched_https():
                head_status, _ = self.request_head(proxy)
                self.assertEqual(head_status, 200)
                status, _, body = self.request(proxy)
            self.assertEqual((status, body), (206, BODY[2:8]))
            audit = proxy.range_audit()
            self.assertEqual(audit["counters"]["measuredUpstreamBytes"], budget.total)
            self.assertEqual(audit["counters"]["cacheMisses"], 1)
            # The cached HEAD was charged in the aggregate once; the range row
            # accounts for only the GET because that same-proxy HEAD was reused.
            self.assertLess(audit["ranges"][0]["measuredUpstreamBytes"], budget.total)
            self.assertEqual(budget.reservations, {})
        finally:
            proxy.close(); thread.join(timeout=2)

    def test_corrupt_cached_span_fails_closed_and_records_proxy_error(self):
        proxy, budget, cache = self.make_proxy()
        self.assertTrue(cache.put(URL, len(BODY), ETAG, 2, 7, BODY[2:8]))
        entry = next(cache.cache_root.iterdir())
        (entry / "body.bin").write_bytes(b"broken")
        thread = proxy.start()
        try:
            with self.patched_https():
                status, _, _ = self.request(proxy)
            self.assertEqual(status, 502)
            self.assertIsNotNone(proxy.first_error())
            self.assertEqual(budget.reservations, {})
        finally:
            proxy.close(); thread.join(timeout=2)

    def test_span_over_cache_entry_limit_uses_original_network_path_without_persisting(self):
        proxy, budget, cache = self.make_proxy(cache_limits={"max_entry_bytes": 5, "max_growth_bytes": 1_000})
        thread = proxy.start()
        try:
            with self.patched_https():
                status, _, payload = self.request(proxy, 2, 7)
            self.assertEqual((status, payload), (206, BODY[2:8]))
            self.assertEqual(cache.written, 0)
            self.assertEqual(self.origin.count("GET"), 1)
            self.assertEqual(budget.reservations, {})
            self.assertEqual(proxy.range_audit()["ranges"][0]["result"], "uncacheable")
        finally:
            proxy.close(); thread.join(timeout=2)

    def test_changed_head_file_length_bypasses_old_cached_span_and_fails_exact_total_check(self):
        first, _, _ = self.make_proxy()
        first_thread = first.start()
        try:
            with self.patched_https():
                self.assertEqual(self.request(first)[0], 206)
        finally:
            first.close(); first_thread.join(timeout=2)
        self.origin.state["body"] = BODY + b"x"
        second, budget, _ = self.make_proxy()
        second_thread = second.start()
        try:
            with self.patched_https():
                status, _, _ = self.request(second)
            self.assertEqual(status, 502)
            self.assertEqual(self.origin.count("GET"), 2)
            self.assertEqual(budget.reservations, {})
            self.assertEqual(second.range_audit()["counters"]["cacheHits"], 0)
        finally:
            second.close(); second_thread.join(timeout=2)

    def test_concurrent_identical_misses_share_one_head_and_one_body_fetch(self):
        proxy, budget, _ = self.make_proxy()
        gate = threading.Event()
        self.origin.state["pause"] = gate
        thread = proxy.start()
        results = []
        errors = []

        def fetch():
            try:
                with self.patched_https():
                    results.append(self.request(proxy))
            except Exception as error:
                errors.append(error)

        clients = [threading.Thread(target=fetch) for _ in range(2)]
        try:
            for client in clients:
                client.start()
            deadline = threading.Event()
            # Wait until the single expected origin GET has entered its gate.
            for _ in range(100):
                if self.origin.count("GET"):
                    break
                deadline.wait(0.01)
            self.assertEqual(self.origin.count("GET"), 1)
            gate.set()
            for client in clients:
                client.join(timeout=4)
            self.assertTrue(all(not client.is_alive() for client in clients))
            self.assertFalse(errors)
            self.assertEqual([(status, body) for status, _, body in results], [(206, BODY[2:8])] * 2)
            self.assertEqual(self.origin.count("HEAD"), 1)
            self.assertEqual(self.origin.count("GET"), 1)
            self.assertEqual(budget.reservations, {})
        finally:
            gate.set()
            proxy.close(); thread.join(timeout=2)

    def test_range_audit_is_bounded_and_counters_keep_total_requests(self):
        body = bytes(range(128))
        self.origin.state["body"] = body
        proxy, _, _ = self.make_proxy(body=body)
        thread = proxy.start()
        try:
            with self.patched_https():
                for offset in range(70):
                    status, _, payload = self.request(proxy, offset, offset)
                    self.assertEqual((status, payload), (206, body[offset:offset + 1]))
            audit = proxy.range_audit()
            self.assertEqual(audit["counters"]["rangeRequests"], 70)
            self.assertLessEqual(len(audit["ranges"]), 64)
            self.assertTrue(audit["truncated"])
            self.assertLessEqual(len(json.dumps(audit, separators=(",", ":")).encode()), 64_000)
        finally:
            proxy.close(); thread.join(timeout=2)

    def test_run_reserves_growth_from_duckdb_temp_and_reuses_identical_output(self):
        settings = []
        queried = []
        origin = self.origin

        class FakeDuckDBConnection:
            def execute(self, query):
                if query.startswith("SET max_temp_directory_size="):
                    settings.append(int(query.split("=", 1)[1].strip("'").rstrip("B")))
                if query.startswith("SELECT "):
                    match = re.search(r"'(http://127\.0\.0\.1:\d+/asset/\d+)'", query)
                    if match is None:
                        raise AssertionError("SQL did not contain the local proxy URL")
                    parsed = acquire.urlsplit(match.group(1))
                    client = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=5)
                    try:
                        client.request("GET", parsed.path, headers={"Range": "bytes=2-7"})
                        response = client.getresponse()
                        payload = response.read()
                        queried.append((response.status, payload))
                        if response.status >= 400:
                            raise RuntimeError("proxy failed bounded range request")
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

        with tempfile.TemporaryDirectory(dir=os.path.realpath(tempfile.gettempdir())) as temp:
            root = Path(temp).resolve()
            asset = {"id": "fixture-building", "layer": "buildings", "url": URL, "fileBytes": len(BODY)}
            request = {"schemaVersion": 1, "id": "range-cache-run", "inventoryUnitId": "unit:fixture",
                       "region": {"id": "fixture", "parentId": None, "name": "Fixture", "kind": "city",
                                  "countryCode": "FJ", "timezone": "Pacific/Fiji",
                                  "bounds": [178.0, -17.0, 179.0, -16.0]},
                       "provider": "overture", "release": RELEASE, "layers": ["buildings"],
                       "limits": {"networkBytes": 100_000, "outputBytes": 1_000_000,
                                  "features": 100, "durationMs": 60_000, "memoryMb": 512,
                                  "diskBytes": 100_000_000}}
            source_config = json.loads(Path(acquire.__file__).resolve().parents[1].joinpath("acquisition-sources.json").read_text())
            def adapter_input(staging_name):
                return {"request": request, "sourceConfig": source_config,
                        "cacheDir": str(root / "acquisitions" / staging_name),
                        "allowedRoot": str(root), "sourceIndexDir": str(root / "acquisition-index")}

            with patch.dict(sys.modules, {"duckdb": FakeDuckDB}), \
                    patch.object(acquire, "apply_limits"), \
                    patch.object(acquire, "select_item_index",
                                 return_value=({"buildings": [asset]}, [],
                                               {"sha256": "a" * 64, "itemCount": 1, "selectedCount": 1})), \
                    patch.object(acquire.http.client, "HTTPSConnection",
                                 side_effect=lambda host, port, timeout: http.client.HTTPConnection(
                                     "127.0.0.1", origin.server.server_port, timeout=timeout)):
                first = acquire.run(adapter_input("stage-one"))
                first_output = Path(first["path"]).read_bytes()
                first_receipt = Path(first["receiptPath"]).read_bytes()
                first_audit = json.loads((root / "acquisitions" / "stage-one" / "range-audit.json").read_bytes())
                second = acquire.run(adapter_input("stage-two"))
                second_output = Path(second["path"]).read_bytes()
                second_receipt = Path(second["receiptPath"]).read_bytes()
                second_audit = json.loads((root / "acquisitions" / "stage-two" / "range-audit.json").read_bytes())

            self.assertEqual(first_output, second_output)
            self.assertEqual(first_receipt, second_receipt)
            self.assertEqual(queried, [(206, BODY[2:8]), (206, BODY[2:8])])
            self.assertEqual(self.origin.count("GET"), 1)
            self.assertEqual(self.origin.count("HEAD"), 2)
            self.assertEqual(first_audit["counters"]["cacheMisses"], 1)
            self.assertEqual(second_audit["counters"]["cacheHits"], 1)
            self.assertGreater(first_audit["counters"]["measuredUpstreamBytes"], 0)
            # Both runs reserved growth before allocating DuckDB temp space; the
            # second run's index usage includes only the actual first-run growth.
            output_reserve = int(request["limits"]["outputBytes"]) * 2 + 1_000_000
            self.assertEqual(len(settings), 2)
            self.assertLessEqual(settings[0], request["limits"]["diskBytes"] - output_reserve - 8_000_000)
            self.assertLess(settings[1], settings[0])


if __name__ == "__main__":
    unittest.main()
