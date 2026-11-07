"""Kiểm tra run_cli bằng subprocess thật; không SSH hoặc dữ liệu sản phẩm."""

import json
import pathlib
import runpy
import sys
import tempfile


def main():
    helper = runpy.run_path(
        pathlib.Path(__file__).resolve().parents[2]
        / "src/main/controlPlane/desktop_controller_admin.py"
    )
    run_cli, admin_failure = helper["run_cli"], helper["AdminFailure"]
    cases = []
    with tempfile.TemporaryDirectory(prefix="opspilot-admin-error-probe-") as scratch:
        artifact = pathlib.Path(scratch) / "fixture.cjs"
        artifact.write_text(
            """
let input=''; process.stdin.on('data',chunk=>input+=chunk);
process.stdin.on('end',()=>{
  const mode=JSON.parse(input).mode;
  if(mode==='success'){
    process.stderr.write('synthetic-private-stderr');
    process.stdout.write(JSON.stringify({state:'fixture_ok'}));
  } else if(mode==='known'){
    process.stderr.write('CONTROL_PLANE_ERROR PROJECT_SOURCE_UNSUPPORTED\\n');
    process.exitCode=1;
  } else if(mode==='suffix'){
    process.stderr.write('CONTROL_PLANE_ERROR PROJECT_SOURCE_UNSUPPORTED synthetic-private-stderr\\n');
    process.exitCode=1;
  } else if(mode==='unknown'){
    process.stderr.write('CONTROL_PLANE_ERROR PROJECT_SOURCE_SECRET_VALUE\\n');
    process.exitCode=1;
  } else if(mode==='stderr_limit'){
    process.stderr.write('x'.repeat(1025));process.exitCode=1;
  } else if(mode==='stdout_limit'){
    process.stdout.write('x'.repeat(65537));
  }
});
""",
            encoding="utf-8",
        )
        request = {
            "node_path": sys.argv[1],
            "artifact_path": str(artifact),
            "data_directory": scratch,
        }
        assert run_cli(request, "verify-project-source", {"mode": "success"}) == {
            "state": "fixture_ok"
        }
        cases.append("success_ignores_arbitrary_stderr")
        for mode in ("known", "suffix", "unknown", "stderr_limit", "stdout_limit"):
            try:
                run_cli(request, "verify-project-source", {"mode": mode})
            except admin_failure as error:
                assert mode == "known"
                assert error.code == "PROJECT_SOURCE_UNSUPPORTED"
            except ValueError as error:
                assert mode != "known"
                assert "synthetic-private-stderr" not in str(error)
                assert "SECRET_VALUE" not in str(error)
            else:
                raise AssertionError("SOURCE_ERROR_REJECTION_REQUIRED")
            cases.append(mode)
        try:
            run_cli(request, "register-project", {"mode": "known"})
        except admin_failure:
            raise AssertionError("SOURCE_CODES_MUST_NOT_CHANGE_REGISTRATION") from None
        except ValueError:
            cases.append("legacy_registration_does_not_forward_source_codes")
        else:
            raise AssertionError("LEGACY_ERROR_REJECTION_REQUIRED")
    print(json.dumps({"status": "PASS", "passed": len(cases), "cases": cases}))


if __name__ == "__main__":
    main()
