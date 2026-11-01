"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LockSimple } from "@phosphor-icons/react";

export default function AdminLogin() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not sign in");
        return;
      }
      router.refresh();
    } catch {
      setError("Network hiccup — try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="admin-login-shell">
      <form className="admin-login-card" onSubmit={submit}>
        <div className="admin-login-icon"><LockSimple weight="duotone" /></div>
        <p className="eyebrow">Backoffice</p>
        <h2>Admin sign-in</h2>
        <label className="admin-field">
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </label>
        <label className="admin-field">
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <div className="admin-error">{error}</div>}
        <button className="primary-button full" type="submit" disabled={loading}>
          {loading ? "Checking…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
