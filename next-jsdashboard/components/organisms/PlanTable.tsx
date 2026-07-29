import React from "react";

interface PlanTableProps {
  rows: Record<string, string | number | boolean | null>[];
  metrics?: {
    unitLabel?: string;
    targetCol?: string;
    perAnnotCol?: string;
  };
}

function selectTeamColumn(keys: string[]): string | undefined {
  return keys.find((key) => /^target\s+active\b/i.test(key))
    ?? keys.find((key) => /\b(?:team|staff|workers|resources)\b/i.test(key) && !/actual|per\s+/i.test(key));
}

export function PlanTable({ rows, metrics }: PlanTableProps) {
  const columns = React.useMemo(() => {
    if (!rows || rows.length === 0) return [];
    const keys = Object.keys(rows[0]);
    const preferred = [
      "No.",
      "Date",
      "Month",
      "Day",
      selectTeamColumn(keys),
      metrics?.targetCol,
      metrics?.perAnnotCol,
      "Target Hours",
      "Actual Hours",
      "Status",
      "Notes",
    ].filter((column): column is string => typeof column === "string" && keys.includes(column));
    return [...new Set(preferred)].slice(0, 10);
  }, [rows, metrics?.targetCol, metrics?.perAnnotCol]);

  if (!rows || rows.length === 0) return null;

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
              {columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 7).map((row, index) => (
              <tr key={`${String(row.Date ?? index)}-${index}`}>
                {columns.map((col) => {
                  const rawVal = row[col];
                  let displayVal = "—";
                  if (typeof rawVal === "number") {
                    displayVal = rawVal.toLocaleString();
                  } else if (rawVal !== null && rawVal !== undefined && rawVal !== "") {
                    displayVal = String(rawVal);
                  } else if (/status/i.test(col)) {
                    displayVal = "Not Started";
                  }

                  return (
                    <td key={col}>
                      {/status/i.test(col) ? (
                        <span className="status-badge">{displayVal}</span>
                      ) : (
                        displayVal
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
