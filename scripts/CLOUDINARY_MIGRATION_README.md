# Cloudinary Account Consolidation — Runbook

Consolidate all assets from the **source** account `djrqmnzdw` (an unknown
backend account) onto the **destination** account `dtmguwoam` (the account you
control, which the Vercel frontend already uses), then decommission the source.

Background and the full rationale live in the approved plan; this file is the
operator's checklist for the three scripts.

## Scripts

| Script | Purpose |
|---|---|
| `cloudinary-migrate.ts` | Snapshot every source asset (image/video/raw) to a manifest, then copy each into the destination preserving `public_id` + `resource_type`. Resumable; doubles as the delta-sync. |
| `cloudinary-db-rewrite.ts` | Swap `res.cloudinary.com/djrqmnzdw/` → `…/dtmguwoam/` in every DB column that stores a URL. Auto-discovers columns from `information_schema`. Run **once per Neon branch**. |
| `cloudinary-delete-source.ts` | After verification, delete source assets — but only ones confirmed present on the destination. |

The migrate/delete scripts share a working dir, `scripts/.cloudinary-migration/`
(`manifest.json`, `migrated.json`, `collisions.json`, `deleted.json`). **Do not
commit it** — add `scripts/.cloudinary-migration/` to `.gitignore` if needed.

## Credentials (inline env vars only — never edit `.env`)

Both accounts' `cloud_name` + `api_key` + `api_secret` are in `lizt-backend/.env`
(both Cloudinary blocks). Read them and pass inline per run:

```
SRC_CLOUDINARY_NAME=djrqmnzdw  SRC_CLOUDINARY_API_KEY=…  SRC_CLOUDINARY_API_SECRET=…
DST_CLOUDINARY_NAME=dtmguwoam  DST_CLOUDINARY_API_KEY=…  DST_CLOUDINARY_API_SECRET=…
```

Two Neon branches to rewrite (build a `DATABASE_URL` for each from `.env`):
- **dev** branch — `ep-billowing-scene-aekcous9-pooler.c-2.us-east-2.aws.neon.tech`
- **prod main** branch — `ep-morning-cake-aehoae85-pooler.c-2.us-east-2.aws.neon.tech`

```
DATABASE_URL=postgresql://<user>:<pass>@<host>:5432/<db>?sslmode=require
```

## Order of operations

> All scripts default to **dry-run**. The destructive ones require an explicit
> `--apply`; nothing irreversible happens without it.

1. **Investigate (parallel, non-blocking).** In `console.cloudinary.com` with the
   `djrqmnzdw` creds → Settings → Account, record the owner email. Compare the
   newest asset date in `dtmguwoam/offer-letters` vs the oldest in `djrqmnzdw` to
   bracket when the backend creds were switched.

2. **Snapshot** (insurance — lists everything, copies nothing):
   ```
   SRC_…=… ts-node -r tsconfig-paths/register scripts/cloudinary-migrate.ts --dry-run
   ```
   → writes `manifest.json`.

3. **Migrate** the assets:
   ```
   SRC_…=… DST_…=… ts-node -r tsconfig-paths/register scripts/cloudinary-migrate.ts
   ```
   Re-runnable; skips already-copied assets. Then **spot-check one delivered URL
   per resource type** (an image, a video, a raw PDF) on `dtmguwoam`.

4. **Flip env + deploy folder-prefix on BOTH backend servers** (host env, not the
   repo `.env`): set `CLOUDINARY_NAME`/`API_KEY`/`API_SECRET` → `dtmguwoam`, add
   `CLOUDINARY_FOLDER_PREFIX` = `main` (prod server) / `dev` (dev server), deploy
   the `withEnvPrefix` change in `src/utils/cloudinary.ts`, and restart each.
   New uploads then land on `dtmguwoam` under `main/…`·`dev/…`.

5. **Delta sync — only after BOTH servers are flipped** (an un-flipped server
   keeps writing to `djrqmnzdw`):
   ```
   SRC_…=… DST_…=… ts-node -r tsconfig-paths/register scripts/cloudinary-migrate.ts
   ```

6. **Rewrite the DB — run per branch** (dev first, then prod main):
   ```
   DATABASE_URL=<dev>      ts-node -r tsconfig-paths/register scripts/cloudinary-db-rewrite.ts            # scan
   DATABASE_URL=<dev>      ts-node -r tsconfig-paths/register scripts/cloudinary-db-rewrite.ts --apply
   DATABASE_URL=<prodmain> ts-node -r tsconfig-paths/register scripts/cloudinary-db-rewrite.ts            # scan
   DATABASE_URL=<prodmain> ts-node -r tsconfig-paths/register scripts/cloudinary-db-rewrite.ts --apply
   ```
   The scan reports per-column row counts; `--apply` rewrites in one transaction
   and re-scans to confirm 0 `djrqmnzdw` references remain.

7. **Verify across the app** (against prod, post-rewrite): property images;
   offer-letter / notice / receipt / renewal-letter **PDFs** (the `raw` paths —
   most likely to break); a landlord logo/letterhead; a maintenance request with
   image **and** video; a chat file attachment; a KYC application's documents.
   All must load from `res.cloudinary.com/dtmguwoam/…`. New-upload smoke test:
   create a maintenance request with media on each server and confirm it lands
   under `dtmguwoam/main/…` (prod) / `dtmguwoam/dev/…` (dev).

8. **Decommission** (only after all green):
   ```
   SRC_…=… DST_…=… ts-node -r tsconfig-paths/register scripts/cloudinary-delete-source.ts            # dry run
   SRC_…=… DST_…=… ts-node -r tsconfig-paths/register scripts/cloudinary-delete-source.ts --apply
   ```
   Deletes from `djrqmnzdw` only assets confirmed present on `dtmguwoam`. Then
   close/abandon the `djrqmnzdw` account.

## Notes

- **No frontend change needed.** The signed maintenance uploader takes its cloud
  name from the backend signature response, so flipping backend env redirects it
  too. The frontend KYC uploader already points at `dtmguwoam`.
- **Forward-only folder separation.** The `main/`·`dev/` prefix applies to new
  uploads; the migrated backlog stays in its existing un-prefixed folders (we
  preserve `public_id` so the URL swap stays a simple cloud-name replace).
- **Rate limits.** The Admin API has an hourly cap; the migrate script paginates,
  throttles, retries 429s, and is resumable — just re-run if it stops.
