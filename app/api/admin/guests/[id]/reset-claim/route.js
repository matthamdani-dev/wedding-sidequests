import { RepositoryError, resetGuestClaim } from "@/lib/server/wedding-repository";
import { requireAdmin } from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";

// Invalidates every outstanding guest_session cookie for this guest (bumps
// session_epoch) and clears claimed_at, so they can re-verify from scratch.
export async function POST(request, { params }) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const { id } = await params;
  try {
    await resetGuestClaim(id);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof RepositoryError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("resetGuestClaim failed", err);
    return Response.json({ error: "Could not reset claim" }, { status: 500 });
  }
}
