# PostgreSQL Desktop UI acceptance

With Node 22, from the repository root:

```
node app/scripts/product-postgres-ui-lab/run.mjs --confirm-local-postgres-ui
```

Runs the production PostgreSQL component in real Electron with the production preload, Main services and two private SQLite databases. The SSH channel is synthetic and uses the real repository/selection classes; it does not verify SSH host authentication, installed Root permissions, Docker, VPS provisioning or application health. No production profile is used.

Checks all four locales, dark/light, 1280×800 and 1366×768 layouts, explicit prepare/send consent, lost prepare/select replies, exact receipt recovery after reopening SQLite with the same fixture cipher, and source-view invalidation. Reopening SQLite is not an OS process restart or DPAPI test. No database password is exposed and no deployment is started.

R7h-4d3b additionally opens the production database explorer through typed preload
and Main inspection services. The target response contains synthetic instance/table
samples, while controller source/receipt checks use real private SQLite. It tests
tables, columns, samples, removal after close and no sample persistence/database
writes. The generic preload calls explicitly mapped lab IPC handlers; production
handler routing is checked separately in ipc.test.ts. This is not actual target
SQL, a new installed Root release or a VPS database-viewing acceptance.

Evidence: `app/.out-scripts/product-postgres-ui-lab/<nonce>/result.json`. Current
screenshots: `docs/ui-redesign/screenshots/r7h4d3b/<nonce>/`; historical c4 records
remain in r7h4c4. All four locales are captured at1280x800 dark/light; Vietnamese
also at1366x768 dark/light, plus a columns screenshot. The runner uses bounded
output/time and removes only its resolved private/profile children after Electron
exits. Build the application preload before running. Only successful, visually
reviewed captures should be staged.
