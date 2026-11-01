import { verifyAdminCredentials } from "@/lib/server/admin-auth";
import { buildAdminSessionCookie } from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ok = await verifyAdminCredentials(body.username, body.password);
  if (!ok) {
    return Response.json({ error: "Incorrect username or password" }, { status: 401 });
  }

  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", buildAdminSessionCookie());
  return res;
}
