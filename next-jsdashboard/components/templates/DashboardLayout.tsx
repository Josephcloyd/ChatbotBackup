import React, { useState } from "react";
import { Icon } from "../atoms/Icon";

interface DashboardLayoutProps {
  sidebarContent: React.ReactNode;
  children: React.ReactNode;
}

export function DashboardLayout({ sidebarContent, children }: DashboardLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className={`app-shell ${mobileMenuOpen ? "mobile-menu-open" : ""}`}>
      {/* Mobile Header for hamburger menu */}
      <div className="mobile-header">
        <div className="brand brand-dark">
          <svg viewBox="0 0 24 30" width="22" height="30" fill="#FFB347" aria-hidden="true">
            <path d="M12 1 L22 7 L22 23 L12 29 L2 23 L2 7 Z" />
          </svg>

          <div>
            <strong className="brand-title">Lifeplan</strong>
          </div>
        </div>
        <button
          className="mobile-menu-toggle"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle Menu"
        >
          {mobileMenuOpen ? "✕" : "☰"}
        </button>
      </div>

      <aside className={`control-panel ${mobileMenuOpen ? "open" : ""}`}>
        {sidebarContent}
      </aside>

      {/* Overlay to close menu on mobile */}
      {mobileMenuOpen && (
        <div
          className="mobile-overlay"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <section className="workspace">
        {children}
      </section>
    </div>
  );
}
