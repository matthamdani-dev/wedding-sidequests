import { buildAdminLogoutCookie } from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", buildAdminLogoutCookie());
  return res;
}
