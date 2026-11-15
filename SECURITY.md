# Security reporting and source hygiene

This is a private development checkout. No public release or public vulnerability
intake channel has been authorized. No support window, response SLA, independent
security certification or completed incident response exercise is claimed.

## Report privately

Use an existing private channel already authorized by the owner; if none is
confirmed, ask the owner to establish one. Do not invent a security email address,
open a public issue, publish a proof of concept or send source to a third party.
Initially report affected paths/line numbers, observed behavior, impact and a
synthetic reproduction. Do not include credentials, matched secret strings,
customer records, precise private controls, private keys or runtime database data.

If a credential may have been exposed, stop sharing the candidate artifact and
notify the owner privately. The credential owner should assess scope, rotate or
revoke it, review access records and decide whether authorized history remediation
is needed. Removing the current line does not remove historical exposure. Do not
rewrite Git history, contact providers, delete evidence or perform remote actions
without explicit authorization.

## Current security boundaries

The API enforces server-side roles, sessions, origin/CSRF checks and publication
filters. Production requires PostgreSQL; PGlite is the local substitute. Uploaded
media is gated by published references. In contrast, files under `public/` copied
into `dist/` are static public artifacts, including source downloads prepared by
`scripts/prepare_public.mjs`. A hidden UI record or unpublished database row does
not restrict these files. Confirm rights and sensitivity before any handoff or
hosting; rights are currently unknown.

Browser-delivered configuration is observable by visitors. A browser map key must
not be confused with a server secret; provider restrictions and monitoring require
separate verification. This document does not configure a provider or establish
permission to use imagery. Never put database credentials in browser variables.

The checkout uses a single site's data and policy. Projection portability is not
tenant isolation. Backup/restore, customer retention/anonymisation, maintenance,
monitoring and production restricted-role behavior require operational evidence;
local synthetic tests do not establish them. Physical field alignment and access
rights require the separate evidence in `docs/FIELD_ALIGNMENT.md`.

## Preflight scope and limitations

`node scripts/release-preflight.mjs` inspects Git-tracked working files and all
commits reachable from local refs. Forbidden credential/runtime paths are flagged
without reading their contents. Selected binary types are excluded; other NUL
containing content is not searched as text. Only recognized token formats and
private-key headers are searched. Findings include locations only, never values.
Git failures, missing files, symlinks/submodules and scan limits fail closed.

It does not inspect untracked/ignored files, `.env` contents, runtime data,
unreachable objects, reflog-only commits, Git LFS object contents, remote refs not
present locally, archives or deployed systems. It cannot detect every secret,
obfuscation, generic password or personal data. Exit zero is a bounded source
hygiene result, not security clearance, rights clearance or release authorization.
Do not bypass a finding with a broad exclusion or publish a raw scanner transcript
from another tool that could include matched values.
