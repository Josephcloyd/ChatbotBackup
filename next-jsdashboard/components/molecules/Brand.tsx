import React from "react";
import { LeafLogo } from "../atoms/LeafLogo";

interface BrandProps {
  variant?: "dark" | "light"; // dark for sidebar, light for login page
  showSubtitle?: boolean;
}

export function Brand({ variant = "dark", showSubtitle = false }: BrandProps) {
  const isDark = variant === "dark";

  return (
    <div className={`brand ${isDark ? "brand-dark" : "brand-light"}`}>
      <div className="brand-mark">
        {/* Ascending Vertical Growth Bar Graph (Small -> Big) */}
        <svg
          className="brand-bar-graph"
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Chart Baseline & Horizontal Grid Lines */}
          <line
            x1="4"
            y1="14"
            x2="44"
            y2="14"
            stroke="rgba(37, 103, 56, 0.12)"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
          <line
            x1="4"
            y1="24"
            x2="44"
            y2="24"
            stroke="rgba(37, 103, 56, 0.12)"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
          <line
            x1="4"
            y1="34"
            x2="44"
            y2="34"
            stroke="rgba(37, 103, 56, 0.12)"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
          <line
            x1="4"
            y1="42"
            x2="44"
            y2="42"
            stroke="rgba(37, 103, 56, 0.25)"
            strokeWidth="1.5"
          />

          {/* Ascending Vertical Data Bars (Small -> Big) */}
          <rect
            x="7"
            y="34"
            width="5"
            height="8"
            rx="2"
            fill="#38a169"
            opacity="0.4"
          />
          <rect
            x="15"
            y="26"
            width="5"
            height="16"
            rx="2"
            fill="#256738"
            opacity="0.45"
          />
          <rect
            x="23"
            y="18"
            width="5"
            height="24"
            rx="2"
            fill="#e49b24"
            opacity="0.5"
          />
          <rect
            x="31"
            y="10"
            width="5"
            height="32"
            rx="2"
            fill="#f59e0b"
            opacity="0.55"
          />
          <rect
            x="39"
            y="4"
            width="5"
            height="38"
            rx="2"
            fill="#256738"
            opacity="0.6"
          />
        </svg>

        <LeafLogo
          width={34}
          height={34}
          style={{ position: "relative", zIndex: 2 }}
        />
      </div>

      <div>
        <strong className="brand-title">LifePlan</strong>
        {showSubtitle && (
          <span className="brand-subtitle">Powered by Lifewood PH</span>
        )}
      </div>
    </div>
  );
}
