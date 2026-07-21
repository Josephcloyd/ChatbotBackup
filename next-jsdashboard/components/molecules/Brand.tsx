import React from "react";

interface BrandProps {
  variant?: "dark" | "light"; // dark for sidebar, light for login page
  showSubtitle?: boolean;
}

export function Brand({ variant = "dark", showSubtitle = false }: BrandProps) {
  const isDark = variant === "dark";

  return (
    <div className={`brand ${isDark ? "brand-dark" : "brand-light"}`}>
      <svg viewBox="0 0 24 30" width="22" height="30" fill="#FFB347" aria-hidden="true">
        <path d="M12 1 L22 7 L22 23 L12 29 L2 23 L2 7 Z" />
      </svg>

      <div>
        <strong className="brand-title">Lifeplan</strong>
        {showSubtitle && <span className="brand-subtitle">Flowboard System</span>}
      </div>
    </div>
  );
}
