"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Login failed.");
      }

      router.push("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      padding: "24px",
      background: "#0f172a",
      color: "#e5e7eb",
      fontFamily: "Arial, sans-serif",
    }}>
      <form onSubmit={handleSubmit} style={{
        width: "100%",
        maxWidth: "420px",
        padding: "28px",
        borderRadius: "20px",
        background: "#111827",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
      }}>
        <p style={{
          margin: "0 0 8px",
          color: "#93c5fd",
          fontSize: "12px",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          fontWeight: 700,
        }}>
          Protected Access
        </p>

        <h1 style={{ margin: "0 0 10px", fontSize: "28px" }}>
          Sign in to Flowboard
        </h1>

        <p style={{ margin: "0 0 22px", color: "#9ca3af", lineHeight: 1.6 }}>
          Enter your local Flowboard access password to continue.
        </p>

        <label htmlFor="password" style={{
          display: "block",
          marginBottom: "8px",
          fontSize: "14px",
          fontWeight: 700,
        }}>
          Password
        </label>

        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "13px 14px",
            borderRadius: "12px",
            border: "1px solid rgba(255,255,255,0.16)",
            background: "#020617",
            color: "#f9fafb",
            outline: "none",
            fontSize: "16px",
          }}
        />

        {error && (
          <div role="alert" style={{
            marginTop: "14px",
            padding: "12px",
            borderRadius: "12px",
            background: "rgba(239,68,68,0.12)",
            color: "#fecaca",
            border: "1px solid rgba(248,113,113,0.35)",
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || password.trim().length === 0}
          style={{
            width: "100%",
            marginTop: "18px",
            padding: "13px 16px",
            borderRadius: "12px",
            border: 0,
            background: loading ? "#475569" : "#2563eb",
            color: "white",
            fontWeight: 800,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Checking..." : "Continue"}
        </button>
      </form>
    </main>
  );
}
