import "server-only";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Lazy singleton, same pattern as lib/server/db.js: never throw at import
// time (so `next build` doesn't need Supabase Storage env vars), only when a
// caller actually tries to use it.
const globalForStorage = globalThis;

export class StorageError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "StorageError";
    this.status = status;
  }
}

// Allowlist of content types accepted for wall submission proof.
export const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "video/mp4",
  "video/quicktime",
];

function bucketName() {
  return process.env.SUPABASE_WALL_BUCKET || "wall-media";
}

function makeClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new StorageError(
      "Supabase Storage is not configured. Set SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY in the Vercel project settings (or " +
        ".env.local for local dev).",
      500,
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

function getClient() {
  if (!globalForStorage.__weddingSupabase) {
    globalForStorage.__weddingSupabase = makeClient();
  }
  return globalForStorage.__weddingSupabase;
}

// Keeps the object path readable (and safe for Storage) without leaking the
// original filename's weirdness: lowercase, swap anything that isn't
// alnum/dot/dash for a dash, collapse repeats, trim length.
function sanitizeFilename(filename) {
  const base = String(filename || "upload")
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (base || "upload").slice(0, 80);
}

// Builds a one-time signed upload target for a wall submission's photo or
// video. The bucket is expected to be configured public-read (see
// docs/DATABASE.md "Supabase Storage setup") so the computed publicUrl works
// immediately after upload with no extra signing step on read.
export async function createWallUploadTarget({ filename, contentType }) {
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new StorageError(
      `Unsupported file type: ${contentType || "unknown"}`,
      400,
    );
  }

  const client = getClient();
  const bucket = bucketName();
  const path = `${crypto.randomUUID()}-${sanitizeFilename(filename)}`;

  const { data, error } = await client.storage
    .from(bucket)
    .createSignedUploadUrl(path);

  if (error) {
    throw new StorageError(`Could not create upload URL: ${error.message}`, 500);
  }

  const { data: publicData } = client.storage.from(bucket).getPublicUrl(path);

  return {
    uploadUrl: data.signedUrl,
    path,
    token: data.token,
    publicUrl: publicData.publicUrl,
  };
}
