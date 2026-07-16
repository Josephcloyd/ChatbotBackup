import React from "react";

interface BrandProps {
  variant?: "dark" | "light"; // dark for sidebar, light for login page
  showSubtitle?: boolean;
}

export function Brand({ variant = "dark", showSubtitle = false }: BrandProps) {
  const isDark = variant === "dark";

  return (
    <div className={`brand ${isDark ? "brand-dark" : "brand-light"}`}>
      <div className="brand-mark" />
      <div>
        <strong className="brand-title">Lifeplan</strong>
        {showSubtitle && <span className="brand-subtitle">Flowboard System</span>}
      </div>
    </div>
  );
}
