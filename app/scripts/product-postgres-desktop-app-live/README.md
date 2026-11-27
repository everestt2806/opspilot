# Main PostgreSQL first-deployment acceptance

Operator harness using production Main APIs and pinned SSH on the authorized development VPS. Requires C5 controller rollout PASS and its durable `current.json` locator before starting. This is not a GUI test.

Node22: `node app/scripts/product-postgres-desktop-app-live/launch.mjs --start`.
Credentials only after `PRIVATE_INPUT_READY_NO_ECHO`; resume the original nonce using `--resume <nonce>`. A PASS journal cannot resume. Credentials remain in RAM or a nonce-owned encrypted profile, never argv/environment/plaintext.

Uses Main038 prepare/send/check receipts for PostgreSQL, real source review and first-deployment readiness/confirmation, then Git update/health-fault rollback/final healthy. No operator PostgreSQL CLI relay and no fabricated ENV receipt. Existing seven apps and app7 PostgreSQL identity/volume/data/secret material must stay unchanged. New project is isolated on a nonce Git branch and allocated app port. Unknown outcomes retain original UUID/private profile and require original receipt lookup.

Runtime receipts must show the same database UUID/CID/volume/system identifier and 1,000 rows across updates and rollback. Revokes the scoped client and verifies all policies paused/zero jobs at completion; removes only its resolved private-profile child. Product backup API, runtime inspector and formal ML are separate tasks.

After PASS: `node app/scripts/product-postgres-desktop-app-live/inspect-launch.mjs <nonce>` verifies the exact current ce4d/4bc controller, schema37, paused project/no jobs and a fresh measured database metric over pinned SSH. This read-only follow-up keeps credentials in RAM and never opens a production Desktop profile.
