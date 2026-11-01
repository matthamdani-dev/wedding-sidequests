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

// ---------------------------------------------------------------------------
// Admin — missions (CRUD; everything here is backoffice-only)
// ---------------------------------------------------------------------------

const MISSION_COLORS = ["coral", "butter", "blue", "sage", "lilac", "rose"];
const MISSION_KINDS = ["photo", "text"];

function validateMissionInput(input, { partial = false } = {}) {
  const errors = [];
  const out = {};

  if (!partial || input.kicker !== undefined) {
    out.kicker = String(input.kicker || "").trim();
    if (!out.kicker) errors.push("kicker is required");
  }
  if (!partial || input.title !== undefined) {
    out.title = String(input.title || "").trim();
    if (!out.title) errors.push("title is required");
  }
  if (!partial || input.note !== undefined) {
    out.note = input.note ? String(input.note).trim() : null;
  }
  if (!partial || input.points !== undefined) {
    out.points = Number(input.points);
    if (!Number.isInteger(out.points) || out.points < 0) errors.push("points must be a non-negative integer");
  }
  if (!partial || input.kind !== undefined) {
    out.kind = input.kind;
    if (!MISSION_KINDS.includes(out.kind)) errors.push(`kind must be one of ${MISSION_KINDS.join(", ")}`);
  }
  if (!partial || input.color !== undefined) {
    out.color = input.color;
    if (!MISSION_COLORS.includes(out.color)) errors.push(`color must be one of ${MISSION_COLORS.join(", ")}`);
  }
  if (!partial || input.sortOrder !== undefined) {
    // sql(obj) (used by updateMission) picks properties by exact column
    // name, so this has to be snake_case to match the DB column.
    out.sort_order = Number.isInteger(Number(input.sortOrder)) ? Number(input.sortOrder) : 0;
  }
  if (!partial || input.active !== undefined) {
    out.active = input.active === undefined ? true : Boolean(input.active);
  }

  if (errors.length) throw new RepositoryError(errors.join("; "), 400);
  return out;
}

function toMissionAdmin(row) {
  return {
    id: Number(row.id),
    kicker: row.kicker,
    title: row.title,
    note: row.note,
    points: row.points,
    kind: row.kind,
    color: row.color,
    sortOrder: row.sort_order,
    active: row.active,
  };
}

export async function listMissionsForAdmin() {
  const rows = await sql`
    SELECT id, kicker, title, note, points, kind, color, sort_order, active
    FROM missions
    ORDER BY sort_order, id`;
  return rows.map(toMissionAdmin);
}

export async function createMission(input) {
  const m = validateMissionInput(input);
  const [row] = await sql`
    INSERT INTO missions (kicker, title, note, points, kind, color, sort_order, active)
    VALUES (${m.kicker}, ${m.title}, ${m.note}, ${m.points}, ${m.kind}, ${m.color}, ${m.sort_order}, ${m.active})
    RETURNING id, kicker, title, note, points, kind, color, sort_order, active`;
  return toMissionAdmin(row);
}

export async function updateMission(id, input) {
  const m = validateMissionInput(input, { partial: true });
  if (Object.keys(m).length === 0) throw new RepositoryError("Nothing to update", 400);

  const [row] = await sql`
    UPDATE missions SET ${sql(m)}
    WHERE id = ${id}
    RETURNING id, kicker, title, note, points, kind, color, sort_order, active`;
  if (!row) throw new RepositoryError("Mission not found", 404);
  return toMissionAdmin(row);
}

export async function deleteMission(id) {
  try {
    const [row] = await sql`DELETE FROM missions WHERE id = ${id} RETURNING id`;
    if (!row) throw new RepositoryError("Mission not found", 404);
  } catch (err) {
    if (err instanceof RepositoryError) throw err;
    if (err?.code === "23503") {
      throw new RepositoryError(
        "Can't delete a mission with existing submissions — mark it inactive instead.",
        409,
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Admin — guests (CRUD)
// ---------------------------------------------------------------------------

function toGuestAdmin(row) {
  return {
    id: row.id,
    name: row.name,
    roomNumber: row.room_number,
    table: row.table,
    relation: row.relation,
    from: row.hometown,
    claimedAt: row.claimed_at,
  };
}

export async function listGuestsForAdmin(query = "") {
  const q = query.trim().toLowerCase();
  const rows = q
    ? await sql`
        SELECT id, name, room_number, "table", relation, hometown, claimed_at
        FROM guests
        WHERE lower(name) LIKE ${"%" + q + "%"}
        ORDER BY name
        LIMIT 200`
    : await sql`
        SELECT id, name, room_number, "table", relation, hometown, claimed_at
        FROM guests
        ORDER BY name
        LIMIT 200`;
  return rows.map(toGuestAdmin);
}

function validateGuestInput(input, { partial = false } = {}) {
  const errors = [];
  const out = {};

  if (!partial || input.name !== undefined) {
    out.name = String(input.name || "").trim();
    if (!out.name) errors.push("name is required");
  }
  if (!partial || input.roomNumber !== undefined) {
    out.room_number = input.roomNumber ? String(input.roomNumber).trim() : null;
  }
  if (!partial || input.table !== undefined) {
    out.table = input.table ? String(input.table).trim() : null;
  }
  if (!partial || input.relation !== undefined) {
    out.relation = input.relation ? String(input.relation).trim() : null;
  }
  if (!partial || input.from !== undefined) {
    out.hometown = input.from ? String(input.from).trim() : null;
  }

  if (errors.length) throw new RepositoryError(errors.join("; "), 400);
  return out;
}

export async function createGuest(input) {
  const g = validateGuestInput(input);
  const [row] = await sql`
    INSERT INTO guests (name, room_number, "table", relation, hometown)
    VALUES (${g.name}, ${g.room_number ?? null}, ${g.table ?? null}, ${g.relation ?? null}, ${g.hometown ?? null})
    RETURNING id, name, room_number, "table", relation, hometown, claimed_at`;
  return toGuestAdmin(row);
}

export async function updateGuest(id, input) {
  const g = validateGuestInput(input, { partial: true });
  if (Object.keys(g).length === 0) throw new RepositoryError("Nothing to update", 400);

  const [row] = await sql`
    UPDATE guests SET ${sql(g)}
    WHERE id = ${id}
    RETURNING id, name, room_number, "table", relation, hometown, claimed_at`;
  if (!row) throw new RepositoryError("Guest not found", 404);
  return toGuestAdmin(row);
}

export async function deleteGuest(id) {
  const [row] = await sql`DELETE FROM guests WHERE id = ${id} RETURNING id`;
  if (!row) throw new RepositoryError("Guest not found", 404);
}

// Invalidates every outstanding session cookie for this guest (e.g. they
// lost access to their room, or someone else claimed by mistake) without
// touching their name/score history.
export async function resetGuestClaim(id) {
  const [row] = await sql`
    UPDATE guests SET claimed_at = NULL, session_epoch = session_epoch + 1
    WHERE id = ${id}
    RETURNING id`;
  if (!row) throw new RepositoryError("Guest not found", 404);
}

// ---------------------------------------------------------------------------
// Admin — bonus points (non-mission adjustments)
// ---------------------------------------------------------------------------

export async function addPointAdjustment(guestId, { points, note }) {
  const amount = Number(points);
  if (!Number.isInteger(amount) || amount === 0) {
    throw new RepositoryError("points must be a non-zero integer", 400);
  }
  const cleanNote = String(note || "").trim();
  if (!cleanNote) throw new RepositoryError("A note explaining the points is required", 400);

  const [guest] = await sql`SELECT id FROM guests WHERE id = ${guestId}`;
  if (!guest) throw new RepositoryError("Guest not found", 404);

  const [row] = await sql`
    INSERT INTO point_adjustments (guest_id, points, note)
    VALUES (${guestId}, ${amount}, ${cleanNote})
    RETURNING id, points, note, created_at`;

  return { adjustment: row, score: await getGuestScore(guestId) };
}

export async function getPointAdjustments(guestId) {
  const rows = await sql`
    SELECT id, points, note, created_at
    FROM point_adjustments
    WHERE guest_id = ${guestId}
    ORDER BY created_at DESC`;
  return rows;
}

// ---------------------------------------------------------------------------
// Admin — submission moderation
// ---------------------------------------------------------------------------

const SUBMISSION_STATUSES = ["pending", "approved", "rejected"];

export async function listSubmissionsForAdmin({ status } = {}) {
  const rows =
    status && SUBMISSION_STATUSES.includes(status)
      ? await sql`
          SELECT
            s.id, s.body, s.media_url, s.media_type, s.points, s.status,
            s.created_at, s.reviewed_at,
            g.id AS guest_id, g.name AS guest_name, g."table" AS guest_table,
            m.kicker AS mission_kicker, m.color AS mission_color
          FROM submissions s
          JOIN guests g ON g.id = s.guest_id
          JOIN missions m ON m.id = s.mission_id
          WHERE s.status = ${status}
          ORDER BY s.created_at DESC
          LIMIT 300`
      : await sql`
          SELECT
            s.id, s.body, s.media_url, s.media_type, s.points, s.status,
            s.created_at, s.reviewed_at,
            g.id AS guest_id, g.name AS guest_name, g."table" AS guest_table,
            m.kicker AS mission_kicker, m.color AS mission_color
          FROM submissions s
          JOIN guests g ON g.id = s.guest_id
          JOIN missions m ON m.id = s.mission_id
          ORDER BY s.created_at DESC
          LIMIT 300`;

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    body: r.body,
    mediaUrl: r.media_url,
    mediaType: r.media_type,
    points: r.points,
    mission: r.mission_kicker,
    tone: r.mission_color,
    guestId: r.guest_id,
    guestName: r.guest_name,
    guestTable: r.guest_table,
    initials: initials(r.guest_name),
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
  }));
}

export async function setSubmissionStatus(id, status) {
  if (!SUBMISSION_STATUSES.includes(status)) {
    throw new RepositoryError(`status must be one of ${SUBMISSION_STATUSES.join(", ")}`, 400);
  }
  const [row] = await sql`
    UPDATE submissions SET status = ${status}, reviewed_at = now()
    WHERE id = ${id}
    RETURNING id, guest_id`;
  if (!row) throw new RepositoryError("Submission not found", 404);
  return { id: row.id, guestId: row.guest_id };
}

export async function bulkSetSubmissionStatus({ ids, status }) {
  if (!SUBMISSION_STATUSES.includes(status)) {
    throw new RepositoryError(`status must be one of ${SUBMISSION_STATUSES.join(", ")}`, 400);
  }

  const rows =
    Array.isArray(ids) && ids.length > 0
      ? await sql`
          UPDATE submissions SET status = ${status}, reviewed_at = now()
          WHERE id = ANY(${ids})
          RETURNING id`
      : await sql`
          UPDATE submissions SET status = ${status}, reviewed_at = now()
          WHERE status = 'pending'
          RETURNING id`;

  return { count: rows.length };
}

// Permanently removes a submission. Returns the mediaUrl (if any) so the
// caller can best-effort clean up the Storage object too.
export async function deleteSubmission(id) {
  const [row] = await sql`DELETE FROM submissions WHERE id = ${id} RETURNING id, media_url`;
  if (!row) throw new RepositoryError("Submission not found", 404);
  return { id: row.id, mediaUrl: row.media_url };
}
