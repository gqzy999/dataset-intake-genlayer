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
        self._lodge(slug, record_id, recipient, files, "zenodo")

    @gl.public.write
    def lodge_dryad(self, slug: str, record_id: u32, recipient: Address, files: str) -> None:
        self._lodge(slug, record_id, recipient, files, "dryad")

    def _lodge(self, slug, record_id, recipient, files, archive):
        owner = str(gl.message.sender_address).lower()
        receiver = str(recipient).lower()
        require(owner != receiver and receiver != "0x" + "0"*40, "DISTINCT_RECIPIENT")
        require(3 <= len(slug) <= 36 and all(c in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in slug), "INVALID_SLUG")
        require(record_id > 0 and len(files) <= 12000, "INPUT_LIMIT")
        key = owner + "/" + slug
        require(key not in self.cases, "EXISTS")
        self.cases[key] = json.dumps({"owner":owner,"recipient":receiver,"record_id":int(record_id),
                                      "expected":manifest(json.loads(files)), "archive":archive, "state":"LODGED"})

    @gl.public.write
    def reconcile(self, key: str) -> None:
        case = json.loads(self.cases.get(key, "null"))
        require(case is not None and case["state"] == "LODGED", "NOT_LODGED")
        record_id = case["record_id"]

        def observe():
            if case.get("archive") == "dryad":
                path = f"/api/v2/versions/{record_id}"
                response = gl.nondet.web.get("https://datadryad.org" + path + "/files")
                if response.status != 200:
                    return {"http_status": response.status}
                data = json.loads(response.body)
                listing = data["_embedded"]["stash:files"]
                require(data["count"] == data["total"] == len(listing), "INCOMPLETE_OFFICIAL_MANIFEST")
                rows = []
                dataset_path = ""
                for item in listing:
                    require(item["_links"]["stash:version"]["href"] == path, "WRONG_VERSION")
                    dataset = item["_links"]["stash:dataset"]["href"]
                    require(not dataset_path or dataset_path == dataset, "WRONG_VERSION")
                    dataset_path = dataset
                    require(item["digestType"] == "md5", "FILE_CHECKSUM")
                    rows.append({"name":item["path"], "size":item["size"], "checksum":"md5:"+item["digest"]})
                prefix = "/api/v2/datasets/doi%3A10.5061%2F"
                require(dataset_path.startswith(prefix), "MISSING_DOI")
                return {"doi":"10.5061/"+dataset_path[len(prefix):].lower(),"files":manifest(rows)}
            response = gl.nondet.web.get(BASE + str(record_id))
            if response.status != 200:
                return {"http_status": response.status}
            data = json.loads(response.body)
            doi = "10.5281/zenodo." + str(record_id)
            require(data["id"] == record_id and data["doi"].lower() == doi, "WRONG_VERSION")
            files = manifest([{"name":item["key"], "size":item["size"], "checksum":item["checksum"]}
                              for item in data["files"]])
            return {"doi":doi,"files":files}

        def verify(leader):
            return isinstance(leader, gl.vm.Return) and leader.calldata == observe()

        evidence = gl.vm.run_nondet_unsafe(observe, verify)
        require("http_status" not in evidence, "ARCHIVE_UNAVAILABLE_" + str(evidence.get("http_status", "")))
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
