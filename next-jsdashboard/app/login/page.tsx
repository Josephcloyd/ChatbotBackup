"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
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
        body: JSON.stringify({ username, password }),
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
      background: "#f5eedb", // Lifewood beige paper
      color: "#133020", // Lifewood Dark Serpent
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      <form onSubmit={handleSubmit} style={{
        width: "100%",
        maxWidth: "420px",
        padding: "36px 30px",
        borderRadius: "20px",
        background: "#ffffff",
        border: "1px solid #d3cbb6",
        boxShadow: "0 10px 30px rgba(19, 48, 32, 0.08)",
      }}>
        {/* Lifewood Logo Visual Representation */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "26px" }}>
          <div style={{
            width: "28px",
            height: "28px",
            background: "#FFB347", // Saffron
            clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)", // Hexagon/Diamond brand mark
          }} />
          <span style={{
            fontSize: "24px",
            fontWeight: 800,
            letterSpacing: "-0.5px",
            color: "#046241", // Castleton Green
          }}>
            lifewood
          </span>
        </div>

        <h1 style={{ margin: "0 0 6px", fontSize: "22px", fontWeight: 800, letterSpacing: "-0.4px" }}>
          Production Planner
        </h1>

        <p style={{ margin: "0 0 24px", color: "#666666", fontSize: "14px", lineHeight: 1.5 }}>
          Log in with your operator or administrator credentials to manage schedules.
        </p>

        <div style={{ display: "grid", gap: "16px" }}>
          <div>
            <label htmlFor="username" style={{
              display: "block",
              marginBottom: "6px",
              fontSize: "12px",
              fontWeight: 700,
              color: "#666666",
            }}>
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              placeholder="e.g. operator1"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "11px 12px",
                borderRadius: "10px",
                border: "1px solid #d3cbb6",
                background: "#f9f7f7",
                color: "#133020",
                outline: "none",
                fontSize: "14px",
              }}
            />
          </div>

          <div>
            <label htmlFor="password" style={{
              display: "block",
              marginBottom: "6px",
              fontSize: "12px",
              fontWeight: 700,
              color: "#666666",
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
              placeholder="••••••••"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "11px 12px",
                borderRadius: "10px",
                border: "1px solid #d3cbb6",
                background: "#f9f7f7",
                color: "#133020",
                outline: "none",
                fontSize: "14px",
              }}
            />
          </div>
        </div>

        {error && (
          <div role="alert" style={{
            marginTop: "16px",
            padding: "12px",
            borderRadius: "10px",
            background: "rgba(239,68,68,0.06)",
            color: "#b91c1c",
            border: "1px solid rgba(239,68,68,0.2)",
            fontSize: "13px",
            lineHeight: 1.45,
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || username.trim().length === 0 || password.trim().length === 0}
          style={{
            width: "100%",
            marginTop: "24px",
            padding: "12px 16px",
            borderRadius: "10px",
            border: 0,
            background: loading ? "#708e7c" : "#046241", // Castleton Green
            color: "white",
            fontWeight: 700,
            fontSize: "14px",
            cursor: loading ? "not-allowed" : "pointer",
            boxShadow: "0 4px 12px rgba(4, 98, 65, 0.15)",
            transition: "background 0.2s",
          }}
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </main>
  );
}
