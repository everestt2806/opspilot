# Desktop PostgreSQL intent lab

Run with Node 22 from the repository root:

```
node app/scripts/product-postgres-desktop-lab/run.mjs --confirm-local-product-postgres-desktop
```

Uses two private SQLite databases and production Main intent/vault/configuration services with synthetic controller transport. Checks Desktop038/Controller037 separation, prepare/select receipts, ENV after DB, preserved registration and SQLite close/reopen recovery with the same fixture cipher. No SSH, Docker, VPS, real Electron restart or OS credential storage is exercised. No database password is returned to Main/renderer.

Evidence is written to `app/.out-scripts/product-postgres-desktop-lab/<nonce>/proof.json`. Scratch cleanup verifies the resolved temporary parent and nonce ownership marker before removal; evidence remains in the ignored output folder. The runner requires the explicit confirmation flag and Node 22.
