# C01 live deploy evidence

Ngày thực hiện: 11/09/2026 (UTC logs 10/09). Target: VM02 id=2,
`/opt/opspilot/a17-notes-0911`, host port `30000`, current app deployment `v7`.
Raw pipeline output: `live-deploy-pass.txt`; first genuine readiness failure:
`live-deploy-initial-fail.txt`; runner-only verification corrections:
`live-deploy-runner-check-fail.txt`.

## Deployment history

- Attempt `deployment_id=1`, v1: FAIL at DEPLOY because PostgreSQL was not ready
  (`ECONNREFUSED`). Pipeline ran its documented new-app cleanup; no app B impact.
- Fix: PostgreSQL `pg_isready` healthcheck plus app `depends_on: service_healthy`.
- `deployment_id=2`/v2 and `3`/v3: finished `running`; marker POST returned id 1001,
  later read-only `/meta` confirmed PostgreSQL and records 1001. The first verification
  runner falsely failed because its query limit excluded marker id 1001.
- Final verified pass: `deployment_id=6`/v6 and `7`/v7, both `finished=running`;
  marker POST returned id 1003; `/meta` returned `storage=PostgreSQL`, `records=1003`,
  and offset query returned the marker. Current pointer is deployment 7, image `a17-notes-0911:v7`.
- Collector image: `a17-notes-0911:collector`; app/DB/collector all running. v1 failed
  and remains recorded as failed history; it is not counted as a successful release.

## Collector data

- `metrics.jsonl`: copied at 11/09 check, 91 rows, seq 1..91 continuous; timestamps
  `2026-09-10T20:20:59Z` through `2026-09-10T20:38:25Z` (over 10 minutes).
- `latest.json` equals the last copied JSONL row; all 13 contract fields are present.
- Last sample: `latency_ms=22.8366`, `http_error_rate=0.0`, `db_response_ms=14.8762`,
  `container_up=1`, `collector_version=1.0.0`.
- Nulls were observed only where measurement was unavailable: latency 2 rows and DB
  response 1 row; no null was converted to a fake zero.
- Collector bind mounts: `/opt/opspilot/a17-notes-0911/metrics` → `/var/metrics` RW and
  `/var/run/docker.sock` → `/var/run/docker.sock` RO; memory limit is 128m in rendered compose.

## Persistence and failure isolation

- PostgreSQL bind mount is `/opt/opspilot/a17-notes-0911/data/pg` → `/var/lib/postgresql/data`.
- App v7 and PostgreSQL were healthy with restart count 0; app B remained healthy with
  its original container names and port 30001.
- Controlled T6 stopped only the A17 collector. App health stayed 200, collector was
  started again by its compose service, one container remained, and metrics resumed.
