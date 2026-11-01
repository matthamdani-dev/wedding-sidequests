import { saveGuestProgress } from "@/lib/server/wedding-repository";
import { getSessionGuestId } from "@/lib/server/guest-session";

export const dynamic = "force-dynamic";

// Replaces PUT /api/guests/[id]/progress — the guest id comes from the
// session cookie now, not the URL, so a guest can only ever save their
// own deck position.
export async function PUT(request) {
  const guestId = await getSessionGuestId(request);
  if (!guestId) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const missionIndex = Number(body.missionIndex);
  if (!Number.isInteger(missionIndex) || missionIndex < 0) {
    return Response.json(
      { error: "missionIndex must be a non-negative integer" },
      { status: 400 },
    );
  }

  await saveGuestProgress(guestId, { missionIndex });
  return Response.json({ ok: true });
}
