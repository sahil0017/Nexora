## Summary
<!-- Concise summary of what changed and why -->

## Affected Layers
- [ ] `platform/api` (Go control plane)
- [ ] `intelligence/ml-platform` (Python ML / Quant)
- [ ] `apps/mobile` (Expo / React Native)
- [ ] `contracts/` (OpenAPI / event schemas)
- [ ] `platform/api/migrations/` (SQL schema migrations)
- [ ] `infra/` or `scripts/` (AWS / Compose / CI/CD)

## Verification
- [ ] `cd platform/api && go test -race ./... && go vet ./...`
- [ ] `cd intelligence/ml-platform && python -m pytest`
- [ ] `cd apps/mobile && npm run typecheck`
- [ ] If migrations added: paired `.up.sql` and `.down.sql` verified idempotent

## Deployment Notes
<!-- Any env vars, secrets, CloudFormation params, or RDS migration caveats -->
