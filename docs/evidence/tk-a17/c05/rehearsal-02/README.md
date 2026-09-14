# C05 rehearsal 02

- Code SHA `936e643`; fresh Electron launch after rehearsal 01; source VM02 profile 2 and target VM01 profile 1.
- Deploy matrix: Express app 32 deployments 56/57 port 30021; Next.js app 33 deployment 58 port 30022; Vite app 34 deployment 59 port 30023. All passed PRECHECK -> UPLOAD -> RENDER -> BUILD -> DEPLOY -> HEALTHCHECK -> RECORD, Docker running/healthy, HTTP 200, collector running/restart 0.
- Express marker was present before and after redeploy.
- Migration order: Vite app 18/job 27, then Express/PostgreSQL app 16/job 28. Both completed with `keepSource=true`; runtime/HTTP/collector, checksum/file counts, PostgreSQL rows and marker passed.
- Raw files: `deploy.log`, `deploy.json`, `migrate.log`. Final process check found no Electron/node/SSH/tunnel process left. App B was not mutated; C06-C09 remain NOT_RUN.
