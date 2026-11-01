import "server-only";

import { sql } from "@/lib/server/db";

// All reads/writes for the app go through this module so API routes and the
// UI never touch SQL directly. Function signatures are the stable contract.

export class RepositoryError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "RepositoryError";
    this.status = status;
  }
}

function initials(name) {
  return (name || "")
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function toGuest(row) {
  return {
    id: row.id,
    name: row.name,
    table: row.table,
    relation: row.relation,
    from: row.hometown,
  };
}

// ---------------------------------------------------------------------------
// Guests
// ---------------------------------------------------------------------------

export async function searchGuests(query = "") {
  const q = query.trim().toLowerCase();
  const rows = q
    ? await sql`
        SELECT id, name, "table", relation, hometown
        FROM guests
        WHERE lower(name) LIKE ${"%" + q + "%"}
        ORDER BY name
        LIMIT 8`
    : await sql`
        SELECT id, name, "table", relation, hometown
        FROM guests
        ORDER BY name
        LIMIT 8`;
  return rows.map(toGuest);
}

export async function getGuestById(id) {
  const [row] = await sql`
    SELECT id, name, "table", relation, hometown, claimed_at
    FROM guests
    WHERE id = ${id}`;
  if (!row) return null;
  return { ...toGuest(row), claimedAt: row.claimed_at };
}

// Verifies a guest's room number and claims the name. Light-touch
// throttling: a name hard-locks after ~20 failed attempts. The caller
// (the claim route) issues the signed session cookie on success.
export async function verifyGuestClaim(guestId, roomNumber) {
  const clean = String(roomNumber || "").trim();
  if (!clean) {
    throw new RepositoryError("Enter your room number", 400);
  }

  const [guest] = await sql`
    SELECT id, name, room_number, session_epoch FROM guests WHERE id = ${guestId}`;
  if (!guest) throw new RepositoryError("Guest not found", 404);

  const [attempt] = await sql`
    SELECT failed_count, locked_until FROM auth_attempts WHERE guest_id = ${guestId}`;
  if (attempt?.locked_until && new Date(attempt.locked_until) > new Date()) {
    throw new RepositoryError("Too many attempts. Ask the welcome desk for help.", 429);
  }

  const matches =
    guest.room_number && guest.room_number.trim().toLowerCase() === clean.toLowerCase();

  if (!matches) {
    const failed = (attempt?.failed_count ?? 0) + 1;
    const lockedUntil = failed >= 20 ? sql`now() + interval '2 hours'` : null;
    await sql`
      INSERT INTO auth_attempts (guest_id, failed_count, locked_until, last_attempt_at)
      VALUES (${guestId}, ${failed}, ${lockedUntil}, now())
      ON CONFLICT (guest_id) DO UPDATE SET
        failed_count = ${failed},
        locked_until = ${lockedUntil},
        last_attempt_at = now()`;
    throw new RepositoryError("That doesn't match our list. Try again.", 401);
  }

  await sql`DELETE FROM auth_attempts WHERE guest_id = ${guestId}`;
  await sql`
    UPDATE guests SET claimed_at = COALESCE(claimed_at, now()) WHERE id = ${guestId}`;

  return { guest: await getGuestById(guestId), sessionEpoch: guest.session_epoch };
}

// Reads the guest's current session_epoch so a session cookie can be
// checked against it — an admin's future "reset claim" bumps this column,
// which invalidates any cookie already handed out without needing a
// server-side session table.
export async function getGuestSessionEpoch(guestId) {
  const [row] = await sql`SELECT session_epoch FROM guests WHERE id = ${guestId}`;
  return row ? row.session_epoch : null;
}

// ---------------------------------------------------------------------------
// Missions (the card-deck content)
// ---------------------------------------------------------------------------

export async function getMissions() {
  const rows = await sql`
    SELECT id, kicker, title, note, points, kind, color
    FROM missions
    WHERE active
    ORDER BY sort_order, id`;
  return rows.map((m) => ({ ...m, id: Number(m.id) }));
}

// ---------------------------------------------------------------------------
// Wall (approved submissions only)
// ---------------------------------------------------------------------------

export async function getWallPosts() {
  const rows = await sql`
    SELECT
      s.id, s.body, s.media_url, s.media_type, s.points, s.created_at,
      g.name  AS guest_name,
      g."table" AS guest_table,
      m.kicker AS mission_kicker,
      m.color  AS mission_color
    FROM submissions s
    JOIN guests   g ON g.id = s.guest_id
    JOIN missions m ON m.id = s.mission_id
    WHERE s.status = 'approved'
    ORDER BY s.created_at DESC
    LIMIT 100`;

  return rows.map((r) => ({
    id: r.id,
    name: r.guest_name,
    table: r.guest_table,
    mission: r.mission_kicker,
    body: r.body ?? "",
    mediaUrl: r.media_url,
    mediaType: r.media_type,
    tone: r.mission_color,
    initials: initials(r.guest_name),
    points: r.points,
  }));
}

// Creates a pending submission. Points count immediately (the leaderboard
// view sums everything that isn't rejected); an admin rejection deducts them.
export async function createSubmission({
  guestId,
  missionId,
  body = null,
  mediaUrl = null,
  mediaType = null,
}) {
  if (!guestId) throw new RepositoryError("Missing guest", 400);

  const [mission] = await sql`
    SELECT id, points, kind FROM missions WHERE id = ${missionId} AND active`;
  if (!mission) throw new RepositoryError("Unknown mission", 400);

  const [guest] = await sql`SELECT id FROM guests WHERE id = ${guestId}`;
  if (!guest) throw new RepositoryError("Unknown guest", 400);

  if (!body && !mediaUrl) {
    throw new RepositoryError("Add a photo or write an answer first", 400);
  }
  if (mission.kind === "photo" && !mediaUrl) {
    throw new RepositoryError("This mission needs a photo", 400);
  }
  if (mission.kind === "text" && !body) {
    throw new RepositoryError("This mission needs a written answer", 400);
  }

  const [row] = await sql`
    INSERT INTO submissions
      (guest_id, mission_id, kind, body, media_url, media_type, points, status)
    VALUES
      (${guestId}, ${missionId}, ${mission.kind}, ${body}, ${mediaUrl},
       ${mediaType}, ${mission.points}, 'pending')
    RETURNING id, created_at`;

  return {
    id: row.id,
    missionId: Number(mission.id),
    points: mission.points,
    status: "pending",
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Scores / leaderboard (guest_scores view = SUM(points) WHERE status <> 'rejected')
// ---------------------------------------------------------------------------

export async function getLeaderboard({ limit = 5 } = {}) {
  const rows = await sql`
    SELECT name, points
    FROM guest_scores
    WHERE points > 0
    ORDER BY points DESC, name
    LIMIT ${limit}`;
  return rows.map((r) => ({ name: r.name, points: r.points, initials: initials(r.name) }));
}

export async function getGuestScore(guestId) {
  const [row] = await sql`
    SELECT points, pending_count, approved_count
    FROM guest_scores
    WHERE guest_id = ${guestId}`;
  return {
    points: row?.points ?? 0,
    pendingCount: row?.pending_count ?? 0,
    approvedCount: row?.approved_count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Per-guest UI progress (card position in the deck)
// ---------------------------------------------------------------------------

export async function getGuestProgress(guestId) {
  const [row] = await sql`
    SELECT mission_index FROM guest_progress WHERE guest_id = ${guestId}`;
  return { missionIndex: row?.mission_index ?? 0 };
}

export async function saveGuestProgress(guestId, { missionIndex }) {
  await sql`
    INSERT INTO guest_progress (guest_id, mission_index)
    VALUES (${guestId}, ${missionIndex})
    ON CONFLICT (guest_id) DO UPDATE SET mission_index = EXCLUDED.mission_index`;
}
