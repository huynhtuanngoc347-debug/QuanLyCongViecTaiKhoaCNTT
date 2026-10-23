# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Faculty task-management system (Khoa Công nghệ Thông tin). All UI text, error messages, comments and docs are **Vietnamese** — keep it that way. The user communicates in Vietnamese.

**No abbreviations in user-facing text:** always write "Khoa Công nghệ Thông tin", never "Khoa CNTT" / "CNTT" (UI, page titles, `document.title`, messages, docs). Internal identifiers (DB name `QLCongViecKhoaCNTT`, folder `khoa-cntt`, logger names) stay as they are.

## Commands

Run from the repo root (npm workspaces). Windows / PowerShell environment.

```powershell
npm install
npm run build          # shared → api → web → mobile (order matters: api/web import @khoa/shared dist)
npm start              # API on :5080, also serves apps/web/dist (one port for everything)
npm run dev:api        # NestJS watch mode on :5080 (builds shared first)
npm run dev:web        # Vite on :5173, proxies /api → :5080
npm run typecheck      # all workspaces
npm test               # API unit tests (node:test): core.test.ts + regression.test.ts
npm run smoke          # read-only HTTP checks against a running API (4 demo accounts)
npm run regression     # HTTP regression checks for QA_AUDIT_REPORT.md bugs (needs running API)
```

Single test (API): compile then filter by name —
`cd apps/api; npx tsc -p tsconfig.test.json; node --test --test-name-pattern="BUG-P1-01" dist-test/regression.test.js`

Demo task data (destructive — deletes ALL tasks; back up first): `sqlcmd -S localhost -E -d <db> -f 65001 -b -i tools/seed-demo-tasks.sql`, then `node tools/seed-demo-files.mjs --db <db> [--uploads <dir>]` to generate real .docx/.xlsx/.pdf sample files (PDF via headless Edge, no Office needed) and attach them to every result submission.

`smoke`/`regression` accept `node tools/smoke.mjs <baseUrl> <password>`; default password is the shared demo one in README. They log in, which writes audit rows — run write-heavy checks against a DB copy, not the real DB.

The API serves the **built** web bundle: after changing `apps/web`, run `npm run build -w @khoa/web` (no API restart needed). After changing `apps/api` or `packages/shared`, rebuild and restart `npm start`.

## Architecture

- `apps/api` — NestJS 11 on Express, **hand-written SQL** (no ORM) via `mssql` (`msnodesqlv8` for Windows auth). Config from `apps/api/.env` (`config.ts`; process env overrides `.env`).
- `apps/web` — React 19 + Vite, `createHashRouter` (all routes are `#/...`), TanStack Query. Used on both desktop **and phones** (responsive, breakpoint ≤720px).
- `packages/shared/src/index.ts` — all DTO types shared by API and web. Change a response shape here first.
- `apps/mobile` — retired separate phone app. Not served anymore: `/m/...` returns a redirect page (`common/mobile-redirect.ts`) to the matching web route. Do not add features there.
- `sql/` — incremental DB scripts (02–06), idempotent, additive only. The API detects optional tables at runtime (`OBJECT_ID(...) IS NOT NULL`) so it still runs if a script wasn't applied (pattern: `HAS_DECLINE_TABLE` in `tasks/task-policy.ts`, `session-revocation.ts`).

### API request flow

1. `main.ts`: `securityHeaders`, `/m` redirect, static web, global `AuthGuard` + `ApiExceptionFilter` (`app.module.ts`).
2. `auth/auth.guard.ts`: every non-`@Public()` request re-checks the DB — account active, password fingerprint (`fp` in JWT) unchanged, session id (`sid`) not revoked (`dbo.PhienDaThuHoi`). Web uses httpOnly cookies `khoa_at` (15 min) / `khoa_rt` (7 days, path `/api/auth`); `X-Client: mobile` gets tokens in the body + Bearer.
   Forgot password (public): `POST /api/auth/quen-mat-khau` emails a 6-digit code (HMAC stored in `dbo.MaDatLaiMatKhau`, sql/06; 10 min, 5 tries, 60 s resend gap, same reply whether or not the email exists), `POST /api/auth/dat-lai-mat-khau` sets the new password. Mail via SMTP (`SMTP_*` in `.env`, `common/mailer.ts`); without `SMTP_HOST`/`SMTP_PASS` the code is only logged (non-production).
3. Controllers are thin; business logic lives in `*.commands.ts` (writes) and `*.queries.ts` (reads).
4. Commands return `Result<T>` (`common/result.ts`: `ok / invalid / invalidField / forbidden / notFound / conflict`); controllers call `unwrap()`. Field errors become `400 { message, errors: { field: "thông báo" } }`, which the web shows next to each input.

### Database access (`db/db.service.ts`)

- `db.read(fn)` for reads; `db.tx(userId, fn)` for writes. `tx` sets `SESSION_CONTEXT('MaNguoiDung')` so DB triggers (e.g. `TR_CongViec_GhiLichSu`) record the actor, and retries on deadlock — the work function must be safely re-runnable.
- Array params `IN @list` are expanded automatically (Dapper-style). Use `SYSUTCDATETIME()` in SQL for timestamps (CHECK constraints compare dates).
- Dates: DB stores UTC; business dates are Vietnam time (UTC+7) — use helpers in `common/vn-time.ts` (`parseVnDate`, `toLocal`, …).

### Permissions model

`tasks/task-access.ts` `loadRights()` → `TaskRights` with unit sets `createUnits / assignUnits / reviewUnits / reportUnits` derived from the user's positions (chức vụ) and memberships. `viewUnits` = union of those. Visibility of a task goes through `Q.loadVisible(db, rights, taskId)`; policy checks (`canManage`, `canDecideExtension`, …) are in `tasks/task-policy.ts`. Always enforce permissions server-side; the web only hides UI.

On the web, `nav.ts` `useAccess()` mirrors these capabilities for menus and `canOpen(path)`. `DESKTOP_ONLY` routes show a "use a computer" screen on phones; system-admin-only accounts are blocked entirely on phones (phones are for task assigners/assignees).

### Web UI conventions

- CSS load order (in `main.tsx`): `public/styles.css` (base, **read-only file — never modify it or remove the attribute**), then `styles-scale.css → gv.css → theme.css → typography.css → mobile.css → motion.css`. Put overrides in the later files.
- Phone layout lives in `mobile.css` + `layout/Shell.tsx` (compact top bar with bell/avatar, bottom tab bar). Requirement: nothing may need horizontal scrolling on a phone.
- `historyIndex.ts` must run before `createHashRouter` (fixes unsaved-changes guard on Back for typed URLs).
- File links must go through `openFile()` in `api/client.ts` (refreshes an expired session before opening/downloading).
- Statistics periods: `tasks/period.ts` — "Tháng này / Năm học (01/08–31/07, default) / Tùy chọn". Semester was intentionally removed.

### Files and uploads

Uploaded file content is stored on disk at `UPLOADS_PATH` (default `apps/api/App_Data/uploads`, gitignored); the DB (`TepDinhKem.DuongDan = "upload:<random>"`) only holds metadata. Moving to another machine requires copying that folder with the DB. Optional S3-compatible store (Backblaze B2 / Cloudflare R2): set `S3_*` in `.env`; `tasks/file-store.ts` then pushes files after a successful transaction (`offload`, local copy kept if the push fails), reads disk-first then S3 (`openStored`), deletes both (`removeStored`). Object key = the random name after `upload:`, so DB rows are unchanged; `node tools/upload-to-s3.mjs` moves files still on disk. Sample-data files (`/demo/...`) have no content (`downloadable: false`).

## QA artifacts

`QA_AUDIT_REPORT.md` tracks every found bug (BUG-P1-xx…), fix status and evidence; `qa-evidence/` holds the test scripts and outputs. Write-flow tests (`qa-evidence/phase3/workflow.mjs`, `revoke.mjs`) refuse to run against port 5080 — run them against an API instance pointed at a DB copy (`QLCongViecKhoaCNTT_QA`).

## Secrets

`apps/api/.env`, `.env.bak`, `env-windows.txt` contain real secrets and are gitignored — never commit or print them.
