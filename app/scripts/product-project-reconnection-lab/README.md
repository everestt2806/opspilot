# Private Product project reconnection review

Run the existing private Linux/root Node22 PostgreSQL selection fixture with
`OPSPILOT_PROJECT_RECONNECTION_GATE=1`, a current private controller bundle and a
public Git source fixture. Keep `OPSPILOT_POSTGRES_INSPECTION_GATE` unset for this
metadata-only gate. Entrypoint:

```text
node app/scripts/product-postgres-lab/selection.mjs --confirm-local-postgres-selection
```

The fixture creates its own SQLite/key/SSH daemon, authenticates target enrollment
and selects a prepared database through the actual CLI. After stopping that SSH
daemon it calls `project-reconnection-context`: current public-Git/source/PG
metadata, stable digest recheck, wrong app/controller/digest/caller-target refusal,
and auto-enabled readonly review. Each read compares complete serialized SQLite
before/after; no job, pause or source mutation may be performed by the reader.
The fixture changes and restores its own policy explicitly between test groups.

No production VPS/database, Docker provisioning, Main receipt, consent confirmation,
GUI or approved serving release is involved. The controller command is a private
candidate until installed-admin/Main and release gates have their own evidence.
