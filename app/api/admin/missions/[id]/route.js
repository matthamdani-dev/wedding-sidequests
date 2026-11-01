import { deleteMission, RepositoryError, updateMission } from "@/lib/server/wedding-repository";
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
    const mission = await updateMission(Number(id), body);
    return Response.json({ mission });
  } catch (err) {
    if (err instanceof RepositoryError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("updateMission failed", err);
    return Response.json({ error: "Could not update mission" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const { id } = await params;
  try {
    await deleteMission(Number(id));
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof RepositoryError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("deleteMission failed", err);
    return Response.json({ error: "Could not delete mission" }, { status: 500 });
  }
}
