import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import patch


def contract(source, name, owner):
    host = ModuleType("genlayer")
    message = SimpleNamespace(sender_address=owner)
    responses = []

    def fetch(url):
        expected, payload = responses.pop(0)
        if expected is not None and expected != url:
            raise AssertionError((expected, url))
        return SimpleNamespace(status=200, body=json.dumps(payload).encode())

    def exposed(fn):
        return fn

    class Return:
        def __init__(self, value):
            self.calldata = value

    def run(leader, validate):
        result = leader()
        if not validate(Return(result)):
            raise ValueError("VALIDATORS_DISAGREE")
        return result

    host.u32, host.Address, host.TreeMap, host.allow_storage = int, str, dict, exposed
    host.gl = SimpleNamespace(
        Contract=object, message=message,
        public=SimpleNamespace(write=exposed, view=exposed),
        vm=SimpleNamespace(Return=Return, UserError=ValueError, unpack_result=exposed, run_nondet_unsafe=run),
        nondet=SimpleNamespace(web=SimpleNamespace(get=fetch)),
    )
    scope = {}
    with patch.dict(sys.modules, {"genlayer":host}):
        exec(Path(source).read_text(),scope)
    return scope[name](), message, responses, scope
