import { buildLogoutCookie } from "@/lib/server/guest-session";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", buildLogoutCookie());
  return res;
}
