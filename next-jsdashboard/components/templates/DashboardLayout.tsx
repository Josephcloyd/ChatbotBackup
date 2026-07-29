import React, { useState } from "react";
import { Brand } from "../molecules/Brand";

interface DashboardLayoutProps {
  sidebarContent: React.ReactNode;
  children: React.ReactNode;
}

export function DashboardLayout({ sidebarContent, children }: DashboardLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className={`app-shell ${mobileMenuOpen ? "mobile-menu-open" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
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

      <aside className={`control-panel ${mobileMenuOpen ? "open" : ""} ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="control-panel-inner">
          {sidebarContent}
        </div>
      </aside>

      <button
        className={`sidebar-toggle-btn ${sidebarCollapsed ? "collapsed" : ""}`}
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        type="button"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: sidebarCollapsed ? "rotate(180deg)" : "none",
            transition: "transform 0.25s ease",
          }}
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

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
