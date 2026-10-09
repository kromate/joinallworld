import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/world/check-production-continuity.py'
SPEC = importlib.util.spec_from_file_location('check_production_continuity', SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError('could not load the production continuity checker')
CHECKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKER)


class ProductionContinuityWitnessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.path = self.root / 'consolidated-synthetic-continuity-before.private.json'
        self.now = 1_800_000_000
        self.write_witness()
        self.root_patch = patch.object(CHECKER, 'ROOT', self.root)
        self.root_patch.start()
        self.clock_patch = patch.object(CHECKER.time, 'time', return_value=self.now)
        self.clock_patch.start()

    def tearDown(self):
        self.clock_patch.stop()
        self.root_patch.stop()
        self.temp.cleanup()

    def witness(self, *, action=None, stamp=None):
        before = {'spot': 'fixture-home'}
        if stamp is None:
            stamp = self.now * 1000 - 60_000
        return {
            'cookie': 'session=synthetic-cookie',
            'action': action or {
                'type': 'spot', 'cityId': 'lagos', 'payload': {'id': before['spot']},
                'actionId': f'{stamp}:synthetic-action',
            },
            'beforeState': before,
            'duplicateReceipt': {'duplicate': True, 'state': {'cash': 10, 'spot': 'fixture-home'}},
        }

    def write_witness(self, data=None):
        self.path.write_text(json.dumps(data if data is not None else self.witness()))
        self.path.chmod(0o600)

    def test_valid_original_same_spot_witness(self):
        data = CHECKER.private_witness()
        self.assertEqual(data['action']['type'], 'spot')
        self.assertEqual(data['action']['payload'], {'id': 'fixture-home'})
        self.assertTrue(data['duplicateReceipt']['duplicate'])
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)

    def test_refuses_group_or_other_readable_private_file(self):
        self.path.chmod(0o640)
        with self.assertRaisesRegex(ValueError, 'permissions'):
            CHECKER.private_witness()

    def test_refuses_symlink_and_hardlink_witnesses(self):
        link = self.root / 'consolidated-synthetic-continuity-before.private.json'
        target = self.root / 'private-target.json'
        self.path.rename(target)
        link.symlink_to(target)
        with self.assertRaisesRegex(ValueError, 'regular file'):
            CHECKER.private_witness()
        link.unlink()
        os.link(target, link)
        with self.assertRaisesRegex(ValueError, 'links'):
            CHECKER.private_witness()

    def test_refuses_wrong_intent_or_spot(self):
        base = self.witness()
        for action in (
            {**base['action'], 'type': 'move'},
            {**base['action'], 'cityId': 'ibadan'},
            {**base['action'], 'payload': {'id': 'different-spot'}},
        ):
            self.write_witness({**base, 'action': action})
            with self.subTest(action=action), self.assertRaises(ValueError):
                CHECKER.private_witness()

    def test_refuses_expired_or_future_original_action_ids(self):
        old_stamp = self.now * 1000 - (24 * 60 * 60 * 1000 - 90_000)
        future_stamp = self.now * 1000 + 1
        for stamp in (old_stamp, future_stamp):
            self.write_witness(self.witness(stamp=stamp))
            with self.subTest(stamp=stamp), self.assertRaisesRegex(ValueError, '24-hour'):
                CHECKER.private_witness()

    def test_stable_field_differences_are_reported_in_contract_order(self):
        wanted = {field: f'before-{field}' for field in CHECKER.FIELDS}
        self.assertEqual(CHECKER.differences(wanted, dict(wanted)), [])
        current = dict(wanted)
        current['spot'] = 'after-spot'
        del current['cash']
        self.assertEqual(CHECKER.differences(wanted, current), ['cash', 'spot'])


if __name__ == '__main__':
    unittest.main()
