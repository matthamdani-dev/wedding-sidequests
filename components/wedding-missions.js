"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { loadProgress, saveProgress } from "@/lib/client/progress-storage";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CrownSimple,
  House,
  ImageSquare,
  MagnifyingGlass,
  PencilSimple,
  SkipForward,
  Sparkle,
  Trophy,
  UserCircle,
  UsersThree,
} from "@phosphor-icons/react";

function initials(name) {
  return (name || "")
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// Guests are often entered as a bare table number ("8", "12A") via the
// admin dashboard — prefix those with "Table " for display. Leaves
// anything already labeled ("Table 8") or descriptive ("Welcome desk",
// "Sweet Pea · 01") untouched so it doesn't get double- or mis-prefixed.
function formatTable(table) {
  if (!table) return table;
  const trimmed = table.trim();
  if (/^table\b/i.test(trimmed)) return trimmed;
  if (/^\d+[a-z]?$/i.test(trimmed)) return `Table ${trimmed}`;
  return trimmed;
}

export default function WeddingMissions() {
  const reduceMotion = useReducedMotion();
  const [bootstrapping, setBootstrapping] = useState(true);
  const [screen, setScreen] = useState("welcome");
  const [tab, setTab] = useState("missions");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selectedGuest, setSelectedGuest] = useState(null);
  const [verified, setVerified] = useState(false);
  const [roomNumber, setRoomNumber] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [missions, setMissions] = useState([]);
  const [missionIndex, setMissionIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [uploadName, setUploadName] = useState("");
  // Upload lifecycle for the current photo mission's file: "idle" (nothing
  // picked), "uploading", "done" (mediaUrl/mediaType below are ready to
  // submit), or "error" (uploadError has the message, submit stays blocked).
  const [uploadState, setUploadState] = useState("idle");
  const [uploadError, setUploadError] = useState("");
  const [mediaUrl, setMediaUrl] = useState(null);
  const [mediaType, setMediaType] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [points, setPoints] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [posts, setPosts] = useState([]);
  const [leaders, setLeaders] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState("");
  const [profile, setProfile] = useState({ relation: "Friend of the happy couple", from: "Jakarta" });
  const fileRef = useRef(null);

  // --- Resume a returning, already-claimed guest from the session cookie ---
  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        applyBootstrap(data);
        setVerified(true);
        setScreen("game");
      })
      .catch(() => {})
      .finally(() => setBootstrapping(false));
  }, []);

  // --- Card deck -------------------------------------------------------
  useEffect(() => {
    fetch("/api/missions")
      .then((r) => r.json())
      .then((d) => setMissions(d.missions || []))
      .catch(() => {});
  }, []);

  // --- Guest name search (debounced) ---------------------------------
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        fetch(`/api/guests?q=${encodeURIComponent(query)}`, { signal: controller.signal })
          .then((r) => r.json())
          .then((d) => setResults(d.guests || []))
          .catch(() => {});
      },
      query ? 220 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Keep a sensible highlighted result as the list changes.
  useEffect(() => {
    if (screen !== "lookup") return;
    setSelectedGuest((current) => {
      if (current && results.some((g) => g.id === current.id)) return current;
      return results[0] || null;
    });
  }, [results, screen]);

  // --- Wall + leaderboard load on demand ----------------------------
  useEffect(() => {
    if (tab !== "wall") return;
    fetch("/api/posts")
      .then((r) => r.json())
      .then((d) => setPosts(d.posts || []))
      .catch(() => {});
  }, [tab]);

  useEffect(() => {
    if (tab !== "leaders") return;
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((d) => setLeaders(d.leaders || []))
      .catch(() => {});
  }, [tab]);

  // --- Persist deck position (server for verified guests + offline cache) ---
  useEffect(() => {
    saveProgress({ points, missionIndex });
    if (!verified) return;
    const timer = setTimeout(() => {
      fetch("/api/me/progress", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionIndex }),
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [missionIndex, points, verified]);

  const mission = useMemo(
    () => (missions.length ? missions[missionIndex % missions.length] : null),
    [missions, missionIndex],
  );

  function applyBootstrap(data) {
    setSelectedGuest(data.guest);
    setProfile({ relation: data.guest.relation || "Guest", from: data.guest.from || "" });
    setPoints(data.score?.points || 0);
    setPendingCount(data.score?.pendingCount || 0);
    setMissionIndex(data.progress?.missionIndex || 0);
  }

  // Unverified path only ("Continue as guest") — no claim, no session, read-only.
  function enterAsGuest(guest) {
    setSelectedGuest(guest);
    setProfile({ relation: guest.relation || "Guest", from: guest.from || "" });
    setVerified(false);
    setScreen("game");
    const cached = loadProgress();
    if (cached) {
      setPoints(cached.points || 0);
      setMissionIndex(cached.missionIndex || 0);
    }
  }

  async function claimGuest() {
    if (!selectedGuest?.id || claiming) return;
    setClaiming(true);
    setVerifyError("");
    try {
      const res = await fetch(`/api/guests/${selectedGuest.id}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomNumber }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVerifyError(data.error || "Could not verify");
        return;
      }
      applyBootstrap(data);
      setVerified(true);
      setRoomNumber("");
      setScreen("game");
    } catch {
      setVerifyError("Network hiccup — try again");
    } finally {
      setClaiming(false);
    }
  }

  async function switchGuest() {
    try {
      await fetch("/api/me/logout", { method: "POST" });
    } catch {
      // Ignore — the cookie will just expire on its own.
    }
    setVerified(false);
    setSelectedGuest(null);
    setPoints(0);
    setPendingCount(0);
    setMissionIndex(0);
    setQuery("");
    setScreen("welcome");
  }

  function nextMission() {
    setMissionIndex((value) => (missions.length ? (value + 1) % missions.length : 0));
    setAnswer("");
    setUploadName("");
    setUploadState("idle");
    setUploadError("");
    setMediaUrl(null);
    setMediaType(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }

  function showToast(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  async function submitMission() {
    if (!mission || submitting) return;
    if (!verified) return showToast("Verify your name first to play");
    if (mission.kind === "photo" && !uploadName) return showToast("Add a photo first");
    if (mission.kind === "photo" && uploadState === "uploading") return showToast("Hang on, still uploading…");
    if (mission.kind === "photo" && uploadState === "error") return showToast(uploadError || "Upload failed — try again");
    if (mission.kind === "photo" && uploadState !== "done") return showToast("Add a photo first");
    if (mission.kind === "text" && !answer.trim()) return showToast("Write your answer first");

    setSubmitting(true);
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          missionId: mission.id,
          body: mission.kind === "text" ? answer.trim() : null,
          mediaUrl: mission.kind === "photo" ? mediaUrl : null,
          mediaType: mission.kind === "photo" ? mediaType : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Could not submit");
        return;
      }
      setPoints(data.score?.points ?? points + mission.points);
      setPendingCount(data.score?.pendingCount ?? pendingCount + 1);
      showToast(`+${mission.points} points · Submitted!`);
      nextMission();
    } catch {
      showToast("Network hiccup — try again");
    } finally {
      setSubmitting(false);
    }
  }

  const ALLOWED_UPLOAD_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "video/mp4",
    "video/quicktime",
  ];
  const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
  const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

  async function onFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
      showToast("That file type isn't supported — use a photo or short video");
      return;
    }
    const isVideo = file.type.startsWith("video/");
    const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
    if (file.size > maxBytes) {
      showToast(isVideo ? "Video is too large (max 60MB)" : "Photo is too large (max 15MB)");
      return;
    }

    setUploadName(file.name);
    setUploadState("uploading");
    setUploadError("");
    setMediaUrl(null);
    setMediaType(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });

    try {
      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        }),
      });
      const target = await res.json();
      if (!res.ok) throw new Error(target.error || "Could not start upload");

      const putRes = await fetch(target.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error("Upload failed — try again");

      setMediaUrl(target.publicUrl);
      setMediaType(file.type);
      setUploadState("done");
    } catch (err) {
      setUploadState("error");
      setUploadError(err.message || "Upload failed — try again");
      showToast(err.message || "Upload failed — try again");
    }
  }

  if (bootstrapping) {
    return <main className="welcome-shell" />;
  }

  if (screen === "welcome") {
    return (
      <main className="welcome-shell">
        <div className="paper-noise" />
        <motion.div className="date-stamp" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .25 }}>10—12 NOV 2026 · YARRA VALLEY</motion.div>
        <section className="welcome-grid">
          <motion.div className="portrait portrait-left" initial={{ opacity: 0, rotate: -12, x: -30 }} animate={{ opacity: 1, rotate: -6, x: 0 }} transition={{ duration: .8, ease: [0.2, 0.8, 0.2, 1] }}>
            <div className="photo-placeholder photo-real"><img src="/photos/bride-photo.jpeg" alt="Nadya" /></div><span>the bride</span>
          </motion.div>
          <motion.div className="welcome-copy" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .12, duration: .8 }}>
            <p className="eyebrow">You are cordially invited to cause</p>
            <h1><span>A little</span> mischief</h1>
            <div className="and-mark">&</div>
            <h1><span>make a lot of</span> memories</h1>
            <p className="couple-name">Nadya <i>&</i> Matthew</p>
            <button className="primary-button" onClick={() => setScreen("lookup")}>Enter the celebration <ArrowRight weight="bold" /></button>
            <p className="tiny-note">A wedding game made for our favourite people</p>
          </motion.div>
          <motion.div className="portrait portrait-right" initial={{ opacity: 0, rotate: 12, x: 30 }} animate={{ opacity: 1, rotate: 5, x: 0 }} transition={{ delay: .08, duration: .8, ease: [0.2, 0.8, 0.2, 1] }}>
            <div className="photo-placeholder photo-real"><img src="/photos/groom-photo.jpeg" alt="Matthew" /></div><span>the groom</span>
          </motion.div>
        </section>
        <motion.div className="scroll-cue" animate={reduceMotion ? {} : { y: [0, 5, 0] }} transition={{ repeat: Infinity, duration: 2 }}>Begin here <span>↓</span></motion.div>
      </main>
    );
  }

  if (screen === "lookup") {
    return (
      <main className="lookup-shell">
        <div className="paper-noise" />
        <button className="back-button" onClick={() => setScreen("welcome")}><ArrowLeft /> Back</button>
        <motion.section className="lookup-card" initial={{ opacity: 0, y: 20, rotate: -1 }} animate={{ opacity: 1, y: 0, rotate: 0 }}>
          <div className="lookup-number">01</div>
          <p className="eyebrow">First, tell us who you are</p>
          <h2>Find your name</h2>
          <p>We’ll find your table and save your progress for the night.</p>
          <label className="search-field"><MagnifyingGlass /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Start typing your name…" autoFocus /></label>
          <div className="guest-results">
            {results.slice(0, 4).map((guest) => (
              <button key={guest.id} className={selectedGuest?.id === guest.id ? "guest-row selected" : "guest-row"} onClick={() => setSelectedGuest(guest)}>
                <span className="avatar">{initials(guest.name)}</span><span><strong>{guest.name}</strong><small>{formatTable(guest.table)}</small></span>{selectedGuest?.id === guest.id && <Check weight="bold" />}
              </button>
            ))}
            {results.length === 0 && <div className="empty-search">No match yet. Try your first or last name.</div>}
          </div>
          <button className="primary-button full" disabled={!selectedGuest} onClick={() => { setVerifyError(""); setScreen("verify"); }}>That’s me <ArrowRight weight="bold" /></button>
          <button className="text-button" onClick={() => enterAsGuest({ name: query || "Wedding Guest", table: "Welcome desk", relation: "Guest", from: "" })}>Can’t find your name? Continue as guest</button>
        </motion.section>
      </main>
    );
  }

  if (screen === "verify") {
    return (
      <main className="lookup-shell">
        <div className="paper-noise" />
        <button className="back-button" onClick={() => setScreen("lookup")}><ArrowLeft /> Back</button>
        <motion.section className="lookup-card" initial={{ opacity: 0, y: 20, rotate: -1 }} animate={{ opacity: 1, y: 0, rotate: 0 }}>
          <div className="lookup-number">02</div>
          <p className="eyebrow">Just to be sure it’s you</p>
          <h2>Confirm your room</h2>
          <p>Hi {selectedGuest?.name}! Enter your room number to claim your spot and save your progress.</p>
          <label className="search-field">
            <input
              value={roomNumber}
              onChange={(e) => setRoomNumber(e.target.value)}
              placeholder="Room number"
              autoCapitalize="characters"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && claimGuest()}
            />
          </label>
          {verifyError && <div className="empty-search">{verifyError}</div>}
          <button className="primary-button full" disabled={!roomNumber.trim() || claiming} onClick={claimGuest}>
            {claiming ? "Checking…" : <>Confirm <ArrowRight weight="bold" /></>}
          </button>
        </motion.section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => setTab("missions")}><span>N</span><i>&</i><span>M</span></button>
        <div className="guest-chip"><span>{initials(selectedGuest?.name)}</span><div><small>{formatTable(selectedGuest?.table)}</small><strong>{selectedGuest?.name}</strong></div></div>
        <div className="points"><Sparkle weight="fill" /> {points} pts</div>
      </header>

      <AnimatePresence mode="wait">
        {tab === "missions" && (
          <motion.section className="mission-view" key="missions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {!mission ? (
              <div className="mission-heading"><div><p className="eyebrow">Your next assignment</p><h2>Loading missions…</h2></div></div>
            ) : (
              <>
                <div className="mission-heading"><div><p className="eyebrow">Your next assignment</p><h2>Wedding missions</h2></div><span>{String((missionIndex % missions.length) + 1).padStart(2, "0")} / {String(missions.length).padStart(2, "0")}</span></div>
                {!verified && <div className="empty-search">Browsing as a guest — find your name to earn points.</div>}
                <div className="deck-wrap">
                  <div className="ghost-card ghost-two" /><div className="ghost-card ghost-one" />
                  <AnimatePresence mode="popLayout">
                    <motion.article className={`mission-card ${mission.color}`} key={mission.id} initial={{ opacity: 0, x: 50, rotate: 5 }} animate={{ opacity: 1, x: 0, rotate: 0 }} exit={{ opacity: 0, x: -70, rotate: -7 }} transition={{ type: "spring", stiffness: 260, damping: 24 }}>
                      <div className="card-top"><span>{mission.kicker}</span><span className="point-sticker">+{mission.points}</span></div>
                      <div className="mission-icon">{mission.kind === "photo" ? <Camera weight="duotone" /> : <PencilSimple weight="duotone" />}</div>
                      <h3>{mission.title}</h3><p>{mission.note}</p>
                      {mission.kind === "photo" ? (
                        <>
                          <input ref={fileRef} className="file-input" type="file" accept="image/*,video/mp4,video/quicktime" capture="environment" onChange={onFile} />
                          {previewUrl && (
                            <div className="photo-preview">
                              {mediaType?.startsWith("video/") ? <video src={previewUrl} muted loop playsInline autoPlay /> : <img src={previewUrl} alt="" />}
                              {uploadState === "uploading" && <span className="photo-preview-status">Uploading…</span>}
                            </div>
                          )}
                          <button className={uploadState === "done" ? "upload-button uploaded" : "upload-button"} onClick={() => fileRef.current?.click()} disabled={uploadState === "uploading"}>
                            {uploadState === "uploading" ? <>Uploading…</> : uploadState === "done" ? <><Check weight="bold" /> Retake / choose another</> : uploadState === "error" ? <><Camera weight="bold" /> Try again</> : <><Camera weight="bold" /> Open camera</>}
                          </button>
                        </>
                      ) : (
                        <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Write something they’ll want to keep…" maxLength={280} />
                      )}
                      <button className="submit-button" onClick={submitMission} disabled={submitting || (mission.kind === "photo" && uploadState !== "done")}>{submitting ? "Sending…" : <>Submit <ArrowRight weight="bold" /></>}</button>
                    </motion.article>
                  </AnimatePresence>
                </div>
                <button className="skip-button" onClick={nextMission}><SkipForward /> Not this one — show me another</button>
              </>
            )}
          </motion.section>
        )}

        {tab === "wall" && (
          <motion.section className="content-view" key="wall" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="section-title"><p className="eyebrow">Live from the celebration</p><h2>The wedding wall</h2><p>Approved photos, stories, and questionable advice from everyone here.</p></div>
            {posts.length === 0 && <div className="empty-search">Nothing on the wall yet — approved submissions show up here.</div>}
            <div className="wall-grid">{posts.map((post, index) => <article className={`wall-post ${post.tone}`} key={post.id} style={{ transform: `rotate(${index % 2 ? 1 : -1}deg)` }}><div className="post-image">{/^https?:\/\//.test(post.mediaUrl || "") ? (post.mediaType?.startsWith("video/") ? <video src={post.mediaUrl} muted loop playsInline /> : <img src={post.mediaUrl} alt="" />) : (<><span>{post.initials}</span><ImageSquare weight="thin" /></>)}</div><div className="post-copy"><small>{post.mission} · +{post.points}</small><p>{post.body}</p><div><span className="avatar small">{post.initials}</span><span><strong>{post.name}</strong><small>{formatTable(post.table)}</small></span></div></div></article>)}</div>
          </motion.section>
        )}

        {tab === "leaders" && (
          <motion.section className="content-view leaderboard-view" key="leaders" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="section-title"><p className="eyebrow">Glory is temporary, photos are forever</p><h2>Tonight’s top five</h2><p>Complete missions, make memories, climb the table.</p></div>
            <div className="leaderboard-card">{leaders.map((leader, i) => <div className={`leader-row rank-${i + 1}`} key={leader.name}><span className="rank">{i === 0 ? <CrownSimple weight="fill" /> : i + 1}</span><span className="avatar">{leader.initials}</span><strong>{leader.name}</strong><span>{leader.points} pts</span></div>)}<div className="your-rank"><span className="rank">—</span><span className="avatar">{initials(selectedGuest?.name)}</span><strong>You</strong><span>{points} pts</span></div></div>
          </motion.section>
        )}

        {tab === "profile" && (
          <motion.section className="content-view profile-view" key="profile" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="profile-card"><div className="profile-portrait">{initials(selectedGuest?.name)}</div><p className="eyebrow">Guest profile</p><h2>{selectedGuest?.name}</h2><span className="table-pill">{formatTable(selectedGuest?.table)}</span><label>How do you know us?<input value={profile.relation} onChange={(e) => setProfile({ ...profile, relation: e.target.value })} /></label><label>Where are you from?<input value={profile.from} onChange={(e) => setProfile({ ...profile, from: e.target.value })} /></label><button className="primary-button full" onClick={() => showToast("Profile saved")}>Save profile <Check weight="bold" /></button>{verified && <button className="text-button" onClick={switchGuest}>Not you? Switch guest</button>}<p className="profile-note"><UsersThree /> Other guests can see this when they open your profile on the wall.</p></div>
          </motion.section>
        )}
      </AnimatePresence>

      <nav className="bottom-nav">
        <button className={tab === "missions" ? "active" : ""} onClick={() => setTab("missions")}><House weight={tab === "missions" ? "fill" : "regular"} /><span>Missions</span></button>
        <button className={tab === "wall" ? "active" : ""} onClick={() => setTab("wall")}><ImageSquare weight={tab === "wall" ? "fill" : "regular"} /><span>Wall</span></button>
        <button className={tab === "leaders" ? "active" : ""} onClick={() => setTab("leaders")}><Trophy weight={tab === "leaders" ? "fill" : "regular"} /><span>Leaders</span></button>
        <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}><UserCircle weight={tab === "profile" ? "fill" : "regular"} /><span>You</span></button>
      </nav>
      <AnimatePresence>{toast && <motion.div className="toast" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}><Check weight="bold" /> {toast}</motion.div>}</AnimatePresence>
    </main>
  );
}
