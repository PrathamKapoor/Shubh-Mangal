# Conditional test coverage

All browser cases below are in `tests/e2e/google-map.spec.js` and run under the serial Chromium `desktop` project. In the default no-key run the following controlled-provider cases skip because their adapter requires an explicitly enabled fixture key. Run the separate controlled-provider command shown below to exercise them; it never proves live Google service behavior.

1. `native map matches features, styles filters, selects IDs and fits only explicitly`
2. `published entrance footprint is selectable on the controlled Google layer`
3. `published structure footprint is selectable on the controlled Google layer`
4. `delayed snapshot and stale state never mix gate, structures and plot boundaries; recovery uses supplied geometry`
5. `visitor location is intentional, shows metre uncertainty and never enters app requests or storage`
6. `visitor location error 1 has a readable state and no marker`
7. `visitor location error 2 has a readable state and no marker`
8. `visitor location error 3 has a readable state and no marker`
9. `mismatched supplied official geometry never becomes draft`
10. `late authentication failure explains reload and clears overlay`
11. `network error has retry and Hindi Plan fallback`
12. `invalid supplied geometry clears overlays and a valid snapshot recovers`
13. `focus and sixty seconds never poll geometry or refit the map`

The controlled-provider run skips `no key or disabled does not request Maps and offers Plan fallback` and `explorer Google fallback keeps the selected URL and local Plan usable`; the default no-key run covers them. PowerShell:

```powershell
$env:VITE_GOOGLE_MAPS_ENABLED='true'
$env:VITE_GOOGLE_MAPS_KEY='fixture-key'
node node_modules/@playwright/test/cli.js test tests/e2e/google-map.spec.js --project=desktop --reporter=list
Remove-Item Env:VITE_GOOGLE_MAPS_ENABLED, Env:VITE_GOOGLE_MAPS_KEY
```

For Unix shells, prefix the command with `VITE_GOOGLE_MAPS_ENABLED=true VITE_GOOGLE_MAPS_KEY=fixture-key`. Do not use a real key with the adapter. The default Node suite skips the opt-in real-server tests in `tests/postgres-roles.test.mjs`, `tests/postgres-spatial-concurrency.test.mjs` , `tests/postgres-disconnect.test.mjs` and `tests/public-snapshot-postgres.test.mjs`; see `docs/DEPLOYMENT.md` for its guarded disposable target. Role, spatial and snapshot opt-in tests were run locally against PostgreSQL 16.15 and 18.6. This does not establish that remote CI ran.

The competing-editor tests use a second disposable API on port 3003 and Vite on 5182, so earlier test logins cannot exhaust their shared IP rate limit. Both test servers enforce the regular application limit and use separate in-memory databases.


## Spatial PostgreSQL diagnostics

The guarded spatial test records phases, UTC/elapsed times, its generated disposable database name, pool/connection/backend identities, lock attempts, request settlement, assertion completion and cleanup in `.local/ci-diagnostics/*.jsonl`. The CI PostgreSQL service is pinned to 16.16 for investigation reproducibility. CI uploads only these redacted JSONL files with seven-day retention, including failed runs. Query text, parameters, client configuration and connection strings are not recorded.

Observers are test-only. Unexpected connection events are recorded and fail the test at its final failure report; they cannot be converted into a successful result. Body and cleanup failures are reported separately, with the original body error first. The initial instrumented test retains reverse pool shutdown followed by the forced database drop; diagnostics are not a teardown fix or evidence that an intermittent failure is resolved.

The disconnect regression holds the actual PostgreSQL Terminate message at a barrier. It checks that adapter shutdown remains pending until that barrier is released. A premature shutdown reproduces the old forced-drop ordering and records both the original assertion and the subsequent idle-client/pool error; there is no retry or timing-based pass. It runs after the six spatial interleavings in the PostgreSQL job.
