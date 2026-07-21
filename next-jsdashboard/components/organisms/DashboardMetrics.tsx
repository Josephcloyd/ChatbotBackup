import React from "react";
import { MetricCard } from "../molecules/MetricCard";

interface DashboardMetricsProps {
  metrics: {
    unitLabel: string;
    totalPlanned: number;
    teamSize: number;
    scheduledDays: number;
  };
  mode: "dynamic" | "template";
  sheetsCount: number;
}

export function DashboardMetrics({ metrics, mode, sheetsCount }: DashboardMetricsProps) {
  return (
    <section className="kpi-grid">
      <MetricCard
        icon="hours"
        colorTheme="blue"
        label={`Planned ${metrics.unitLabel}`}
        value={metrics.totalPlanned.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        subtext="allocated exactly"
      />
      <MetricCard
        icon="team"
        colorTheme="green"
        label="Active team"
        value={metrics.teamSize}
        subtext="maximum scheduled"
      />
      <MetricCard
        icon="clock"
        colorTheme="amber"
        label="Scheduled days"
        value={metrics.scheduledDays}
        subtext={mode === "dynamic" ? "generated dynamically" : "from template"}
      />
      <MetricCard
        icon="grid"
        colorTheme="violet"
        label="Workbook mode"
        value={mode}
        subtext={`${sheetsCount} plan sheet`}
        isWordValue={true}
      />
    </section>
  );
}
