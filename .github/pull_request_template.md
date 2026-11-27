## Summary

<!-- Briefly describe what this pull request changes and why. -->

## Verification

<!-- List exact commands run and observed test results. -->

```bash
pnpm typecheck
pnpm lint
pnpm test
```

## Design Notes

<!-- Document any notable architectural trade-offs or schema/contract updates. -->

## Checklist

- [ ] `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass locally
- [ ] Changes adhere to contracts in `docs/contracts/`
- [ ] No secrets, credentials, or local database files in diff
- [ ] Database schema changes use additive migrations without modifying prior migrations
- [ ] Unit/integration tests cover new behavior and edge cases
