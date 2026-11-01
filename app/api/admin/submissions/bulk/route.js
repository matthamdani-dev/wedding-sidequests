import { bulkSetSubmissionStatus, RepositoryError } from "@/lib/server/wedding-repository";
import { requireAdmin } from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";

// Body: { status: "approved" | "rejected", ids?: string[] }
// ids omitted (or empty) + status "approved" => "Approve all pending".
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
    const result = await bulkSetSubmissionStatus({ ids: body.ids, status: body.status });
    return Response.json(result);
  } catch (err) {
    if (err instanceof RepositoryError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("bulkSetSubmissionStatus failed", err);
    return Response.json({ error: "Could not update submissions" }, { status: 500 });
  }
}
