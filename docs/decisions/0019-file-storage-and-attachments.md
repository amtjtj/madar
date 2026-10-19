# 0019 — File storage and attachments

- Status: Accepted (updates ADR 0006 on storage and downloads)
- Date: 2026-10-19

## Context
Phase 2, step 11 (`docs/plans/phase-2-step-11.md`), from the team review (`docs/feedback/1405-07-27-team-review.md`, section 5). People need to attach contracts, screenshots and reports to tasks and comments. Letters (step 12), chat (15) and meeting minutes (13) will need the same. The pilot runs on one server (ADR 0016) with a nightly backup, and nothing may depend on a foreign service.

## Decision
- **One table for every attachment.** `attachments` holds the subject, the uploader, a sanitized display name, the extension, the MIME type we serve it with, the size, a SHA-256 hash, the object key, status, `attached_at`, `deleted_at` and `purged_at`.
  - The subject is `task` or `comment` for now, and is null while the file is a fresh upload.
  - The table has forced RLS and a composite FK on the uploader. The app role has no DELETE grant.
  - The subject is polymorphic, so the API checks it exists in the same company.
- **Storage behind `FileStorage`.**
  - `local` is the default: the `files-data` volume in production, `.data/files` in development.
  - `s3` is any S3-compatible service, such as an Iranian cloud storage or MinIO.
  - Keys are built only by the server: `tenants/{tenantId}/{yyyy}/{mm}/{uuid}`. A key that does not match is refused, and the local driver also refuses paths outside its folder.
  - The user's file name never reaches a path.
- **Two-step upload.**
  1. `POST /api/uploads` streams one multipart file (busboy) into a temp file. On the way it counts the bytes and stops at the company limit (`tenants.settings.files.maxSizeMb`: default 25, owner-set from 1 to 100), hashes the file and keeps the first bytes. The file then moves into storage as a `pending` row that only its uploader sees.
  2. Attaching (`POST /api/tasks/:id/attachments`, or `attachmentIds` on a new comment) binds only the person's own pending uploads, in the order they picked them.
  - Letters, messages and minutes will add only their own step 2.
- **Allowlist by content.**
  - The allowed extensions are: images (jpg, png, webp, gif), PDF, Office and OpenDocument files, txt, csv, zip, mp3, m4a and mp4.
  - Each file must also match its type's signature (`fileTypeFor`). A renamed HTML page, an SVG or an executable is refused with 415.
  - Plain text files may not start with markup.
- **Downloads stream through the API.**
  - `GET /api/attachments/:id/file` checks, on every request, that the person can see the task the file belongs to, directly or through a live comment.
  - The response headers are:
    - `Content-Type` from our allowlist, never from the uploader's browser;
    - `X-Content-Type-Options: nosniff`, and a `sandbox` CSP on everything except an inline PDF (browsers refuse to show a PDF in a sandboxed document, so it gets `default-src 'none'; frame-ancestors 'none'` and runs in the browser's isolated viewer);
    - `Content-Disposition` with a UTF-8 name, `inline` only for images and PDF (with `?inline=1`);
    - `Cache-Control: private, no-cache`, so a deleted file is not shown from the cache.
  - This replaces the signed URLs of ADR 0006. The request stays on the same origin, so CSP and Caddy are unchanged, the storage is never exposed, and no URL can leak. Signed redirects can come back later if traffic needs them.
- **Deletion and cleanup.**
  - The uploader, or anyone who may edit the task, deletes a file. It is a soft delete, audited as `attachment.deleted`, with a line in the task history.
  - The worker's 15-minute job removes from storage: deleted files, uploads left unattached for 24 hours, and files whose comment or task was deleted.
    - It claims rows with one conditional `UPDATE … FOR UPDATE SKIP LOCKED`, so a file attached meanwhile is never taken.
    - It removes the bytes only after that commits.
    - It marks the row `purged_at` and keeps it for the trail.
- **Backups.**
  - `backup.sh` archives the volume's `tenants/` folder next to each dump (`<name>.files.tar.gz`). The restore check reads the archive back, and pruning removes a dump and its archive together.
  - `restore.sh` writes the files back and keeps the previous ones in `.before_restore`.
  - The demo reset clears the demo company's files.
- **Limits.**
  - Caddy caps `/api/uploads` at 110 MB and the rest of `/api` at 2 MB.
  - The API allows 60 uploads a minute per member, in memory, for a single API instance.
  - A member may hold at most 1 GB of unattached uploads.
- **Upload robustness.**
  - Every way an upload ends closes the temp file and settles the request once: finished, too large, bad body, or the client gone (the «لغو» button, a dropped connection).
  - A failed upload removes its temp file.
  - In production, temp files sit on the files volume (`UPLOAD_TMP_DIR`), so the move into storage is a rename. The folder is emptied when the API starts.

## Alternatives considered
- **S3/MinIO from day one:** another service on the pilot server, with no gain for one company on one machine. The driver is ready for when files outgrow the disk.
- **Presigned PUT straight to storage:** less load on the API, but the storage must then be reachable from browsers (a CSP change and a public endpoint), and the type and size checks run after the fact. That is too loose for a first version.
- **Storing files in PostgreSQL:** simple backups, but large dumps and a slower database. Files don't belong in the transactional store.
- **Server-side thumbnails and Office previews:** sharp or LibreOffice in the image means weight and attack surface. Images are shown with CSS (`object-fit`) instead, and PDFs open in the browser's viewer.
- **Virus scanning (ClamAV):** about 1 GB of RAM, deferred by the owner. The allowlist and signature check stand in until the server grows.
