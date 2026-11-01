import {
  deleteSubmission,
  RepositoryError,
  setSubmissionStatus,
} from "@/lib/server/wedding-repository";
import { requireAdmin } from "@/lib/server/admin-session";
import { deleteWallObjectByPublicUrl } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

// Approve or reject one submission — this is the swipe-card action (swipe
// right -> approved, swipe left -> rejected). Rejecting deducts the
// guest's points (guest_scores excludes status = 'rejected').
export async function PATCH(request, { params }) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const { id } = await params;
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await setSubmissionStatus(id, body.status);
    return Response.json(result);
  } catch (err) {
    if (err instanceof RepositoryError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("setSubmissionStatus failed", err);
    return Response.json({ error: "Could not update submission" }, { status: 500 });
  }
}

// Permanently removes a submission (and its uploaded file, best-effort) —
// for genuinely bad content, not routine moderation.
export async function DELETE(request, { params }) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const { id } = await params;
  try {
    const { mediaUrl } = await deleteSubmission(id);
    await deleteWallObjectByPublicUrl(mediaUrl);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof RepositoryError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("deleteSubmission failed", err);
    return Response.json({ error: "Could not delete submission" }, { status: 500 });
  }
}
