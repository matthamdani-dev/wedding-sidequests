import "server-only";

import bcrypt from "bcryptjs";

// Single shared admin login (no admin_users table) — ADMIN_USERNAME +
// ADMIN_PASSWORD_HASH (bcrypt) from env. Intended for the couple to share;
// not tied to any guest record.
export async function verifyAdminCredentials(username, password) {
  const expectedUsername = process.env.ADMIN_USERNAME;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!expectedUsername || !passwordHash) return false;
  if (typeof username !== "string" || typeof password !== "string") return false;
  if (username !== expectedUsername) return false;

  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    return false;
  }
}
