import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace

_spec = importlib.util.spec_from_file_location("run_africa_starters_test", Path(__file__).with_name("run_africa_starters.py"))
runner = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(runner)


class FixtureCampaign:
    def __init__(self, root, *, fail_acquire=False, cache_on_failure=True, partial_output=False):
        self.root = root
        self.cache = {"aa": False, "bb": False}
        self.calls = []
        self.fail_acquire = fail_acquire
        self.cache_on_failure = cache_on_failure
        self.partial_output = partial_output

    def __call__(self, command, *, cwd, timeout, env=None):
        self.assert_timeout(timeout)
        values = [str(item) for item in command]
        if any(value.endswith(runner.BUILDER) for value in values):
            countries = [values[index + 1] for index, value in enumerate(values) if value == "--country"]
            mode = next((value for value in ("--plan", "--acquire", "--check") if value in values), "generate")
            if mode == "--plan":
                self.calls.append(("plan", tuple(countries)))
                rows = []
                for country in countries:
                    city = "alpha" if country == "AA" else "beta"
                    cached = self.cache[country.lower()]
                    rows.append({"country": country, "city": city, "settlement": city.title(), "settlementRole": "city",
                                 "timezone": "Etc/UTC", "stateId": f"{country.lower()}-zone", "stateName": "Starter",
                                 "airportDatasetName": "Airport dataset point", "airportDatasetPoint": [1, 2],
                                 "airportEvidence": {"source": "fixture"}, "catalogueBytes": 100, "catalogueLimit": 150,
                                 "cachedSample": cached, "wouldRequest": not cached,
                                 "status": "ready"})
                return SimpleNamespace(returncode=0, stdout=("\n".join(json.dumps(row) for row in rows) + "\n").encode(), stderr=b"")
            country = countries[0]
            city = "alpha" if country == "AA" else "beta"
            if mode == "--acquire":
                self.calls.append(("acquire", city))
                if self.cache_on_failure:
                    self.cache[country.lower()] = True
                if self.partial_output:
                    (self.root / "src/game/cities" / city).mkdir(parents=True, exist_ok=True)
                if self.fail_acquire:
                    raise runner.RunnerError("fixture acquisition interrupted")
                self.cache[country.lower()] = True
                (self.root / "src/game/cities" / city).mkdir(parents=True, exist_ok=True)
                (self.root / "world/playable-africa-rollout/receipts" / f"{city}.json").write_text("{}\n", encoding="utf-8")
                return SimpleNamespace(returncode=0, stdout=json.dumps({"status": "generated", "country": country, "city": city}).encode() + b"\n", stderr=b"")
            if mode == "--check":
                self.calls.append(("check", city))
                return SimpleNamespace(returncode=0, stdout=json.dumps({"status": "pinned-assets-match", "city": city}).encode() + b"\n", stderr=b"")
            self.calls.append(("generate-offline", city))
            (self.root / "src/game/cities" / city).mkdir(parents=True, exist_ok=True)
            (self.root / "world/playable-africa-rollout/receipts" / f"{city}.json").write_text("{}\n", encoding="utf-8")
            return SimpleNamespace(returncode=0, stdout=json.dumps({"status": "generated", "country": country, "city": city}).encode() + b"\n", stderr=b"")
        city = Path(values[-1]).name
        self.calls.append(("verify", city))
        return SimpleNamespace(returncode=0, stdout=json.dumps({"status": "verified", "city": city}).encode() + b"\n", stderr=b"")

    @staticmethod
    def assert_timeout(timeout):
        if timeout <= 0 or timeout > runner.MAX_SECONDS:
            raise AssertionError(f"invalid command timeout {timeout}")


class RunAfricaStartersTests(unittest.TestCase):
    def test_mixed_batch_passes_selection_only_to_south_sudan_operations(self):
        selection = ("selection.json", "a" * 64)
        for mode in ("--acquire", "--check", None):
            for country in ("ST", "CV", "SS"):
                command = runner.builder_command(sys.executable, Path("/fixture"), country, mode, selection)
                self.assertEqual("--juba-selection" in command, country == "SS")
                self.assertEqual("--juba-selection-sha256" in command, country == "SS")
                if country == "SS":
                    self.assertEqual(command[-4:], ["--juba-selection", selection[0], "--juba-selection-sha256", selection[1]])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for relative in (runner.BUILDER, runner.CONVERTER, runner.VERIFIER, runner.INVENTORY, runner.SLOT,
                         runner.RUNNER, runner.OPTIONAL_PUBLICATION_HELPER):
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"fixture pin: {relative}\n", encoding="utf-8")
        (self.root / "src/game/cities").mkdir(parents=True, exist_ok=True)
        (self.root / "world/playable-africa-rollout/receipts").mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        self.temp.cleanup()

    def config(self, **overrides):
        result = {"countries": ["AA", "BB"], "resume": None, "python": sys.executable, "node": sys.executable,
                  "seconds": 60, "maxCountries": 5, "maxReservedBytes": 16 * 1024 * 1024,
                  "jubaSelection": None, "checkGit": False}
        result.update(overrides)
        return result

    def frozen_contract(self):
        contracts = list((self.root / runner.RUNS).glob("*/contract.json"))
        self.assertEqual(len(contracts), 1)
        return contracts[0].resolve()

    def write_publication_intent(self, city, country):
        parent = self.root / ".cache/world-build/africa-starter-publication"
        stage = parent / city
        stage.mkdir(parents=True, mode=0o700)
        parent.chmod(0o700)
        stage.chmod(0o700)
        intent = stage / "intent.json"
        intent.write_text(json.dumps({"schemaVersion": 1, "identity": {"countryIso2": country, "cityId": city}}), encoding="utf-8")
        intent.chmod(0o600)
        return intent

    def test_runs_each_city_acquire_check_and_engine_verify_before_next(self):
        fixture = FixtureCampaign(self.root)
        result = runner.execute_campaign(self.root, self.config(), execute=fixture)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(fixture.calls, [
            ("plan", ("AA", "BB")),
            ("acquire", "alpha"), ("check", "alpha"), ("verify", "alpha"),
            ("acquire", "beta"), ("check", "beta"), ("verify", "beta"),
        ])
        contract = json.loads(self.frozen_contract().read_text())
        self.assertEqual(set(contract["sourcePins"]), {runner.BUILDER, runner.CONVERTER, runner.VERIFIER,
                                                        runner.INVENTORY, runner.SLOT, runner.RUNNER,
                                                        runner.OPTIONAL_PUBLICATION_HELPER})
        self.assertEqual(contract["budgets"]["reservedPotentialBytes"], 2 * runner.DOWNLOAD_RESERVATION)

    def test_resume_replays_cached_request_without_issuing_it_again(self):
        first = FixtureCampaign(self.root, fail_acquire=True, cache_on_failure=True)
        with self.assertRaisesRegex(runner.RunnerError, "interrupted"):
            runner.execute_campaign(self.root, self.config(countries=["AA"]), execute=first)
        contract_path = self.frozen_contract()
        second = FixtureCampaign(self.root)
        second.cache["aa"] = True
        resumed = runner.execute_campaign(self.root, self.config(countries=None, resume=str(contract_path), maxReservedBytes=None), execute=second)
        self.assertEqual(resumed["status"], "complete")
        self.assertEqual([call[0] for call in first.calls].count("acquire"), 1)
        self.assertNotIn("acquire", [call[0] for call in second.calls])
        self.assertIn(("generate-offline", "alpha"), second.calls)

    def test_resume_refuses_spent_missing_cache_without_retry(self):
        first = FixtureCampaign(self.root, fail_acquire=True, cache_on_failure=False)
        with self.assertRaisesRegex(runner.RunnerError, "interrupted"):
            runner.execute_campaign(self.root, self.config(countries=["AA"]), execute=first)
        contract_path = self.frozen_contract()
        with self.assertRaisesRegex(runner.RunnerError, "use --resume"):
            runner.execute_campaign(self.root, self.config(countries=["AA"]), execute=FixtureCampaign(self.root))
        self.assertEqual([call[0] for call in first.calls].count("acquire"), 1)
        second = FixtureCampaign(self.root)
        with self.assertRaisesRegex(runner.RunnerError, "prior acquisition may have spent its request"):
            runner.execute_campaign(self.root, self.config(countries=None, resume=str(contract_path), maxReservedBytes=None), execute=second)
        self.assertEqual([call[0] for call in first.calls].count("acquire"), 1)
        self.assertNotIn("acquire", [call[0] for call in second.calls])

    def test_resume_rejects_changed_verifier_pin_before_replaying(self):
        fixture = FixtureCampaign(self.root)
        runner.execute_campaign(self.root, self.config(countries=["AA"]), execute=fixture)
        contract_path = self.frozen_contract()
        verifier = self.root / runner.VERIFIER
        verifier.write_text("changed engine contract\n", encoding="utf-8")
        resume = FixtureCampaign(self.root)
        with self.assertRaisesRegex(runner.RunnerError, "source differs from frozen contract"):
            runner.execute_campaign(self.root, self.config(countries=None, resume=str(contract_path), maxReservedBytes=None), execute=resume)
        self.assertEqual(resume.calls, [])

    def test_unreceipted_interrupted_output_is_preserved_and_refused(self):
        first = FixtureCampaign(self.root, fail_acquire=True, cache_on_failure=True, partial_output=True)
        with self.assertRaisesRegex(runner.RunnerError, "interrupted"):
            runner.execute_campaign(self.root, self.config(countries=["AA"]), execute=first)
        output = self.root / "src/game/cities/alpha"
        self.assertTrue(output.is_dir())
        contract_path = self.frozen_contract()
        second = FixtureCampaign(self.root)
        with self.assertRaisesRegex(runner.RunnerError, "partial publication lacks a matching owned intent"):
            runner.execute_campaign(self.root, self.config(countries=None, resume=str(contract_path), maxReservedBytes=None), execute=second)
        report_path = contract_path.parent / "report.json"
        report = json.loads(report_path.read_text())
        self.assertEqual(report["cities"]["alpha"]["status"], "partial-output-refused")
        self.assertTrue(output.is_dir())

    def test_matching_private_intent_recovers_offline_without_reacquisition(self):
        first = FixtureCampaign(self.root, fail_acquire=True, cache_on_failure=True, partial_output=True)
        with self.assertRaisesRegex(runner.RunnerError, "interrupted"):
            runner.execute_campaign(self.root, self.config(countries=["AA"]), execute=first)
        contract_path = self.frozen_contract()
        self.write_publication_intent("alpha", "AA")
        second = FixtureCampaign(self.root)
        second.cache["aa"] = True
        result = runner.execute_campaign(self.root, self.config(countries=None, resume=str(contract_path), maxReservedBytes=None), execute=second)
        self.assertEqual(result["status"], "complete")
        self.assertNotIn("acquire", [call[0] for call in second.calls])
        self.assertIn(("generate-offline", "alpha"), second.calls)
        report = json.loads((contract_path.parent / "report.json").read_text())
        self.assertTrue(report["cities"]["alpha"]["publicationRecoveryRequested"])

    def test_mismatched_private_intent_does_not_authorize_partial_output(self):
        first = FixtureCampaign(self.root, fail_acquire=True, cache_on_failure=True, partial_output=True)
        with self.assertRaisesRegex(runner.RunnerError, "interrupted"):
            runner.execute_campaign(self.root, self.config(countries=["AA"]), execute=first)
        contract_path = self.frozen_contract()
        self.write_publication_intent("alpha", "BB")
        second = FixtureCampaign(self.root)
        second.cache["aa"] = True
        with self.assertRaisesRegex(runner.RunnerError, "partial publication lacks a matching owned intent"):
            runner.execute_campaign(self.root, self.config(countries=None, resume=str(contract_path), maxReservedBytes=None), execute=second)
        self.assertNotIn("acquire", [call[0] for call in second.calls])

    def test_child_timeout_is_bounded_and_reaped(self):
        pid_file = self.root / "child.pid"
        source = "import os,pathlib,time; pathlib.Path(os.environ['PID_FILE']).write_text(str(os.getpid())); time.sleep(20)"
        env = {**os.environ, "PID_FILE": str(pid_file)}
        started = time.monotonic()
        with self.assertRaisesRegex(runner.RunnerError, "timed out"):
            runner.run_command([sys.executable, "-c", source], cwd=self.root, timeout=0.15, env=env)
        self.assertLess(time.monotonic() - started, 3)
        pid = int(pid_file.read_text())
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_supervisor_timeout_kills_grandchild_after_group_leader_exits(self):
        heartbeat = self.root / "grandchild.heartbeat"
        pid_file = self.root / "grandchild.pid"
        child = (
            "import os,pathlib,signal,time; "
            "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
            "p=pathlib.Path(os.environ['HEARTBEAT']); "
            "pathlib.Path(os.environ['GRANDCHILD_PID']).write_text(str(os.getpid())); "
            "exec('while True:\\n p.open(\\\"a\\\").write(\\\"x\\\"); time.sleep(.02)')"
        )
        leader = (
            "import subprocess,sys,time; "
            f"subprocess.Popen([sys.executable, '-c', {child!r}]); time.sleep(20)"
        )
        env = {**os.environ, "HEARTBEAT": str(heartbeat), "GRANDCHILD_PID": str(pid_file)}
        process = subprocess.Popen([sys.executable, "-c", leader], cwd=self.root, env=env,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, start_new_session=True)
        deadline = time.monotonic() + 2
        while not pid_file.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(pid_file.exists(), "grandchild did not start")
        with self.assertRaisesRegex(runner.RunnerError, "exceeded its frozen walltime"):
            runner.wait_owned_process_group(process, 0.2)
        self.assertIsNotNone(process.poll(), "group leader was not reaped")
        before = heartbeat.stat().st_size
        time.sleep(0.12)
        self.assertEqual(heartbeat.stat().st_size, before, "grandchild survived process-group cleanup")

    def test_run_directory_rejects_symlink_parent(self):
        real = self.root / "real-cache"
        real.mkdir()
        (self.root / ".cache").symlink_to(real, target_is_directory=True)
        target = self.root.resolve() / runner.RUNS / ("a" * 64)
        with self.assertRaisesRegex(runner.RunnerError, "symlink"):
            runner.ensure_run_directory(self.root, target, create=True)

    def test_git_snapshot_freezes_commit_and_rejects_unrelated_dirty_source(self):
        repo = self.root / "git-fixture"
        repo.mkdir()
        subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
        subprocess.run(["git", "config", "user.email", "fixture@example.test"], cwd=repo, check=True)
        subprocess.run(["git", "config", "user.name", "Fixture"], cwd=repo, check=True)
        source = repo / "src/game/life.ts"
        source.parent.mkdir(parents=True)
        source.write_text("pinned\n", encoding="utf-8")
        subprocess.run(["git", "add", "src/game/life.ts"], cwd=repo, check=True)
        subprocess.run(["git", "commit", "-qm", "fixture"], cwd=repo, check=True)
        head = runner.git_snapshot(repo, ["alpha"])
        generated = repo / "src/game/cities/alpha/index.ts"
        generated.parent.mkdir(parents=True)
        generated.write_text("owned output\n", encoding="utf-8")
        self.assertEqual(runner.git_snapshot(repo, ["alpha"], expected_head=head), head)
        (repo / "world").mkdir()
        (repo / "world/draft.md").write_text("allowed unrelated draft\n", encoding="utf-8")
        (repo / "deploy/tooling").mkdir(parents=True)
        target = self.root / "node-modules-fixture"
        target.mkdir()
        (repo / "deploy/tooling/node_modules").symlink_to(target, target_is_directory=True)
        self.assertEqual(runner.git_snapshot(repo, ["alpha"], expected_head=head), head)
        executable = repo / "world/tooling/untracked-runner"
        executable.parent.mkdir(parents=True)
        executable.write_text("#!/bin/sh\n", encoding="utf-8")
        executable.chmod(0o700)
        with self.assertRaisesRegex(runner.RunnerError, "untracked importable or executable source"):
            runner.git_snapshot(repo, ["alpha"], expected_head=head)
        executable.unlink()
        module = repo / "world/tooling/untracked_module.py"
        module.write_text("raise RuntimeError('untracked')\n", encoding="utf-8")
        with self.assertRaisesRegex(runner.RunnerError, "untracked importable or executable source"):
            runner.git_snapshot(repo, ["alpha"], expected_head=head)
        module.unlink()
        for relative in ("src/game/untracked.ts", "scripts/world/untracked.py"):
            candidate = repo / relative
            candidate.parent.mkdir(parents=True, exist_ok=True)
            candidate.write_text("# untracked source\n", encoding="utf-8")
            with self.assertRaisesRegex(runner.RunnerError, "untracked importable or executable source"):
                runner.git_snapshot(repo, ["alpha"], expected_head=head)
            candidate.unlink()
        source.write_text("changed source\n", encoding="utf-8")
        with self.assertRaisesRegex(runner.RunnerError, "dirty tracked non-output source"):
            runner.git_snapshot(repo, ["alpha"], expected_head=head)

    def test_publication_helper_is_required_and_frozen(self):
        self.assertIn(runner.OPTIONAL_PUBLICATION_HELPER, runner.source_pins(self.root))
        helper = self.root / runner.OPTIONAL_PUBLICATION_HELPER
        helper.unlink()
        with self.assertRaisesRegex(runner.RunnerError, "missing frozen runner input"):
            runner.source_pins(self.root)


if __name__ == "__main__":
    unittest.main()
