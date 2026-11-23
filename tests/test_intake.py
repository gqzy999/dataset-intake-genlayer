import copy
import json
from pathlib import Path
import unittest

from host import contract

OWNER = "0x" + "1" * 40
RECIPIENT = "0x" + "2" * 40
KEY = OWNER + "/fixture"
FIXTURE = json.loads(Path("public/example.json").read_text())


class IntakeTest(unittest.TestCase):
    def setUp(self):
        self.app, self.message, self.responses, _ = contract(
            "contracts/intake.py", "DatasetIntake", OWNER)
        self.official = dict(id=FIXTURE["id"], doi=FIXTURE["doi"],
                             files=[dict(key=row["name"], size=row["size"], checksum=row["checksum"])
                                    for row in FIXTURE["files"]])

    def lodge(self, rows):
        self.app.lodge("fixture", FIXTURE["id"], RECIPIENT, json.dumps(rows))

    def verify(self):
        self.responses.extend([(None, self.official)] * 2)
        self.app.reconcile(KEY)

    def read(self):
        return json.loads(self.app.get_case(KEY))

    def test_only_recipient_can_receive_once(self):
        self.lodge(FIXTURE["files"])
        self.verify()
        with self.assertRaisesRegex(ValueError, "RECIPIENT_REQUIRED"):
            self.app.receive(KEY)
        self.assertEqual(self.read()["state"], "CLEARED")
        self.message.sender_address = RECIPIENT
        self.app.receive(KEY)
        self.assertEqual(self.read()["received_by"], RECIPIENT)
        with self.assertRaisesRegex(ValueError, "NOT_CLEARED"):
            self.app.receive(KEY)

    def test_missing_and_changed_files_are_reported_and_blocked(self):
        expected = copy.deepcopy(FIXTURE["files"][:-1])
        expected[0]["size"] += 1
        self.lodge(expected)
        self.verify()
        self.assertEqual(self.read()["state"], "BLOCKED")
        self.assertEqual(self.read()["differences"]["missing"], [FIXTURE["files"][-1]["name"]])
        self.assertEqual(self.read()["differences"]["changed"], [expected[0]["name"]])
        self.message.sender_address = RECIPIENT
        with self.assertRaisesRegex(ValueError, "NOT_CLEARED"):
            self.app.receive(KEY)

    def test_disagreement_leaves_delivery_retryable(self):
        self.lodge(FIXTURE["files"])
        altered = copy.deepcopy(self.official)
        altered["files"][0]["size"] += 1
        self.responses.extend([(None, self.official), (None, altered)])
        with self.assertRaisesRegex(ValueError, "VALIDATORS_DISAGREE"):
            self.app.reconcile(KEY)
        self.assertEqual(self.read()["state"], "LODGED")

    def test_mismatched_version_leaves_delivery_retryable(self):
        self.lodge(FIXTURE["files"])
        self.official["id"] += 1
        with self.assertRaisesRegex(ValueError, "WRONG_VERSION"):
            self.verify()
        self.assertEqual(self.read()["state"], "LODGED")

    def test_replay_cannot_overwrite_manifest(self):
        self.lodge(FIXTURE["files"])
        with self.assertRaisesRegex(ValueError, "EXISTS"):
            self.lodge(FIXTURE["files"][:-1])
        self.assertEqual(len(self.read()["expected"]), len(FIXTURE["files"]))
