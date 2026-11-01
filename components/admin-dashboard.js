"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useMotionValue, useTransform, AnimatePresence } from "motion/react";
import {
  CaretLeft,
  Check,
  CheckCircle,
  Coins,
  ImageSquare,
  ListBullets,
  PencilSimple,
  Plus,
  SignOut,
  Trash,
  X,
} from "@phosphor-icons/react";

const MISSION_COLORS = ["coral", "butter", "blue", "sage", "lilac", "rose"];
const EMPTY_MISSION = { kicker: "", title: "", note: "", points: 10, kind: "text", color: "coral", sortOrder: 0, active: true };
const EMPTY_GUEST = { name: "", roomNumber: "", table: "", relation: "", from: "" };

function initials(name) {
  return (name || "").split(" ").map((p) => p[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
}

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState("review");
  const [toast, setToast] = useState("");

  function showToast(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function logout() {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch {
      // Cookie expires on its own either way.
    }
    router.refresh();
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div><p className="eyebrow">Nadya &amp; Matthew</p><h1>Backoffice</h1></div>
        <button className="text-button admin-logout" onClick={logout}><SignOut /> Sign out</button>
      </header>

      <nav className="admin-tabs">
        <button className={tab === "review" ? "active" : ""} onClick={() => setTab("review")}>Review</button>
        <button className={tab === "missions" ? "active" : ""} onClick={() => setTab("missions")}>Missions</button>
        <button className={tab === "guests" ? "active" : ""} onClick={() => setTab("guests")}>Guests</button>
      </nav>

      <div className="admin-content">
        {tab === "review" && <ReviewPanel showToast={showToast} />}
        {tab === "missions" && <MissionsPanel showToast={showToast} />}
        {tab === "guests" && <GuestsPanel showToast={showToast} />}
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div className="toast" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
            <Check weight="bold" /> {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Review — swipe deck (mobile-friendly triage) + a list view for bulk work
// ---------------------------------------------------------------------------

function ReviewPanel({ showToast }) {
  const [status, setStatus] = useState("pending");
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("swipe");
  const [selected, setSelected] = useState(new Set());

  async function load() {
    setLoading(true);
    try {
      const data = await api(`/api/admin/submissions?status=${status}`);
      setSubmissions(data.submissions || []);
      setSelected(new Set());
    } catch {
      showToast("Could not load submissions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function act(id, action) {
    setSubmissions((list) => list.filter((s) => s.id !== id));
    try {
      if (action === "delete") {
        await api(`/api/admin/submissions/${id}`, { method: "DELETE" });
        showToast("Deleted");
      } else {
        await api(`/api/admin/submissions/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: action }),
        });
        showToast(action === "approved" ? "Approved — on the wall" : "Rejected");
      }
    } catch (err) {
      showToast(err.message);
      load();
    }
  }

  async function bulkApprove() {
    const ids = selected.size ? [...selected] : undefined;
    try {
      const { count } = await api("/api/admin/submissions/bulk", {
        method: "POST",
        body: JSON.stringify({ status: "approved", ids }),
      });
      showToast(`Approved ${count} submission${count === 1 ? "" : "s"}`);
      load();
    } catch (err) {
      showToast(err.message);
    }
  }

  function toggleSelected(id) {
    setSelected((set) => {
      const next = new Set(set);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <div className="admin-status-filter">
          {["pending", "approved", "rejected"].map((s) => (
            <button key={s} className={status === s ? "active" : ""} onClick={() => setStatus(s)}>{s}</button>
          ))}
        </div>
        <div className="admin-view-toggle">
          <button className={view === "swipe" ? "active" : ""} onClick={() => setView("swipe")} title="Swipe"><CardsIcon /></button>
          <button className={view === "list" ? "active" : ""} onClick={() => setView("list")} title="List"><ListBullets /></button>
        </div>
      </div>

      {loading ? (
        <p className="admin-empty">Loading…</p>
      ) : submissions.length === 0 ? (
        <p className="admin-empty">Nothing {status} right now.</p>
      ) : view === "swipe" ? (
        <SwipeDeck submissions={submissions} onAct={act} />
      ) : (
        <>
          {status === "pending" && (
            <div className="admin-bulk-bar">
              <button className="primary-button" onClick={bulkApprove}>
                {selected.size ? `Approve selected (${selected.size})` : "Approve all pending"}
              </button>
            </div>
          )}
          <ul className="admin-submission-list">
            {submissions.map((s) => (
              <li key={s.id}>
                {status === "pending" && (
                  <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelected(s.id)} />
                )}
                <SubmissionPreview submission={s} compact />
                <div className="admin-row-actions">
                  {status !== "approved" && <button onClick={() => act(s.id, "approved")} title="Approve"><CheckCircle weight="fill" /></button>}
                  {status !== "rejected" && <button onClick={() => act(s.id, "rejected")} title="Reject"><X weight="bold" /></button>}
                  <button onClick={() => act(s.id, "delete")} title="Delete"><Trash /></button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function CardsIcon() {
  // @phosphor-icons/react doesn't export a plain "cards" glyph under one
  // consistent name across versions — ImageSquare reads fine as a stand-in.
  return <ImageSquare />;
}

function SubmissionPreview({ submission, compact }) {
  const isImage = /^https?:\/\//.test(submission.mediaUrl || "") && !submission.mediaType?.startsWith("video/");
  const isVideo = /^https?:\/\//.test(submission.mediaUrl || "") && submission.mediaType?.startsWith("video/");
  return (
    <div className={compact ? "admin-sub-preview compact" : "admin-sub-preview"}>
      {!compact && (
        <div className="admin-sub-media">
          {isImage ? <img src={submission.mediaUrl} alt="" /> : isVideo ? <video src={submission.mediaUrl} muted loop playsInline /> : <span className="avatar">{submission.initials}</span>}
        </div>
      )}
      <div className="admin-sub-copy">
        <small>{submission.mission} · +{submission.points}</small>
        {submission.body && <p>{submission.body}</p>}
        <div className="admin-sub-guest"><span className="avatar small">{submission.initials}</span><span><strong>{submission.guestName}</strong><small>{submission.guestTable}</small></span></div>
      </div>
    </div>
  );
}

function SwipeDeck({ submissions, onAct }) {
  const current = submissions[0];
  if (!current) return <p className="admin-empty">All caught up.</p>;

  return (
    <div className="review-deck">
      <AnimatePresence>
        <SwipeCard
          key={current.id}
          submission={current}
          onApprove={() => onAct(current.id, "approved")}
          onReject={() => onAct(current.id, "rejected")}
          onDelete={() => onAct(current.id, "delete")}
        />
      </AnimatePresence>
      <p className="review-hint">Swipe right to approve, left to reject — or use the buttons.</p>
    </div>
  );
}

function SwipeCard({ submission, onApprove, onReject, onDelete }) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 220], [-14, 14]);
  const approveOpacity = useTransform(x, [20, 120], [0, 1]);
  const rejectOpacity = useTransform(x, [-120, -20], [1, 0]);

  function handleDragEnd(_event, info) {
    if (info.offset.x > 120) onApprove();
    else if (info.offset.x < -120) onReject();
  }

  return (
    <motion.article
      className="review-card"
      style={{ x, rotate }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.6}
      onDragEnd={handleDragEnd}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 300, damping: 26 }}
    >
      <motion.span className="review-flag approve" style={{ opacity: approveOpacity }}>Approve</motion.span>
      <motion.span className="review-flag reject" style={{ opacity: rejectOpacity }}>Reject</motion.span>
      <SubmissionPreview submission={submission} />
      <div className="review-actions">
        <button className="review-action reject" onClick={onReject}><X weight="bold" /></button>
        <button className="review-action delete" onClick={onDelete}><Trash /></button>
        <button className="review-action approve" onClick={onApprove}><CheckCircle weight="fill" /></button>
      </div>
    </motion.article>
  );
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

function MissionsPanel({ showToast }) {
  const [missions, setMissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // mission object, or EMPTY_MISSION for "new"

  async function load() {
    setLoading(true);
    try {
      const data = await api("/api/admin/missions");
      setMissions(data.missions || []);
    } catch {
      showToast("Could not load missions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save(form) {
    try {
      if (form.id) {
        await api(`/api/admin/missions/${form.id}`, { method: "PUT", body: JSON.stringify(form) });
      } else {
        await api("/api/admin/missions", { method: "POST", body: JSON.stringify(form) });
      }
      showToast("Saved");
      setEditing(null);
      load();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function remove(id) {
    try {
      await api(`/api/admin/missions/${id}`, { method: "DELETE" });
      showToast("Deleted");
      load();
    } catch (err) {
      showToast(err.message);
    }
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>Missions</h2>
        <button className="primary-button" onClick={() => setEditing(EMPTY_MISSION)}><Plus weight="bold" /> Add mission</button>
      </div>

      {loading ? (
        <p className="admin-empty">Loading…</p>
      ) : (
        <ul className="admin-mission-list">
          {missions.map((m) => (
            <li key={m.id} className={m.active ? "" : "inactive"}>
              <span className={`mission-color-dot ${m.color}`} />
              <div className="admin-mission-copy">
                <strong>{m.kicker}</strong>
                <small>{m.title}</small>
                <small>{m.kind === "photo" ? "Photo" : "Text"} · +{m.points} pts{!m.active && " · inactive"}</small>
              </div>
              <div className="admin-row-actions">
                <button onClick={() => setEditing(m)} title="Edit"><PencilSimple /></button>
                <button onClick={() => remove(m.id)} title="Delete"><Trash /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && <MissionForm mission={editing} onSave={save} onCancel={() => setEditing(null)} />}
    </section>
  );
}

function MissionForm({ mission, onSave, onCancel }) {
  const [form, setForm] = useState({ ...mission });
  const isNew = !form.id;

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  return (
    <div className="admin-modal-backdrop" onClick={onCancel}>
      <form className="admin-modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
        <h3>{isNew ? "Add mission" : "Edit mission"}</h3>
        <label className="admin-field">Kicker<input value={form.kicker} onChange={(e) => set("kicker", e.target.value)} placeholder="Find your twin" autoFocus /></label>
        <label className="admin-field">Title<input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="What the guest sees on the card" /></label>
        <label className="admin-field">Note<input value={form.note || ""} onChange={(e) => set("note", e.target.value)} placeholder="Optional flavour text" /></label>
        <div className="admin-field-row">
          <label className="admin-field">Points<input type="number" min="0" value={form.points} onChange={(e) => set("points", Number(e.target.value))} /></label>
          <label className="admin-field">
            Type
            <select value={form.kind} onChange={(e) => set("kind", e.target.value)}>
              <option value="text">Text</option>
              <option value="photo">Photo</option>
            </select>
          </label>
        </div>
        <label className="admin-field">
          Color
          <div className="admin-color-picker">
            {MISSION_COLORS.map((c) => (
              <button type="button" key={c} className={`mission-color-dot ${c} ${form.color === c ? "selected" : ""}`} onClick={() => set("color", c)} />
            ))}
          </div>
        </label>
        <label className="admin-field-inline"><input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} /> Active (visible to guests)</label>
        <div className="admin-modal-actions">
          <button type="button" className="text-button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary-button">Save</button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guests
// ---------------------------------------------------------------------------

function GuestsPanel({ showToast }) {
  const [query, setQuery] = useState("");
  const [guests, setGuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [pointsFor, setPointsFor] = useState(null);

  async function load(q = query) {
    setLoading(true);
    try {
      const data = await api(`/api/admin/guests?q=${encodeURIComponent(q)}`);
      setGuests(data.guests || []);
    } catch {
      showToast("Could not load guests");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => load(query), 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function save(form) {
    try {
      if (form.id) {
        await api(`/api/admin/guests/${form.id}`, { method: "PUT", body: JSON.stringify(form) });
      } else {
        await api("/api/admin/guests", { method: "POST", body: JSON.stringify(form) });
      }
      showToast("Saved");
      setEditing(null);
      load();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function remove(id) {
    try {
      await api(`/api/admin/guests/${id}`, { method: "DELETE" });
      showToast("Deleted");
      load();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function resetClaim(id) {
    try {
      await api(`/api/admin/guests/${id}/reset-claim`, { method: "POST" });
      showToast("Claim reset — they can re-verify");
      load();
    } catch (err) {
      showToast(err.message);
    }
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>Guests</h2>
        <button className="primary-button" onClick={() => setEditing(EMPTY_GUEST)}><Plus weight="bold" /> Add guest</button>
      </div>
      <label className="search-field admin-search"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name…" /></label>

      {loading ? (
        <p className="admin-empty">Loading…</p>
      ) : (
        <ul className="admin-guest-list">
          {guests.map((g) => (
            <li key={g.id}>
              <span className="avatar">{initials(g.name)}</span>
              <div className="admin-guest-copy">
                <strong>{g.name}</strong>
                <small>{g.table || "No table"} · Room {g.roomNumber || "—"}{g.claimedAt && " · claimed"}</small>
              </div>
              <div className="admin-row-actions">
                <button onClick={() => setPointsFor(g)} title="Add points"><Coins /></button>
                <button onClick={() => setEditing(g)} title="Edit"><PencilSimple /></button>
                {g.claimedAt && <button onClick={() => resetClaim(g.id)} title="Reset claim"><CaretLeft /></button>}
                <button onClick={() => remove(g.id)} title="Delete"><Trash /></button>
              </div>
            </li>
          ))}
          {guests.length === 0 && <p className="admin-empty">No guests match.</p>}
        </ul>
      )}

      {editing && <GuestForm guest={editing} onSave={save} onCancel={() => setEditing(null)} />}
      {pointsFor && <PointsForm guest={pointsFor} onDone={() => setPointsFor(null)} showToast={showToast} />}
    </section>
  );
}

function GuestForm({ guest, onSave, onCancel }) {
  const [form, setForm] = useState({ ...guest });
  const isNew = !form.id;

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  return (
    <div className="admin-modal-backdrop" onClick={onCancel}>
      <form className="admin-modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
        <h3>{isNew ? "Add guest" : "Edit guest"}</h3>
        <label className="admin-field">Name<input value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus /></label>
        <div className="admin-field-row">
          <label className="admin-field">Room number<input value={form.roomNumber || ""} onChange={(e) => set("roomNumber", e.target.value)} placeholder="214" /></label>
          <label className="admin-field">Table / seat<input value={form.table || ""} onChange={(e) => set("table", e.target.value)} placeholder="Peony · 04" /></label>
        </div>
        <label className="admin-field">Relation<input value={form.relation || ""} onChange={(e) => set("relation", e.target.value)} placeholder="Friend of the groom" /></label>
        <label className="admin-field">From<input value={form.from || ""} onChange={(e) => set("from", e.target.value)} placeholder="Jakarta" /></label>
        <div className="admin-modal-actions">
          <button type="button" className="text-button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary-button">Save</button>
        </div>
      </form>
    </div>
  );
}

function PointsForm({ guest, onDone, showToast }) {
  const [points, setPoints] = useState(10);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const data = await api(`/api/admin/guests/${guest.id}/points`, {
        method: "POST",
        body: JSON.stringify({ points: Number(points), note }),
      });
      showToast(`${points > 0 ? "+" : ""}${points} points · ${guest.name} now has ${data.score.points}`);
      onDone();
    } catch (err) {
      showToast(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-modal-backdrop" onClick={onDone}>
      <form className="admin-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Add points — {guest.name}</h3>
        <label className="admin-field">
          Points (use a negative number to correct a mistake)
          <input type="number" value={points} onChange={(e) => setPoints(e.target.value)} />
        </label>
        <label className="admin-field">
          Why? (shown in the points history)
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Best dressed at the reception" autoFocus />
        </label>
        <div className="admin-modal-actions">
          <button type="button" className="text-button" onClick={onDone}>Cancel</button>
          <button type="submit" className="primary-button" disabled={submitting || !note.trim()}>{submitting ? "Saving…" : "Add points"}</button>
        </div>
      </form>
    </div>
  );
}
