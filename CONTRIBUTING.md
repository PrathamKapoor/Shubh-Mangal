# Contributing to this private checkout

Work is currently authorized for local review and development only. No public
release, repository publication, deployment, remote write or source redistribution
is authorized by this file. Publication rights and project licensing terms remain
unresolved; this guide chooses no license and grants no rights.

## Scope and data handling

- Agree the files and task with the owner. Preserve concurrent changes from other
  contributors. Do not reset, reseed, migrate or inspect a real database as part
  of a test run. Never read or include `.env`, runtime `.local` data, customer
  exports, credentials or private measurements in review output.
- Keep supplied originals unchanged. Separate source geometry, approved identity,
  inventory status and illustrative placement. Review a geometry revision with
  its source provenance and ID mappings; do not infer surveyed dimensions or
  availability from a concept image or a browser map.
- Use synthetic test records and disposable storage. Every local test fixture
  calling `openDatabase` must pass `url: null` explicitly, including reopen calls;
  `dir: ':memory:'` alone does not override an inherited `DATABASE_URL`.
- Do not commit dependencies, runtime/build outputs, paper/research material or
  TeX artifacts. Keep real field controls and rights evidence in approved private
  storage, not in examples. Use clearly synthetic fixtures only.

## Checks

Use Node 24.19.0 for parity with `.github/workflows/ci.yml`. In an isolated clean
checkout with no real credentials, run `npm ci`, `npm run lint`, `npm test`,
`npm run build`, `npx --no-install playwright install --with-deps chromium`, then
`npm run test:e2e -- --forbid-only`. Coordinate installations and output-generating
checks when sharing a workspace. PGlite tests do not prove a real PostgreSQL
deployment, restricted-role permissions, nginx/TLS behavior or a field survey.

Run `node scripts/release-preflight.mjs` from the repository root before preparing
a source handoff. It is nonmutating and emits counts and path/line locations only;
see `docs/RELEASE_READINESS.md` for coverage, exclusions and exit codes. Newly
created untracked files are not scanned. Review the exact intended Git index and
the eventual artifact separately, without printing sensitive contents. Do not run
`git add --all` merely to satisfy the scan.

Include the problem, changed behavior, exact verification commands/results and
remaining limitations in the handoff. Distinguish implemented code from proposed
workflows, synthetic tests from live validation, and owner approval from public
release authorization. Report suspected exposure through `SECURITY.md`.
