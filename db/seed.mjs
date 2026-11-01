// Seeds missions + guests from lib/data/wedding-data.js, plus a couple of
// approved submissions so the wall and leaderboard render before a real
// party. Idempotent: re-running upserts rather than duplicating.
//
//   npm run db:seed
import { guests, missions } from "../lib/data/wedding-data.js";
import { createClient } from "./client.mjs";

// wedding-data.js has no room numbers; supply demo ones here so the claim
// check (guest enters their room number) has something to verify against.
const demoRoomNumbers = {
  "guest-nadya": "101",
  "guest-matthew": "101",
  "guest-bride-test": "102",
  "guest-alex": "205",
  "guest-sophie": "210",
  "guest-daniel": "214",
};

const sql = createClient();

try {
  await sql.begin(async (tx) => {
    // --- missions -------------------------------------------------------
    for (const [index, m] of missions.entries()) {
      await tx`
        INSERT INTO missions (id, kicker, title, note, points, kind, color, sort_order, active)
        VALUES (${m.id}, ${m.kicker}, ${m.title}, ${m.note}, ${m.points},
                ${m.kind}, ${m.color}, ${index + 1}, true)
        ON CONFLICT (id) DO UPDATE SET
          kicker = EXCLUDED.kicker,
          title  = EXCLUDED.title,
          note   = EXCLUDED.note,
          points = EXCLUDED.points,
          kind   = EXCLUDED.kind,
          color  = EXCLUDED.color,
          sort_order = EXCLUDED.sort_order,
          active = EXCLUDED.active
      `;
    }
    // Keep the identity sequence ahead of the explicit ids we just inserted.
    await tx`
      SELECT setval(
        pg_get_serial_sequence('missions', 'id'),
        (SELECT COALESCE(MAX(id), 1) FROM missions)
      )
    `;

    // --- guests -------------------------------------------------------
    for (const g of guests) {
      const roomNumber = demoRoomNumbers[g.id] ?? null;
      await tx`
        INSERT INTO guests (id, name, room_number, "table", relation, hometown)
        VALUES (${g.id}, ${g.name}, ${roomNumber}, ${g.table}, ${g.relation}, ${g.from})
        ON CONFLICT (id) DO UPDATE SET
          name        = EXCLUDED.name,
          room_number = EXCLUDED.room_number,
          "table"     = EXCLUDED."table",
          relation    = EXCLUDED.relation,
          hometown    = EXCLUDED.hometown
      `;
    }

    // --- a few approved submissions ---------------------------------
    const [{ count }] = await tx`SELECT COUNT(*)::int AS count FROM submissions`;
    if (count === 0) {
      const demo = [
        { guest: "guest-sophie", mission: 1, kind: "text", body: "We absolutely did not plan this 🍒" },
        { guest: "guest-daniel", mission: 2, kind: "text", body: "Always order two desserts. Sharing one is a trap." },
        { guest: "guest-alex", mission: 3, kind: "text", body: "Dahlia meets Sweet Pea!" },
      ];
      for (const d of demo) {
        const [m] = await tx`SELECT points FROM missions WHERE id = ${d.mission}`;
        await tx`
          INSERT INTO submissions (guest_id, mission_id, kind, body, points, status, reviewed_at)
          VALUES (${d.guest}, ${d.mission}, ${d.kind}, ${d.body}, ${m.points}, 'approved', now())
        `;
      }
    }
  });

  console.log("seed complete");
} finally {
  await sql.end();
}
