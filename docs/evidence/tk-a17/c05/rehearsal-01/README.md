# C05 rehearsal 01

- Code SHA `936e643`; fresh Electron launch; source VM02 profile 2 and target VM01 profile 1.
- Deploy matrix: Express app 27 deployments 50/51 port 30018; Next.js app 28 deployment 52 port 30019; Vite app 29 deployment 53 port 30020. All passed PRECHECK -> UPLOAD -> RENDER -> BUILD -> DEPLOY -> HEALTHCHECK -> RECORD, Docker running/healthy, HTTP 200, collector running/restart 0.
- Express marker was present before and after redeploy.
- Migration order: Vite app 18/job 25, then Express/PostgreSQL app 16/job 26. Both completed with `keepSource=true`; runtime/HTTP/collector, checksum/file counts, PostgreSQL rows and marker passed.
- Raw files: `deploy.log`, `deploy.json`, `migrate.log`. Final process check found no Electron/node/SSH/tunnel process left.
