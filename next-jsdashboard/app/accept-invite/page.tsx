"use client";

import { FormEvent, useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthLayout } from "../../components/templates/AuthLayout";
import { Brand } from "../../components/molecules/Brand";
import { FormGroup } from "../../components/molecules/FormGroup";
import { Input } from "../../components/atoms/Input";
import { Button } from "../../components/atoms/Button";
import { Icon } from "../../components/atoms/Icon";

function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [identifier, setIdentifier] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showTempPassword, setShowTempPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const emailParam = searchParams.get("email") || searchParams.get("username");
    if (emailParam) {
      setIdentifier(emailParam);
    }
  }, [searchParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!identifier.trim()) {
      setError("Email address or username is required.");
      return;
    }
    if (!temporaryPassword.trim()) {
      setError("Temporary password assigned by your admin is required.");
      return;
    }
    if (!newPassword.trim()) {
      setError("New password is required.");
      return;
    }
    if (newPassword.trim().length < 6) {
      setError("New password must be at least 6 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirm password do not match.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/confirm-invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identifier: identifier.trim(),
          temporaryPassword: temporaryPassword.trim(),
          newPassword: newPassword.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Failed to activate account and update password.");
      }

      router.push("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Confirmation failed.");
    } finally {
      setLoading(false);
    }
  }

  const isFormInvalid =
    !identifier.trim() ||
    !temporaryPassword.trim() ||
    !newPassword.trim() ||
    !confirmPassword.trim() ||
    newPassword.trim().length < 6 ||
    newPassword !== confirmPassword;

  return (
    <form onSubmit={handleSubmit} className="auth-form-card">
      <div className="auth-brand-wrapper">
        <Brand variant="light" />
      </div>

      <h1 className="auth-title">Confirm Account</h1>
      <p className="auth-subtitle">
        Enter your temporary password provided by your administrator, then choose a new password to activate your account.
      </p>

      <div className="auth-fields" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <FormGroup label="Email or Username" htmlFor="identifier">
          <Input
            id="identifier"
            type="text"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            required
            maxLength={100}
            placeholder="user@example.com"
          />
        </FormGroup>

        <FormGroup label="Temporary Password" htmlFor="temp-password">
          <div style={{ position: "relative" }}>
            <Input
              id="temp-password"
              type={showTempPassword ? "text" : "password"}
              value={temporaryPassword}
              onChange={(event) => setTemporaryPassword(event.target.value)}
              required
              maxLength={50}
              placeholder="Assigned temporary password"
              style={{ paddingRight: "3.5rem" }}
            />
            <button
              type="button"
              onClick={() => setShowTempPassword(!showTempPassword)}
              style={{
                position: "absolute",
                right: "0.75rem",
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-text-dim, #6b7280)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "4px",
              }}
              aria-label={showTempPassword ? "Hide password" : "Show password"}
            >
              <Icon name={showTempPassword ? "eyeOff" : "eye"} style={{ width: "1.1em", height: "1.1em" }} />
            </button>
          </div>
        </FormGroup>

        <FormGroup label="New Password" htmlFor="new-password">
          <div style={{ position: "relative" }}>
            <Input
              id="new-password"
              type={showNewPassword ? "text" : "password"}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              maxLength={50}
              placeholder="At least 6 characters"
              style={{ paddingRight: "3.5rem" }}
            />
            <button
              type="button"
              onClick={() => setShowNewPassword(!showNewPassword)}
              style={{
                position: "absolute",
                right: "0.75rem",
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-text-dim, #6b7280)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "4px",
              }}
              aria-label={showNewPassword ? "Hide password" : "Show password"}
            >
              <Icon name={showNewPassword ? "eyeOff" : "eye"} style={{ width: "1.1em", height: "1.1em" }} />
            </button>
          </div>
        </FormGroup>

        <FormGroup label="Confirm New Password" htmlFor="confirm-password">
          <div style={{ position: "relative" }}>
            <Input
              id="confirm-password"
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              maxLength={50}
              placeholder="Re-enter new password"
              style={{ paddingRight: "3.5rem" }}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              style={{
                position: "absolute",
                right: "0.75rem",
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-text-dim, #6b7280)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "4px",
              }}
              aria-label={showConfirmPassword ? "Hide password" : "Show password"}
            >
              <Icon name={showConfirmPassword ? "eyeOff" : "eye"} style={{ width: "1.1em", height: "1.1em" }} />
            </button>
          </div>
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
        disabled={isFormInvalid}
      >
        Activate Account &amp; Sign In
      </Button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <AuthLayout>
      <Suspense fallback={<div>Loading confirmation form...</div>}>
        <AcceptInviteForm />
      </Suspense>
    </AuthLayout>
  );
}
