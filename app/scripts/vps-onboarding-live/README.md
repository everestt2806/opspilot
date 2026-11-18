# UX1 — VPS onboarding acceptance

Production `VpsOnboarding` resolves an optional advanced fingerprint in Main.
First-contact probing supplies no password/private key/agent and rejects the
handshake before authentication. Stored/archived endpoint identity wins; a
transient Main cache preserves the observed identity through check/save. Normal
SshManager connections still require and verify a pin. Saving persists the public
pin and encrypted credential using the existing schema.

Node22, built production preload, Electron-rebuilt SQLite and approved dependencies
are required. No real password belongs in a command, environment variable or file.

```powershell
. ./tools/enter-node22.ps1
node app/scripts/vps-onboarding-live/launch.mjs --confirm-readonly-assigned-vps
```

After `PRIVATE_INPUT_READY_NO_ECHO` provide an array of exactly two objects with
`host` and `password`, in the no-echo input. The operator gate permits only the
assigned VPS1+2 and rechecks their previously pinned public keys before credentials.
It exercises production auto-pin/create/encrypted SQLite/strict SSH, then a fixed
readonly OS/resource/runtime inventory. It neither installs Docker/controller nor
reads app data; private credential DB is removed. Raw proof lives under
`app/.out-scripts/vps-onboarding-live/<nonce>/proof.json`.

```powershell
pnpm --prefix app exec electron scripts/vps-onboarding-live/electron.mjs --confirm-private-vps-form
```

The Electron gate uses the production form/preload and Main onboarding/SQLite
with synthetic host observation. It proves default fields, optional advanced pin,
save via IPC and layout. It is separate from actual SSH inventory; neither proves
a complete installed-controller deployment. Screenshots contain no real credential.
Private DB cleanup is checked; Chromium cache remains in the ignored nonce folder,
outside the real application profile. Initial failure logs are retained separately.
