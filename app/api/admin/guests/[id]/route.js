import { deleteGuest, RepositoryError, updateGuest } from "@/lib/server/wedding-repository";
import { requireAdmin } from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";

export async function PUT(request, { params }) {
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
    const guest = await updateGuest(id, body);
    return Response.json({ guest });
  } catch (err) {
    if (err instanceof RepositoryError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("updateGuest failed", err);
    return Response.json({ error: "Could not update guest" }, { status: 500 });
  }
}

// Deleting a guest cascades to their submissions and progress (see
// db/migrations/001_init.sql ON DELETE CASCADE) — irreversible.
export async function DELETE(request, { params }) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const { id } = await params;
  try {
    await deleteGuest(id);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof RepositoryError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("deleteGuest failed", err);
    return Response.json({ error: "Could not delete guest" }, { status: 500 });
  }
}
