import { listSubmissionsForAdmin } from "@/lib/server/wedding-repository";
import { requireAdmin } from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || undefined;
  const submissions = await listSubmissionsForAdmin({ status });
  return Response.json({ submissions });
}
