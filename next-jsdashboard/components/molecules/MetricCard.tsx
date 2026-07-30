import React from "react";
import { Icon, IconName } from "../atoms/Icon";

interface MetricCardProps {
  icon: IconName;
  colorTheme: "blue" | "green" | "amber" | "violet";
  label: string;
  value: string | number;
  subtext: string;
  isWordValue?: boolean;
}

export function MetricCard({
  icon,
  colorTheme,
  label,
  value,
  subtext,
  isWordValue,
}: MetricCardProps) {
  return (
    <article className="metric-card">
      <span className={`kpi-icon ${colorTheme}`}>
        <Icon name={icon} />
      </span>
      <div>
        <small>{label}</small>
        <strong className={isWordValue ? "word-value" : ""}>{value}</strong>
        <em>{subtext}</em>
      </div>
    </article>
  );
}
