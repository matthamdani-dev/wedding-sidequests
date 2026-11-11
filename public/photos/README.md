# Photos

Drop the welcome-screen portrait photos here — any filename, any common
format (jpg/png/heic all fine). Once they're in, tell me and I'll wire them
into the welcome screen's polaroid frames (replacing the "N"/"M" placeholders
in `components/wedding-missions.js`) and adjust sizing/cropping as needed.

Portrait-oriented (taller than wide) crops best to the 4:5 polaroid frame,
but anything works — it'll be cropped to fit via `object-fit: cover`.

Everything in this folder is served publicly at `/photos/<filename>` once
deployed, same as any other file under `public/`.
