# Nadya & Matthew — Wedding Missions

A mobile-first wedding social game built with JavaScript and the Next.js App Router. Guests find their table, complete photo or written missions, post to the wedding wall, earn points, and view the leaderboard.

## Getting started

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Project structure

```text
app/
  api/                  REST endpoints for guests, missions, posts and scores
  layout.js             App metadata and viewport
  page.js               Server-rendered page entry
components/
  wedding-missions.js   Interactive mobile wedding game
lib/
  client/               Browser-only persistence
  data/                 Seed data for the prototype
  server/               Backend repository boundary
docs/
  DATABASE.md           Suggested shared data model and upload flow
```

## Current behavior

- Guest lookup uses seeded data.
- Missions, demo wall posts, and leaderboard data are separated from the UI.
- Progress persists locally in the guest's browser.
- Route handlers provide backend-ready API contracts.
- Photo selection opens the native mobile camera or photo picker.

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
| `/api/leaderboard` | GET | Top 5 guests by points |

Guest identity has no email/password: a guest picks their name, then enters
their **room number** to claim it (`/api/guests/{id}/claim`). See
`docs/DATABASE.md` for the full auth flow.

Full request/response schemas: [`public/openapi.yaml`](public/openapi.yaml).
Browse it as Swagger UI at `/api-docs.html` (served statically; the spec loads
from `/openapi.yaml`).

## Connecting the production backend

Replace the temporary functions in `lib/server/wedding-repository.js` with database queries. The UI and route handlers can keep the same contracts. See `docs/DATABASE.md` for the recommended tables and upload flow.

Before the wedding, add guest authentication, object storage, moderation, durable scoring, and real-time wall updates.
