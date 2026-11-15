# Local development and production operations

`SITE_NAME` optionally changes the public project name returned by the API, HTML plot titles and selected client text. It does not replace the source geometry, artwork, wordmark, demo amenities, seed or geographic limits; setting this alone does not configure a different development. Omit it to retain the Shubh Mangal default. Full single-site portability remains unfinished.

The opt-in `scripts/postgres-check.mjs` requires `ALLOW_DISPOSABLE_POSTGRES=true`, an explicitly supplied loopback `TEST_DATABASE_URL` whose database begins `shubh_test_`, and matching `pg_dump`/`pg_restore` on PATH. It creates and removes only its own generated test databases. `TEST_POSTGRES_MAJOR` defaults to 16 and accepts 16 or 18. A disposable PostgreSQL 18.6 run passed migrations, pooled rollback and version conflict, synthetic public geometry, and a coordinated paused-writes database plus media dump/restore with restored app checks. PostgreSQL 16 CI execution and production DB-role privilege checks remain pending. Keep production writes paused across both database and media snapshots, record the snapshot boundary and verify restore to a separate target before relying on a backup.

## Prerequisites and local workflow

Use Node 24.16+ (tested 24.21.0), npm, and a normal local filesystem. No credentials are bundled. PostgreSQL is optional locally: PGlite runs actual PostgreSQL in-process and persists under `.local/database`. It is an explicit development substitute, not a shared/multi-process production service. Production refuses to start without DATABASE_URL.

For a **new, empty** local database, with the API stopped:

```bash
npm ci
cp -n .env.example .env
npm run db:migrate
npm run db:seed
```

Edit `.env`: use `APP_ORIGIN=http://127.0.0.1:5173` if opening Vite on that exact host; use `http://localhost:5173` if opening localhost. Origins must match exactly, including port. Set OWNER_EMAIL, OWNER_NAME and a unique OWNER_PASSWORD (at least 14 characters) privately, then:

```bash
npm run db:owner
```

Remove OWNER_PASSWORD from `.env` once provisioned. There are no default owner credentials. Start in separate terminals:

```bash
npm run api
```

```bash
npm run dev
```

Open http://127.0.0.1:5173 (or the exact APP_ORIGIN you configured). For another port, update APP_ORIGIN and run `npm run dev -- --port 5180 --strictPort`. `npm run preview` is a static preview, not the production server; it has no API proxy. Use the development server for local database workflows.

**Local database ownership:** only one process may open a PGlite directory. Stop the API before running database CLI commands or backups. A PID lock rejects concurrent opens; a dead-process lock is recovered on next open. Do not delete a live lock. Never place `.local` on a network filesystem or share it among replicas. Seed is idempotent and never creates approved inventory. Tests use separate disposable databases.

For an existing local database, stop the API and take `npm run db:backup -- .local/before-upgrade.tar.gz` before `npm run db:migrate`. Migration 003 extends the visit-status check for no-show and requires a scheduled slot. Migration 004 expands the allowed content kinds for separately reviewed presentation settings; it does not rewrite plot, content or audit rows. Each migration runs transactionally. The server refuses to start if any checked-in migration is pending. Local backups remain private.

This workspace's 004 upgrade used the private backup `.local/pre-004-presentation-backup.tar.gz` (mode 0600, gzip integrity checked). Before and after counts matched: 0 plot records, 7 content records, 0 audit events, 0 enquiries and 0 visit requests. No reset, reseed or real publication was performed.

Before applying 004 to a populated database, make and verify a fresh backup and test the release against a restored copy. To roll back, stop the service and restore that backup into a **new** database/directory, verify it, then point the prior release to it; keep the current database and reconcile any changes made after the backup before cutover. Do not delete presentation or audit rows to force the older constraint. PostgreSQL deployments use the documented `pg_dump`/restore procedure and the migration owner, not the restricted runtime role.

## Checks

```bash
npm run lint
npm run test
npm run build
npx playwright install chromium
npm run test:e2e
npm audit
```

An existing supported Chromium can be used without another download:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/google/chrome/chrome npm run test:e2e
```

E2E starts in-memory APIs at 3002 and 3003 and Vite at 5181 and 5182, with synthetic accounts only. Those ports must be free. The competing-editor cases use the second server to isolate login rate-limit state. Tests never seed a user into the development or production database. Physical iOS/Android hardware and Safari have not been tested here.

CI also runs `scripts/postgres-check.mjs` against a disposable PostgreSQL 16 service using the application's pooled adapter. It exercises migrations, transaction rollback, API persistence, publication, and a synthetic custom-format database dump and restore with separately copied media. The check requires `pg_dump` and `pg_restore`, explicit `ALLOW_DISPOSABLE_POSTGRES=true` and a loopback `TEST_DATABASE_URL` naming a `shubh_test_` control database; it creates and removes separately generated databases and temporary files. PostgreSQL environment overrides (`PG*`) are rejected. Use only an isolated server owned for the test, never a client or production server. This synthetic drill does not validate a provider's backups or production recovery procedure.

CI is configured to run `node --test tests/postgres-roles.test.mjs` with `RUN_POSTGRES_ROLE_CHECK=true` and the same disposable PostgreSQL 16 settings. The same opt-in test also supports explicit `TEST_POSTGRES_MAJOR=18`; it passed on a disposable local PostgreSQL 18.6 server in this session. It creates unique synthetic migration-owner and runtime login roles and two databases, applies the actual migrations and adapted deployment grants, tests runtime access and history mutation restrictions, and restores a custom-format dump into the second database before reapplying grants. It removes only roles and databases it successfully created. The control account needs permission to create roles and databases; matching `pg_dump` and `pg_restore` must be on PATH. The test is skipped without the explicit opt-in. Never point it at a production or shared server, even if its address and database name satisfy the guards. Its synthetic restore does not prove a provider backup or restore; PostgreSQL 16 CI has not been observed running.

The grants revoke runtime writes to `schema_migrations`; retain its read access for startup checks and apply the updated grants to existing deployments through the database owner. The local PGlite role test checks the denial, but PostgreSQL 16 and provider-specific privileges require execution against the intended targets. Runtime privileges and recovery on an actual deployment remain unverified by the synthetic CI drill.

## Production target: Node service + PostgreSQL + HTTPS reverse proxy

No provider account, domain, database credentials or notification service was supplied. The following steps deploy to a Linux host with Node 24, PostgreSQL 16+ (or a managed PostgreSQL service), nginx and systemd. Replace domain/path placeholders with real provisioned values. Do not deploy PGlite as production inventory storage.

1. Provision PostgreSQL database `shubh_mangal`, a migration owner, and later a restricted runtime account. Require encrypted connections for a remote database (`PG_SSL=true` uses certificate verification). Keep DATABASE_URL in a secret store or a root-owned `0600` environment file. Do not use a VITE_ variable.
2. Copy the source into `/srv/shubh-mangal/releases/<release-id>`; exclude `.local`, `.env*` except `.env.example`, node_modules, reports, browser profiles, test outputs and private exports. Preserve `source-data` and reference images. Do not run `prepare_data.py` over live reviewed records.
3. In that release directory, run `npm ci`, `npm run lint`, `npm run test`, `npm run build`. Run E2E against an isolated test environment as above. These operations do not need production credentials.
4. Use migration-owner credentials in a private environment, set DATABASE_URL and run `npm run db:migrate`. Run `npm run db:seed` only when intentionally initialising a new empty database; do not reseed an existing one. Run migrations once per release, before switching the running application. Migrations are forward-only and tracked in schema_migrations. Take a backup before subsequent migrations; never silently edit an already-applied migration.
5. Provision the first owner with private OWNER_EMAIL / OWNER_NAME / OWNER_PASSWORD and `npm run db:owner`. Remove provisioning secrets immediately. Only one intentional first owner is created; there is no automatic bootstrap on server start.
6. Apply `deploy/postgres-roles.sql` as database owner, adapting provisioned role names. Set the runtime password privately with `\password shubh_runtime`. Audit/status/verification/price history is protected both by append-only triggers and runtime privilege restrictions. A database superuser remains a trusted operator; audit protection is not a claim of tamper-proof storage against that operator.
7. Create `/etc/shubh-mangal.env` owned by root, mode 0600, with:

   ```dotenv
   NODE_ENV=production
   APP_ORIGIN=https://YOUR_CONFIRMED_DOMAIN
   API_HOST=127.0.0.1
   API_PORT=3001
   DATABASE_URL=YOUR_PRIVATE_RUNTIME_CONNECTION_STRING
   PG_SSL=true
   DEMO_MODE=false
   TRUST_PROXY_HOPS=1
   MEDIA_DIRECTORY=/var/lib/shubh-mangal/media
   ```

   Use PG_SSL=false only for a local database connection explicitly secured at the host level. Do not paste these placeholders as credentials. `DEMO_MODE=false` exposes only published approved inventory; requests cannot reference draft cells. With no reviewed inventory, the public explorer truthfully has no published plots.
8. Create the unprivileged `shubh-mangal` service user. Make release files readable by it. Create the private persistent media directory with `sudo install -d -o shubh-mangal -g shubh-mangal -m 0700 /var/lib/shubh-mangal/media`. Point `/srv/shubh-mangal/current` to the new release. Install `deploy/shubh-mangal.service` under `/etc/systemd/system/`, adjusting the Node binary path and ReadWritePaths if necessary. Run `sudo systemctl daemon-reload`, `sudo systemctl enable --now shubh-mangal`. Production requires an absolute `MEDIA_DIRECTORY` outside the release tree. Only PNG/JPEG/WebP images up to 2 MiB can be staged by authorised staff; an image is public only while visible published content references it.
9. Configure the confirmed domain and valid TLS certificate in `deploy/nginx.conf`, install it in nginx, test with `sudo nginx -t`, and reload nginx. The proxy replaces X-Forwarded-For; TRUST_PROXY_HOPS=1 is valid only when exactly that one trusted proxy fronts the application. Keep port 3001 inaccessible from the public network. Helmet provides CSP, anti-framing, content-type, referrer and production HSTS headers. Compression handles large JSON/SVG. Unknown application routes receive the React shell; API 404s stay JSON.
10. Check `/api/health`, public source links, an approved `/plots/<uuid>` direct URL, browser reload/back/forward, HTTPS cookies, login/logout, permissions and an authorised test enquiry. Verify its private appearance in the owner workspace, then remove/anonymise the test customer through the agreed retention process. A successful POST is database acceptance only; no email/SMS delivery is promised.
11. Set and verify the owner’s public contact, entrance, content, amenities, privacy contact/retention policy and approved inventory. Inspect the historic poster warning. Confirm legal/public permission for source documents before general public launch.

Do not send production credentials to this repository. Recurring services are the host, PostgreSQL, encrypted backups, domain/TLS operations and optional future notification/media providers. No provider price or free tier is assumed.

## Backup and recovery

For local development, stop the API and run:

```bash
npm run db:backup -- .local/backup.tar.gz
npm run db:restore -- .local/backup.tar.gz .local/restored-database
```

The restore target must not exist. Set LOCAL_DB_PATH to `.local/restored-database`, run `npm run db:verify`, then start the API. Keep the original database until verification is complete. PGlite archives restore only to compatible PGlite versions; they are not pg_dump files. Automated tests verify a physical backup/restore including a persisted record and migration history.

For production, use a dedicated backup credential in your environment and encrypted storage:

```bash
pg_dump --format=custom --file=shubh-mangal.dump "$BACKUP_DATABASE_URL"
pg_restore --list shubh-mangal.dump
```

Restore into a separate empty database, never over the live database during an incident:

```bash
pg_restore --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" shubh-mangal.dump
```

Back up `MEDIA_DIRECTORY` separately in encrypted storage alongside the database snapshot; a pg_dump does not contain image bytes. Restore it to a new private directory with the same filenames and restrictive ownership before switching the environment. Test that published images load and withdrawn images remain inaccessible. Unreferenced staged files may remain private; do not remove files without an owner-approved retention procedure.

Reapply runtime grants with the correct restored database/role names. Verify counts, a sample lead, approved IDs/mappings, audit history and application health before switching DATABASE_URL. Use managed point-in-time recovery where available. The owner must set backup frequency, retention, RPO/RTO and perform recurring restore drills; PostgreSQL provider backup/restore has not been exercised without a provisioned service.

## Rollback and monitoring

Keep the prior release. Roll back code by repointing `current` and restarting the service only if its schema remains compatible. A schema rollback requires an explicit migration or restore decision. Never discard audit history to roll back a status: record a compensating update with the previous value and a reason.

Logs contain request ID, method, matched route and status, not request bodies, passwords, query strings or buyer contact fields. Monitor 5xx/429 rates, disk/database capacity, backup age and health. Restrict log and backup access. Expired sessions, rate buckets and old import previews can be pruned by an authorised maintenance job; never prune inventory audit history. Set customer retention and anonymisation rules with the owner before launch. Password resets and role changes revoke sessions; staff can change their own password in My account.

## Scope limits

No live deployment or paid provider was activated. No messaging, payment, holds, satellite tiles, 3D, panorama or drone assets are fabricated. Split/merge is a reviewed GeoJSON staging and ID-mapping workflow, not an in-browser survey CAD editor. English is the complete working interface; primary Hindi navigation, explorer and contact prompts are implemented, with remaining copy requiring an owner-reviewed translation pass. These are explicit follow-on operations, not claims of activated external services.


The disposable PostgreSQL recovery drill also stages and publishes the built-in synthetic gate and building through authenticated API requests, saves private superseding drafts, and verifies their public and private records after database/media restore. Those procedural models are versioned application code, not external files; this check does not cover restoring an external model asset or a production provider backup. A local PostgreSQL 18.6 execution passed; PostgreSQL 16 CI has not been observed.

The disposable PostgreSQL 18.6 restricted-role test also authenticated and published the synthetic building through the application using the runtime role, then verified the model through the restored application with that role. The migration-owner role applied migrations and restore; the runtime role remained unable to alter schema or audit history. This does not establish PostgreSQL 16 CI or production operator privileges.
