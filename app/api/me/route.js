import { getGuestById, getGuestProgress, getGuestScore } from "@/lib/server/wedding-repository";
import { getSessionGuestId } from "@/lib/server/guest-session";

export const dynamic = "force-dynamic";

// Resumes a returning, already-claimed guest from the session cookie —
// lets the frontend skip straight to the game screen without re-verifying.
export async function GET(request) {
  const guestId = await getSessionGuestId(request);
  if (!guestId) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const guest = await getGuestById(guestId);
  if (!guest) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const [score, progress] = await Promise.all([
    getGuestScore(guestId),
    getGuestProgress(guestId),
  ]);

  return Response.json({ guest, score, progress });
}
