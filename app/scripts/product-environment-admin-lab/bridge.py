"""Native same-UID run_cli gate; stdin request, no plaintext file or SSH."""

import json
import pathlib
import runpy
import sys

helper = runpy.run_path(
    pathlib.Path(__file__).resolve().parents[2]
    / "src/main/controlPlane/desktop_controller_admin.py"
)
request = json.loads(sys.stdin.buffer.read(512 * 1024 + 1))
try:
    result = helper["run_cli"](request, request["operation"], request["payload"])
    print(json.dumps({"ok": True, "data": result}))
except helper["AdminFailure"] as error:
    print(json.dumps({"ok": False, "code": error.code}))
except (ValueError, OSError, KeyError, TypeError):
    print('{"ok":false,"code":"CONTROLLER_ADMIN_FAILED"}')
