import {
  getGuestProgress,
  getGuestScore,
  RepositoryError,
  verifyGuestClaim,
} from "@/lib/server/wedding-repository";
import { buildSessionCookie } from "@/lib/server/guest-session";

export const dynamic = "force-dynamic";

// Verifies the guest's room number and, on success, issues the signed
// session cookie. Folds in the usual bootstrap (score + progress) so the
// frontend doesn't need a second round trip right after claiming.
export async function POST(request, { params }) {
  const { id } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const { guest, sessionEpoch } = await verifyGuestClaim(id, body.roomNumber);
    const [score, progress] = await Promise.all([getGuestScore(id), getGuestProgress(id)]);

    const res = Response.json({ guest, score, progress });
    res.headers.append("Set-Cookie", buildSessionCookie({ guestId: id, sessionEpoch }));
    return res;
  } catch (err) {
    if (err instanceof RepositoryError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("verifyGuestClaim failed", err);
    return Response.json({ error: "Could not verify" }, { status: 500 });
  }
}
