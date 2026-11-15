# Conditional test coverage

All browser cases below are in `tests/e2e/google-map.spec.js` and run under the serial Chromium `desktop` project. In the default no-key run the following controlled-provider cases skip because their adapter requires an explicitly enabled fixture key. Run the separate controlled-provider command shown below to exercise them; it never proves live Google service behavior.

1. `native map matches features, styles filters, selects IDs and fits only explicitly`
2. `published entrance footprint is selectable on the controlled Google layer`
3. `published structure footprint is selectable on the controlled Google layer`
4. `visitor location is intentional, shows metre uncertainty and never enters app requests or storage`
5. `visitor location error 1 has a readable state and no marker`
6. `visitor location error 2 has a readable state and no marker`
7. `visitor location error 3 has a readable state and no marker`
8. `refresh failure clears every overlay; focus recovers; mismatched official never becomes draft`
9. `late authentication failure explains reload and clears overlay`
10. `network error has retry and Hindi Plan fallback`
11. `stalled geometry refresh times out, clears overlays and recovers on focus`
12. `refreshes at sixty seconds without refitting, then stops polling on unmount`

The controlled-provider run skips `no key or disabled does not request Maps and offers Plan fallback` and `explorer Google fallback keeps the selected URL and local Plan usable`; the default no-key run covers them. PowerShell:

```powershell
$env:VITE_GOOGLE_MAPS_ENABLED='true'
$env:VITE_GOOGLE_MAPS_KEY='fixture-key'
node node_modules/@playwright/test/cli.js test tests/e2e/google-map.spec.js --project=desktop --reporter=list
Remove-Item Env:VITE_GOOGLE_MAPS_ENABLED, Env:VITE_GOOGLE_MAPS_KEY
```

For Unix shells, prefix the command with `VITE_GOOGLE_MAPS_ENABLED=true VITE_GOOGLE_MAPS_KEY=fixture-key`. Do not use a real key with the adapter. The default Node suite skips the opt-in real-server tests in `tests/postgres-roles.test.mjs` and `tests/postgres-spatial-concurrency.test.mjs`; see `docs/DEPLOYMENT.md` for its guarded disposable target. Both opt-in tests were run locally against PostgreSQL 18.6, not PostgreSQL 16 or remote CI.
