"""C00 read-only inventory using existing SSH trust and an allowlist of DB columns."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
from datetime import datetime, timezone
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/evidence/tk-a17/c00"
OUT.mkdir(parents=True, exist_ok=True)


def run(name, args, stdin=None, env=None):
    started = datetime.now(timezone.utc).isoformat()
    try:
        # Byte stdin preserves LF when sending a shell script from Windows to Linux.
        result = subprocess.run(args, input=stdin.encode("utf-8") if stdin else None,
                                cwd=ROOT / "app", env=env, capture_output=True, timeout=90)
        record = dict(started_utc=started, command=args, cwd=str(ROOT / "app"),
                      exit_code=result.returncode, stdout=result.stdout.decode("utf-8", "replace"),
                      stderr=result.stderr.decode("utf-8", "replace"))
    except subprocess.TimeoutExpired:
        record = dict(started_utc=started, command=args, exit_code=None, error="timeout 90s")
    (OUT / f"{name}.json").write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
    print(name, json.dumps(record, ensure_ascii=False))


db_path = Path(os.environ["APPDATA"]) / "OpsPilot/opspilot.db"
with sqlite3.connect(db_path.as_uri() + "?mode=ro", uri=True) as db:
    db.row_factory = sqlite3.Row
    inventory = {"database": str(db_path), "mode": "ro"}
    for table, query in {
        "vps": "SELECT id,name,host,port,username,auth_type FROM vps",
        "app": "SELECT id,vps_id,name,framework FROM app",
        "running_experiments": "SELECT id,status FROM experiment_run WHERE status='running'",
    }.items():
        inventory[table] = [dict(row) for row in db.execute(query)]
(OUT / "local-inventory.json").write_text(json.dumps(inventory, indent=2), encoding="utf-8")
print(json.dumps(inventory, indent=2))

remote = r"""set -eu
date -u +%FT%TZ
id -un
docker --version
docker compose version
free -m
df -Pm /opt/opspilot
docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}'
docker network ls --format '{{.Name}}'
find /opt/opspilot -mindepth 1 -maxdepth 1 -type d -printf '%f\n'
ss -ltn
printf 'experiment_process_count='
ps -eo comm,args | awk '/[r]un_experiment.py/ {n++} END {print n+0}'
if test -e /opt/opspilot/a17-notes-0911; then echo TARGET_PATH_OCCUPIED; exit 2; else echo TARGET_PATH_FREE; fi
if docker ps -a --format '{{.Names}}' | grep -q '^a17-notes-0911'; then echo TARGET_CONTAINER_OCCUPIED; exit 2; else echo TARGET_CONTAINER_FREE; fi
if docker network ls --format '{{.Name}}' | grep -q '^a17-notes-0911'; then echo TARGET_NETWORK_OCCUPIED; exit 2; else echo TARGET_NETWORK_FREE; fi
curl --max-time 10 -sS -o /dev/null -w 'existing_app_http=%{http_code}\n' http://127.0.0.1:30001/health
wc -l /opt/opspilot/express-demo/metrics/metrics.jsonl
docker inspect --format '{{.Name}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.HostConfig.RestartPolicy.Name}}' express-demo-app express-demo-collector
"""
key = str(Path.home() / ".ssh/opspilot_ed25519")
for vps in inventory["vps"]:
    if vps["host"] not in ("221.121.1.79", "221.121.1.80"):
        continue
    run(f"ssh-vps-{vps['id']}", ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
        "-o", "ConnectTimeout=10", "-o", "IdentitiesOnly=yes", "-i", key,
        "-p", str(vps["port"]), f"{vps['username']}@{vps['host']}", "bash -s"], remote)

node = str(Path(os.environ["LOCALAPPDATA"]) / "pnpm/bin/node.exe")
probe = str(ROOT / "tools/a17-c00-native.cjs")
run("native-node22", [node, probe])
electron = subprocess.check_output([node, "-p", "require('electron')"], cwd=ROOT / "app", text=True).strip()
run("native-electron-cli", [electron, probe], env={**os.environ, "ELECTRON_RUN_AS_NODE": "1"})
gui_env = {k: v for k, v in os.environ.items() if k != "ELECTRON_RUN_AS_NODE"}
run("native-electron", [electron, probe], env=gui_env)

run("public-http", ["curl.exe", "--connect-timeout", "5", "--max-time", "10", "-sS",
                    "-o", "NUL", "-w", "HTTP=%{http_code}", "http://221.121.1.80:30001/"])

# Existing app B is only viewed. Bind the temporary forward to loopback, then close it.
tunnel_args = ["ssh", "-N", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
               "-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=10",
               "-o", "IdentitiesOnly=yes", "-i", key,
               "-L", "127.0.0.1:39011:127.0.0.1:30001", "deploy@221.121.1.80"]
with (OUT / "tunnel.stderr.txt").open("w", encoding="utf-8") as tunnel_log:
    tunnel = subprocess.Popen(tunnel_args, stdout=subprocess.DEVNULL, stderr=tunnel_log,
                              creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        for attempt in range(20):
            if tunnel.poll() is not None:
                raise RuntimeError("SSH forward exited; inspect tunnel.stderr.txt")
            try:
                with urllib.request.urlopen("http://127.0.0.1:39011/health", timeout=1) as response:
                    status = response.status
                break
            except OSError:
                time.sleep(0.5)
        else:
            raise RuntimeError("SSH forward health timeout")
        (OUT / "tunnel.json").write_text(json.dumps({"command": tunnel_args, "http": status,
            "note": "Existing app B, GET only; tunnel closed in finally"}, indent=2), encoding="utf-8")
        browser = Path(os.environ["PROGRAMFILES"]) / "Google/Chrome/Application/chrome.exe"
        profile = ROOT / "tmp/a17-c00-browser"
        run("website-browser", [str(browser), "--headless=new", "--disable-gpu", "--no-first-run",
            "--no-default-browser-check", f"--user-data-dir={profile}", "--window-size=1366,768",
            f"--screenshot={OUT / 'website-via-ssh.png'}", "http://127.0.0.1:39011/"])
    finally:
        tunnel.terminate()
        tunnel.wait(timeout=10)
