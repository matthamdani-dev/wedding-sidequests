import {
  createMission,
  listMissionsForAdmin,
  RepositoryError,
} from "@/lib/server/wedding-repository";
import { requireAdmin } from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  return Response.json({ missions: await listMissionsForAdmin() });
}

export async function POST(request) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const mission = await createMission(body);
    return Response.json({ mission }, { status: 201 });
  } catch (err) {
    if (err instanceof RepositoryError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("createMission failed", err);
    return Response.json({ error: "Could not create mission" }, { status: 500 });
  }
}
