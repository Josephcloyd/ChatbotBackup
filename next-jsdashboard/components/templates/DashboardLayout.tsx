import React, { useState } from "react";
import { Icon } from "../atoms/Icon";
import { Brand } from "../molecules/Brand";

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
        <Brand variant="dark" />
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
