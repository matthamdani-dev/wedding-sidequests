# Nadya & Matthew — Wedding Missions

A mobile-first wedding social game built with JavaScript and the Next.js App Router. Guests find their name, complete photo or written missions, submit to the wedding wall, earn points, and view the leaderboard — backed by Supabase Postgres and Storage.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase + auth values, see docs/DATABASE.md
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:3000` for the guest app, `http://localhost:3000/admin` for the backoffice.

## Project structure

```text
app/
  admin/                 Backoffice page (server component: login or dashboard)
  api/                   REST endpoints — guests, missions, posts, submissions,
                          uploads, and /api/admin/* for the backoffice
  layout.js, page.js      App shell
components/
  wedding-missions.js    The guest app (one big client component)
  admin-login.js         Admin sign-in form
  admin-dashboard.js     Backoffice: Review (moderation), Missions, Guests
lib/
  client/                Browser-only persistence (offline progress cache)
  data/                  Seed fixtures (consumed by db/seed.mjs, not the UI)
  server/                wedding-repository.js (all SQL), db.js / storage.js
                          (Postgres / Supabase Storage clients), guest-session.js
                          / admin-session.js (signed cookies), admin-auth.js
db/
  migrations/            Ordered, once-each SQL migrations
  migrate.mjs, seed.mjs   npm run db:migrate / db:seed
docs/
  DATABASE.md            Schema, auth flow, upload flow, backoffice
public/
  openapi.yaml           Full API spec — browse at /api-docs.html
```

## Guest identity

No email/password. A guest searches for their name, then enters their
**room number** to claim it (`POST /api/guests/{id}/claim`), which issues a
signed `guest_session` cookie (~72h). Returning guests resume silently via
`GET /api/me`. Anyone who skips verification ("continue as guest") gets a
read-only experience — browsing is open, but submitting and earning points
require the session. Full flow in `docs/DATABASE.md`.

## Admin backoffice

`/admin`, single shared login (`ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH`,
bcrypt — **see `.env.example` for a `$`-escaping gotcha in local `.env`
files**). Three tabs:

- **Review** — moderate submissions: a swipeable card deck (swipe right to
  approve, left to reject) plus a list view with bulk approve/reject and
  permanent delete.
- **Missions** — add/edit/delete the card deck (text or photo, points, color).
- **Guests** — add/edit/delete guests, grant bonus points with a required
  note, reset a guest's claim.

## API routes

Backed by Supabase Postgres via `lib/server/wedding-repository.js`.

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/health` | GET | Deployment health check |
| `/api/guests?q=` | GET | Guest name search (max 8) |
| `/api/guests/{id}` | GET | Public guest lookup: guest, score, deck position (no auth) |
| `/api/guests/{id}/claim` | POST | Verify a room number, issue the `guest_session` cookie |
| `/api/me` | GET | Resume a returning, already-claimed guest from the cookie |
| `/api/me/progress` | PUT | Save the session's mission-deck position |
| `/api/me/logout` | POST | Clear the session cookie |
| `/api/missions` | GET | Active missions (the card deck) |
| `/api/posts` | GET | Wedding wall — approved submissions only |
| `/api/submissions` | POST | Submit a mission answer (requires session; created as `pending`) |
| `/api/uploads` | POST | Signed Supabase Storage upload URL (requires session) |
| `/api/leaderboard` | GET | Top 5 guests by points |
| `/api/admin/login`, `/logout` | POST | Admin sign-in / sign-out |
| `/api/admin/missions`, `/missions/{id}` | GET/POST/PUT/DELETE | Mission CRUD |
| `/api/admin/guests`, `/guests/{id}` | GET/POST/PUT/DELETE | Guest CRUD |
| `/api/admin/guests/{id}/points` | GET/POST | Points-adjustment history / grant |
| `/api/admin/guests/{id}/reset-claim` | POST | Invalidate a guest's session cookies |
| `/api/admin/submissions`, `/submissions/{id}` | GET/PATCH/DELETE | List / approve-or-reject / delete |
| `/api/admin/submissions/bulk` | POST | Bulk approve/reject |

Full request/response schemas: [`public/openapi.yaml`](public/openapi.yaml).
Browse it as Swagger UI at `/api-docs.html` (served statically; the spec loads
from `/openapi.yaml`).

## Still open

Not built yet: real-time wall updates (currently poll-on-tab-open), per-admin
accounts/audit trail (single shared login by design), CSV import for guests
or missions (use the Guests/Missions tabs, or `npm run db:seed` for bulk
local fixtures).
