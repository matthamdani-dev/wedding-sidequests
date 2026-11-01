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
- **guest_scores** (view) — leaderboard. `points = SUM(points) WHERE status <> 'rejected'`.
- **auth_attempts** — throttles the last-4-digits claim check.
- **guest_progress** — per-guest card position in the deck (UI convenience).

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

Points apply the moment a guest submits (`status = 'pending'`). An admin
rejection deducts them (row moves to `rejected`, dropped from the view's sum).
`approved` / `rejected` are **admin-only** states — never returned by any
guest-facing endpoint.

## Wall + moderation

Every submission starts `pending`. The public wall query returns
`status = 'approved'` only. The backoffice lists submissions by status with
checkbox multi-select, plus **"Approve selected"** and **"Approve all pending"**
bulk actions (`UPDATE submissions SET status='approved', reviewed_at=now()
WHERE id = ANY($1)` / `WHERE status='pending'`).

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

Separate path (`app/(admin)/…`, `app/api/admin/…`), guarded by middleware and
its own session cookie. **Single admin account** from env — `ADMIN_USERNAME` +
`ADMIN_PASSWORD_HASH` (bcrypt); no `admin_users` table. Functions: CSV import
for guests and missions (**upsert, never delete** — match guests on phone then
name+table, missions on id/title; validate → dry-run preview → commit),
submission moderation, reset a guest's claim, manual points adjustment.
