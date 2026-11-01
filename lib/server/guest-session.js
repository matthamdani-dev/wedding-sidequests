import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { getGuestSessionEpoch } from "@/lib/server/wedding-repository";

// Signed, httpOnly cookie identifying a claimed guest. No session table:
// the cookie carries { guestId, sessionEpoch, exp }, HMAC-signed with
// AUTH_SECRET. Every read re-checks sessionEpoch against the guest's
// current row, so an admin's future "reset claim" (bumping that column)
// invalidates every outstanding cookie for that guest instantly.

export const GUEST_SESSION_COOKIE = "guest_session";
const MAX_AGE_SECONDS = 60 * 60 * 72; // 72h — covers the wedding weekend

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set.");
  return value;
}

function sign(payload) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
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

function serializeCookie(name, value, { maxAge }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  parts.push(`Max-Age=${maxAge}`);
  return parts.join("; ");
}

// Returns a Set-Cookie header value. Caller does:
//   res.headers.append("Set-Cookie", buildSessionCookie({ guestId, sessionEpoch }));
export function buildSessionCookie({ guestId, sessionEpoch }) {
  const exp = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = Buffer.from(JSON.stringify({ guestId, sessionEpoch, exp })).toString(
    "base64url",
  );
  const token = `${payload}.${sign(payload)}`;
  return serializeCookie(GUEST_SESSION_COOKIE, token, { maxAge: MAX_AGE_SECONDS });
}

export function buildLogoutCookie() {
  return serializeCookie(GUEST_SESSION_COOKIE, "", { maxAge: 0 });
}

function readToken(token) {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let a, b;
  try {
    a = Buffer.from(signature, "base64url");
    b = Buffer.from(sign(payload), "base64url");
  } catch {
    return null;
  }
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.guestId || !data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

// Verifies the cookie's signature + expiry, then checks sessionEpoch
// against the database. Returns the guestId, or null if there's no valid
// session (missing, expired, forged, or invalidated by a claim reset).
export async function getSessionGuestId(request) {
  const token = getRequestCookie(request, GUEST_SESSION_COOKIE);
  const data = readToken(token);
  if (!data) return null;

  const currentEpoch = await getGuestSessionEpoch(data.guestId);
  if (currentEpoch === null || currentEpoch !== data.sessionEpoch) return null;
  return data.guestId;
}
