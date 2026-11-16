# PostgreSQL Desktop UI acceptance

With Node 22, from the repository root:

```
node app/scripts/product-postgres-ui-lab/run.mjs --confirm-local-postgres-ui
```

Runs the production PostgreSQL component in real Electron with the production preload, Main services and two private SQLite databases. The SSH channel is synthetic and uses the real repository/selection classes; it does not verify SSH host authentication, installed Root permissions, Docker, VPS provisioning or application health. No production profile is used.

Checks all four locales, dark/light, 1280×800 and 1366×768 layouts, explicit prepare/send consent, lost prepare/select replies, exact receipt recovery after reopening SQLite with the same fixture cipher, and source-view invalidation. Reopening SQLite is not an OS process restart or DPAPI test. No database password is exposed and no deployment is started.

Evidence: `app/.out-scripts/product-postgres-ui-lab/<nonce>/result.json`. Screenshots: `docs/ui-redesign/screenshots/r7h4c4/<nonce>/`. The runner uses bounded output/time and removes only its resolved private/profile children after Electron exits. Build the application preload before running. Only successful, visually reviewed captures should be staged.
