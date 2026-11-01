import {
  addPointAdjustment,
  getPointAdjustments,
  RepositoryError,
} from "@/lib/server/wedding-repository";
import { requireAdmin } from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";

// History of bonus-point adjustments for this guest (for transparency —
// "why does this guest have 40 extra points?").
export async function GET(request, { params }) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const { id } = await params;
  return Response.json({ adjustments: await getPointAdjustments(id) });
}

// Grants (or deducts, with a negative value) bonus points unrelated to any
// mission. Always requires a note explaining why.
export async function POST(request, { params }) {
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
    const result = await addPointAdjustment(id, body);
    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof RepositoryError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("addPointAdjustment failed", err);
    return Response.json({ error: "Could not add points" }, { status: 500 });
  }
}
