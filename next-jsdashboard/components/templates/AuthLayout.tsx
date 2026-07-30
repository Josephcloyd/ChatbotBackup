"use client";

import React from "react";
import { AuthSlideshow } from "../molecules/AuthSlideshow";
import { useTheme } from "../providers/ThemeProvider";
import { Icon } from "../atoms/Icon";

interface AuthLayoutProps {
  children: React.ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <main className="auth-layout">
      <AuthSlideshow />
      <button
        type="button"
        onClick={toggleTheme}
        className="auth-theme-toggle"
        title={
          theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"
        }
        aria-label="Toggle Theme"
      >
        <Icon
          name={theme === "dark" ? "sun" : "moon"}
          style={{ width: 20, height: 20 }}
        />
      </button>
      <div className="auth-content-wrapper">{children}</div>
    </main>
  );
}
