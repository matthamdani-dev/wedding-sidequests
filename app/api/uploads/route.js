import {
  ALLOWED_CONTENT_TYPES,
  createWallUploadTarget,
  StorageError,
} from "@/lib/server/storage";
import { getSessionGuestId } from "@/lib/server/guest-session";

export const dynamic = "force-dynamic";

// Size limits for wall submission proof. Photos are compressed by phone
// cameras in most cases, 15MB covers a raw/HEIC shot with margin. Video is
// capped lower than most phone defaults to keep uploads from a venue wifi
// reasonable; 60MB is roughly a 30-60s 1080p clip.
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

export async function POST(request) {
  const guestId = await getSessionGuestId(request);
  if (!guestId) {
    return Response.json({ error: "Verify your name to upload" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const { filename, contentType, sizeBytes } = body;

    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return Response.json(
        { error: `Unsupported file type: ${contentType || "unknown"}` },
        { status: 400 },
      );
    }

    const isVideo = contentType.startsWith("video/");
    const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
    const size = Number(sizeBytes);
    if (!Number.isFinite(size) || size <= 0) {
      return Response.json({ error: "Missing file size" }, { status: 400 });
    }
    if (size > maxBytes) {
      return Response.json(
        {
          error: isVideo
            ? "Video is too large (max 60MB)"
            : "Photo is too large (max 15MB)",
        },
        { status: 400 },
      );
    }

    const target = await createWallUploadTarget({ filename, contentType });
    return Response.json(target, { status: 201 });
  } catch (err) {
    if (err instanceof StorageError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("createWallUploadTarget failed", err);
    return Response.json({ error: "Could not create upload URL" }, { status: 500 });
  }
}
