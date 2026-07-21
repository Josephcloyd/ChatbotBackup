import React from "react";

interface PlanTableProps {
  rows: Record<string, string | number | boolean | null>[];
  metrics: {
    unitLabel: string;
    targetCol: string;
    perAnnotCol: string;
  };
}

function numberValue(value: string | number | boolean | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function PlanTable({ rows, metrics }: PlanTableProps) {
  return (
    <section className="schedule-card">
      <div className="card-heading">
        <div>
          <span className="eyebrow">SCHEDULE PREVIEW</span>
          <h3>First production days</h3>
        </div>
        <span className="rows-count">{rows.length} total rows</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Day</th>
              <th>Team</th>
              <th>Target {metrics.unitLabel}</th>
              <th>Per person</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 7).map((row, index) => (
              <tr key={`${String(row.Date)}-${index}`}>
                <td>{String(row.Date)}</td>
                <td>{String(row.Day ?? "—")}</td>
                <td>{String(row["Target Active Annotators"] ?? "—")}</td>
                <td>{numberValue(row[metrics.targetCol]).toLocaleString()}</td>
                <td>{numberValue(row[metrics.perAnnotCol]).toLocaleString()}</td>
                <td>
                  <span className="status-badge">{String(row.Status ?? "Not Started")}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
