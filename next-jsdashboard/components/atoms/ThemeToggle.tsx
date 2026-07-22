"use client";

import React from "react";
import { useTheme } from "../providers/ThemeProvider";
import { Icon } from "./Icon";

export function ThemeToggle() {
  const { theme, toggleTheme, mounted } = useTheme();

  if (!mounted) return <div className="theme-toggle-skeleton"></div>;

  return (
    <label className="theme-switch-wrapper" aria-label="Toggle Dark Mode">
      <input 
        type="checkbox" 
        checked={theme === "dark"} 
        onChange={toggleTheme} 
        className="theme-switch-checkbox" 
      />
      <div className="theme-switch-slider">
        <span className="theme-switch-icon sun-icon">
          <Icon name="sun" />
        </span>
        <span className="theme-switch-icon moon-icon">
          <Icon name="moon" />
        </span>
        <div className="theme-switch-thumb"></div>
      </div>
    </label>
  );
}
