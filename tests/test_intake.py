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

    def test_dryad_matches_only_the_pinned_complete_manifest(self):
        rows = FIXTURE["files"]
        version_path = f'/api/v2/versions/{FIXTURE["id"]}'
        self.app.lodge_dryad("fixture", FIXTURE["id"], RECIPIENT, json.dumps(rows))
        official = {
            "count": len(rows), "total": len(rows),
            "_embedded": {"stash:files": [
                {"path": row["name"], "size": row["size"], "digestType": "md5",
                 "digest": row["checksum"][4:], "_links": {
                    "stash:version": {"href": version_path},
                    "stash:dataset": {"href": "/api/v2/datasets/doi%3A10.5061%2Fdryad.example"},
                 }} for row in rows
            ]},
        }
        url = f'https://datadryad.org{version_path}/files'
        self.responses.extend([(url, official)] * 2)
        self.app.reconcile(KEY)
        record = self.read()
        self.assertEqual(record["archive"], "dryad")
        self.assertEqual(record["record_id"], FIXTURE["id"])
        self.assertEqual(record["evidence"]["doi"], "10.5061/dryad.example")
        self.assertEqual(record["state"], "CLEARED")

    def test_unavailable_archive_preserves_pending_manifest(self):
        self.lodge(FIXTURE["files"])
        self.responses.extend([(None, (403, {}))] * 2)
        with self.assertRaisesRegex(ValueError, "ARCHIVE_UNAVAILABLE"):
            self.app.reconcile(KEY)
        self.assertEqual(self.read()["state"], "LODGED")

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
