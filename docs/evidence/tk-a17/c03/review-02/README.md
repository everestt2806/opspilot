# C03 review 02 evidence

- Review time: `2026-09-13` local (`Asia/Bangkok`).
- Reviewed code `e3a32f1`, submitted HEAD `8e60243`, based on Leader review `43d41b4`.
- Review was local/read-only: no deploy, container stop/delete, database mutation, push, PR or merge.

Files:

- `credential-audit.json`: the retained C03 profile labels the value AES-GCM ciphertext, but the
  bytes start/end with the OpenSSH private-key markers; IV/tag are fixed and no protected master-key
  file exists. The secret bytes themselves are never copied into reviewer evidence.
- `actual-app-inventory.json`: the real OpsPilot user-data DB has VM01/VM02 profiles but only the
  existing A17 app; C03 apps 13–15 are absent from the application's `app:list` source.
- `reviewer-focused.txt` and `.exit.txt`: committed focused suite has 62 passing tests; the exact
  reviewer contract file adds five cases, of which three pass and two fail because the integration
  calls `renderDockerfile` without the new `BUILD_ARGS` input.
- `vm02-readonly.txt`: final2 Express/Next/Vite and collectors remain running; applications and
  PostgreSQL are healthy. App B remains running.
- `tunnel-teardown.json`: reported tunnel PID is gone and ports 33012–33014 have no listeners.
