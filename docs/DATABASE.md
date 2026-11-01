# Database

Backend: **Supabase Postgres**, talked to through plain SQL (`postgres` driver)
behind `lib/server/wedding-repository.js`. The repository's exported functions
are the stable seam — API routes and the UI never import `lib/data/*` or run
SQL directly once the backend is live.

## Connections

| Env var | Supabase source | Used by |
| --- | --- | --- |
| `DATABASE_URL` | Transaction pooler, port 6543 | Next app at runtime (serverless-safe; no prepared statements) |
| `DIRECT_URL` | Direct connection, port 5432 | `npm run db:migrate`, `npm run db:seed` (multi-statement transactions) |

## Commands

```
npm run db:migrate   # apply db/migrations/*.sql in order, once each
npm run db:seed      # upsert missions + guests from lib/data/wedding-data.js
```

Migrations are tracked in `schema_migrations`. Add a new `NNN_name.sql` file to
evolve the schema; never edit an applied migration.

## Schema (001_init.sql)

- **guests** — `name`, `phone`, `room_number`, `table`, `relation`,
  `hometown`, `claimed_at`, `session_epoch`. `id` is `text`: seed rows keep
  slugs, imported rows get a uuid. `session_epoch` is embedded in the guest
  cookie; an admin "reset claim" bumps it to invalidate outstanding cookies.
- **missions** — the card-deck content. `kicker`, `title`, `note`, `points`,
  `kind` (`photo`|`text`), `color` (checked set), `sort_order`, `active`.
  `id` is identity so the backoffice can create missions.
- **submissions** — one guest's answer to one mission. `body` (text answer)
  and/or `media_url` (photo in Supabase Storage), `points` snapshot,
  `status` (`pending`|`approved`|`rejected`), `reviewed_at`.
- **guest_scores** (view) — leaderboard. `points = SUM(submissions.points WHERE
  status <> 'rejected') + SUM(point_adjustments.points)`.
- **auth_attempts** — throttles the room-number claim check.
- **guest_progress** — per-guest card position in the deck (UI convenience).
- **point_adjustments** (003) — admin-granted bonus points unrelated to any
  mission (e.g. "best dressed"). `points` (can be negative, to correct a
  mistake), `note` (required — shown in the points history), `created_at`.
  Kept separate from `submissions` since these aren't guest-authored content
  and need no moderation.

## Guest auth (name claim)

No email/password. During onboarding the guest picks their name, then enters
their **room number**, checked case-insensitively against `guests.room_number`
(`POST /api/guests/{id}/claim`). On success a signed cookie (`AUTH_SECRET`,
`guest_session`) carrying `guest_id` + `session_epoch` is issued (~72h) and
`claimed_at` is set. Not device-locked — claiming from a second device with
the right room number issues it its own valid session. `GET /api/me` resumes
a returning guest from the cookie without re-verifying.

Throttling is "light touch": hard lock on a name after ~20 failed attempts
(`auth_attempts.locked_until`, 2h). Guests who can't verify (name not found,
no room number on file, or they skip via "continue as guest") get a
**read-only** experience — browse missions, wall, and leaderboard, but
`POST /api/submissions` and `PUT /api/me/progress` both require the session
cookie, so they can't submit or earn points.

The **guest CSV must include a room_number column** or those guests can't
self-verify.

## Scoring

Points apply the moment a guest submits, regardless of status. An admin
rejection deducts them (row moves to `rejected`, dropped from the view's sum).
`pending` / `approved` / `rejected` are **admin-only** states — never
returned by any guest-facing endpoint (the guest UI never mentions review or
moderation at all; see below).

## Wall + moderation

Only **photo** submissions need a human look — they're the only kind that
can show something off-brand on the wall, so they start `status = 'pending'`.
**Text** submissions auto-approve immediately (`status = 'approved'` on
insert, no `reviewed_at`) since there's nothing to moderate there; this also
keeps the admin Review queue to just photos. The public wall query returns
`status = 'approved'` only, so text submissions appear on the wall instantly
while photos wait for approval.

The backoffice's Review tab has two views:

- **Swipe deck** (default, mobile-friendly) — one pending submission at a
  time; swipe right to approve, left to reject, or use the on-screen buttons.
  Built with `motion`'s drag gesture (`PATCH /api/admin/submissions/{id}`).
- **List view** — all submissions for a status, with checkbox multi-select
  and **"Approve selected"** / **"Approve all pending"** bulk actions
  (`POST /api/admin/submissions/bulk`, `UPDATE ... WHERE id = ANY($1)` /
  `WHERE status = 'pending'`).

Either view can also **permanently delete** a submission
(`DELETE /api/admin/submissions/{id}`) for genuinely bad content — distinct
from reject, which keeps the row (and the audit trail) but excludes it from
scoring. Delete also best-effort removes the uploaded file from Storage.

## Upload flow (wall photos)

1. Client asks `POST /api/uploads` (filename, contentType, sizeBytes; requires
   a guest session) for a signed upload URL (Supabase Storage,
   `SUPABASE_WALL_BUCKET`, `lib/server/storage.js`). The route rejects
   unsupported types and files over the size cap before ever contacting
   Storage.
2. File uploads directly to the bucket via `PUT <uploadUrl>` with the file's
   `Content-Type` header — the Next server never sees the file bytes.
3. The returned public object URL (`publicUrl`) is submitted with the
   mission answer as `mediaUrl`/`mediaType`.
4. Server validates guest session, mission, file type/size, sets `media_url`
   and the `points` snapshot, inserts `status = 'pending'`.

Allowed content types: `image/jpeg`, `image/png`, `image/webp`, `image/heic`,
`video/mp4`, `video/quicktime`. Size caps: 15MB for photos, 60MB for video
(enforced both client-side before upload and server-side in
`POST /api/uploads`) — generous enough for a phone photo/HEIC shot or a short
1080p clip, small enough to not choke venue wifi.

### Supabase Storage setup (manual — not scriptable from here)

The bucket must be created by hand in the Supabase dashboard; there's no
service-role key in this environment to do it from code.

1. **Storage → New bucket**, name it to match `SUPABASE_WALL_BUCKET`
   (default `wall-media`).
2. Mark it **public**. Wedding wall photos aren't sensitive, and public-read
   means the stored `publicUrl` works immediately for `<img>`/`<video>` tags
   and the wall feed with no per-request signing — simpler than
   private+signed-read for a one-night, low-stakes app. (Uploads themselves
   still go through a one-time signed *upload* URL from the service-role
   key, so random clients still can't write to the bucket — only reads are
   public.)
3. Fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Project Settings →
   API) in both `.env.local` (local dev) and the Vercel project's
   Environment Variables (for every deployed environment this app uses).
   `SUPABASE_WALL_BUCKET` only needs setting if the bucket name differs from
   the default `wall-media`.

## Backoffice (admin)

`app/admin/page.js` (one route — a server component that checks the
`admin_session` cookie and renders `AdminLogin` or `AdminDashboard`) plus
`app/api/admin/*`. **Single shared admin account** from env —
`ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` (bcrypt, see `.env.example` for the
`$`-escaping gotcha in local `.env` files); no `admin_users` table, so there's
no per-admin identity or audit trail by design.

No middleware: each `/api/admin/*` route checks `requireAdmin(request)`
itself (`lib/server/admin-session.js`), the same per-route pattern the guest
session uses — avoids relying on Node APIs (`node:crypto`) inside Next's
Edge-runtime middleware.

Three tabs in the dashboard:

- **Review** — submission moderation (swipe deck + list), described above.
- **Missions** — full CRUD. Deleting a mission with existing submissions is
  blocked (`409`, FK `ON DELETE RESTRICT`) with a prompt to mark it inactive
  instead.
- **Guests** — full CRUD (add/edit/delete; this is also how guests get into
  the system at all beyond the local seed script — there's no CSV import in
  this pass), **Add points** (opens a form asking the amount and a required
  note, `POST /api/admin/guests/{id}/points`), and **Reset claim**
  (`POST /api/admin/guests/{id}/reset-claim` — bumps `session_epoch` and
  clears `claimed_at`, invalidating every outstanding `guest_session` cookie
  for that guest without touching their name or score history).
