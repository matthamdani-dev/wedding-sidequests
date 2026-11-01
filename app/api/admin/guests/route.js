import {
  createGuest,
  listGuestsForAdmin,
  RepositoryError,
} from "@/lib/server/wedding-repository";
import { requireAdmin } from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const guests = await listGuestsForAdmin(searchParams.get("q") || "");
  return Response.json({ guests });
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
    const guest = await createGuest(body);
    return Response.json({ guest }, { status: 201 });
  } catch (err) {
    if (err instanceof RepositoryError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("createGuest failed", err);
    return Response.json({ error: "Could not create guest" }, { status: 500 });
  }
}
