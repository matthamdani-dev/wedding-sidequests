import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

// Signed, httpOnly cookie for the admin backoffice. Separate cookie name and
// payload shape from guest_session (lib/server/guest-session.js) so the two
// can never be confused; no DB lookup needed since there's one static
// credential pair, not a per-guest session_epoch to check.

export const ADMIN_SESSION_COOKIE = "admin_session";
const MAX_AGE_SECONDS = 60 * 60 * 24; // 24h

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set.");
  return value;
}

function sign(payload) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function serializeCookie(name, value, { maxAge }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  parts.push(`Max-Age=${maxAge}`);
  return parts.join("; ");
}

export function buildAdminSessionCookie() {
  const exp = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = Buffer.from(JSON.stringify({ admin: true, exp })).toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  return serializeCookie(ADMIN_SESSION_COOKIE, token, { maxAge: MAX_AGE_SECONDS });
}

export function buildAdminLogoutCookie() {
  return serializeCookie(ADMIN_SESSION_COOKIE, "", { maxAge: 0 });
}

// Pure check — no DB, just signature + expiry. Shared by the RSC page
// (reads the cookie via next/headers) and API routes (reads the raw
// Cookie header).
export function isValidAdminToken(token) {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return false;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let a, b;
  try {
    a = Buffer.from(signature, "base64url");
    b = Buffer.from(sign(payload), "base64url");
  } catch {
    return false;
  }
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Boolean(data.admin) && typeof data.exp === "number" && Date.now() <= data.exp;
  } catch {
    return false;
  }
}

function getRequestCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

// For app/api/admin/* route handlers (standard Request, not NextRequest).
export function isAdminRequest(request) {
  return isValidAdminToken(getRequestCookie(request, ADMIN_SESSION_COOKIE));
}

// Convenience guard: `const denied = requireAdmin(request); if (denied) return denied;`
export function requireAdmin(request) {
  if (isAdminRequest(request)) return null;
  return Response.json({ error: "Admin sign-in required" }, { status: 401 });
}
