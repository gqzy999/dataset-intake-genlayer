# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
import json
from genlayer import *

BASE = "https://zenodo.org/api/records/"


def require(ok, code):
    if not ok:
        raise gl.vm.UserError(code)


def manifest(rows):
    require(isinstance(rows, list) and 0 < len(rows) <= 32, "MANIFEST_SIZE")
    result = {}
    for row in rows:
        name, size, digest = row["name"], row["size"], row["checksum"]
        require(isinstance(name, str) and 0 < len(name) <= 160 and name not in result, "FILE_NAME")
        require(type(size) is int and 0 <= size <= 10**14, "FILE_SIZE")
        require(isinstance(digest, str) and digest.startswith("md5:") and len(digest) == 36
                and all(c in "0123456789abcdef" for c in digest[4:]), "FILE_CHECKSUM")
        result[name] = {"name": name, "size": size, "checksum": digest}
    return result


def differences(expected, official):
    return {
        "missing": sorted(official.keys() - expected.keys()),
        "extra": sorted(expected.keys() - official.keys()),
        "changed": sorted(key for key in expected.keys() & official.keys() if expected[key] != official[key]),
    }


class DatasetIntake(gl.Contract):
    cases: TreeMap[str, str]

    def __init__(self):
        self.cases = TreeMap[str, str]()

    @gl.public.write
    def lodge(self, slug: str, record_id: u32, recipient: Address, files: str) -> None:
        owner = str(gl.message.sender_address).lower()
        receiver = str(recipient).lower()
        require(owner != receiver and receiver != "0x" + "0"*40, "DISTINCT_RECIPIENT")
        require(3 <= len(slug) <= 36 and all(c in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in slug), "INVALID_SLUG")
        require(record_id > 0 and len(files) <= 12000, "INPUT_LIMIT")
        key = owner + "/" + slug
        require(key not in self.cases, "EXISTS")
        self.cases[key] = json.dumps({"owner":owner,"recipient":receiver,"record_id":int(record_id),
                                      "expected":manifest(json.loads(files)), "state":"LODGED"})

    @gl.public.write
    def reconcile(self, key: str) -> None:
        case = json.loads(self.cases.get(key, "null"))
        require(case is not None and case["state"] == "LODGED", "NOT_LODGED")
        record_id = case["record_id"]

        def observe():
            response = gl.nondet.web.get(BASE + str(record_id))
            require(response.status == 200, "ZENODO_UNAVAILABLE")
            data = json.loads(response.body)
            doi = "10.5281/zenodo." + str(record_id)
            require(data["id"] == record_id and data["doi"].lower() == doi, "WRONG_VERSION")
            files = manifest([{"name":item["key"], "size":item["size"], "checksum":item["checksum"]}
                              for item in data["files"]])
            return json.dumps({"doi":doi,"files":files}, sort_keys=True)

        def verify(leader):
            return isinstance(leader, gl.vm.Return) and leader.calldata == observe()

        evidence = json.loads(gl.vm.run_nondet_unsafe(observe, verify))
        diff = differences(case["expected"], evidence["files"])
        case.update(evidence=evidence, differences=diff, verifier=str(gl.message.sender_address).lower(),
                    state="BLOCKED" if any(diff.values()) else "CLEARED")
        self.cases[key] = json.dumps(case)

    @gl.public.write
    def receive(self, key: str) -> None:
        case = json.loads(self.cases.get(key, "null"))
        require(case is not None and case["state"] == "CLEARED", "NOT_CLEARED")
        actor = str(gl.message.sender_address).lower()
        require(actor == case["recipient"], "RECIPIENT_REQUIRED")
        case.update(state="RECEIVED", received_by=actor)
        self.cases[key] = json.dumps(case)

    @gl.public.view
    def get_case(self, key: str) -> str:
        return self.cases.get(key, "")
