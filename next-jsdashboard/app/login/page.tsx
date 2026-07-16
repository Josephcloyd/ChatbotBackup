"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthLayout } from "../../components/templates/AuthLayout";
import { Brand } from "../../components/molecules/Brand";
import { FormGroup } from "../../components/molecules/FormGroup";
import { Input } from "../../components/atoms/Input";
import { Button } from "../../components/atoms/Button";

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
    <AuthLayout>
      <form onSubmit={handleSubmit} className="auth-form-card">
        <div className="auth-brand-wrapper">
          <Brand variant="light" />
        </div>

        <h1 className="auth-title">Production Planner</h1>
        <p className="auth-subtitle">
          Log in with your operator or administrator credentials to manage schedules.
        </p>

        <div className="auth-fields">
          <FormGroup label="Username" htmlFor="username">
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              placeholder="e.g. operator1"
            />
          </FormGroup>

          <FormGroup label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              placeholder="••••••••"
            />
          </FormGroup>
        </div>

        {error && (
          <div role="alert" className="error-box mt-4">
            {error}
          </div>
        )}

        <Button
          type="submit"
          className="w-full mt-6"
          isLoading={loading}
          disabled={username.trim().length === 0 || password.trim().length === 0}
        >
          Sign In
        </Button>
      </form>
    </AuthLayout>
  );
}
