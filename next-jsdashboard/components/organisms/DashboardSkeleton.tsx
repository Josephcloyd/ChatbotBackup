import React from "react";
import { Skeleton } from "../atoms/Skeleton";

const skeletonBarHeights = [64, 38, 78, 52];

export function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton">
      {/* Summary Strip Skeleton */}
      <section className="summary-strip">
        <div className="project-summary">
          <Skeleton className="mb-4" style={{ width: "120px", height: "12px", borderRadius: "4px" }} />
          <Skeleton className="mb-2" style={{ width: "80%", height: "20px", borderRadius: "6px" }} />
          <Skeleton className="mb-4" style={{ width: "60%", height: "20px", borderRadius: "6px" }} />
          <div className="date-range">
            <Skeleton style={{ width: "200px", height: "16px", borderRadius: "4px" }} />
          </div>
        </div>
        <div className="flex-center">
          <Skeleton style={{ width: "92px", height: "92px", borderRadius: "50%" }} />
        </div>
      </section>

      {/* KPI Grid Skeleton */}
      <section className="kpi-grid mt-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="metric-card">
            <Skeleton style={{ width: "40px", height: "40px", borderRadius: "11px", flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <Skeleton className="mb-2" style={{ width: "60px", height: "10px", borderRadius: "3px" }} />
              <Skeleton style={{ width: "80px", height: "24px", borderRadius: "4px" }} />
            </div>
          </div>
        ))}
      </section>

      {/* Content Grid Skeleton */}
      <section className="content-grid mt-6">
        <article className="chart-card">
          <div className="card-heading">
            <div>
              <Skeleton className="mb-2" style={{ width: "100px", height: "12px", borderRadius: "3px" }} />
              <Skeleton style={{ width: "160px", height: "20px", borderRadius: "4px" }} />
            </div>
            <Skeleton style={{ width: "60px", height: "12px", borderRadius: "3px" }} />
          </div>
          <div className="bar-chart" style={{ borderBottom: "none" }}>
            {skeletonBarHeights.map((height) => (
              <div key={height} className="bar-column">
                <Skeleton style={{ width: "100%", height: `${height}%`, borderRadius: "6px 6px 0 0" }} />
                <Skeleton className="mt-2" style={{ width: "30px", height: "10px", borderRadius: "3px", margin: "8px auto 0" }} />
              </div>
            ))}
          </div>
        </article>

        <article className="assumptions-card">
          <div className="card-heading">
            <div>
              <Skeleton className="mb-2" style={{ width: "90px", height: "12px", borderRadius: "3px" }} />
              <Skeleton style={{ width: "130px", height: "20px", borderRadius: "4px" }} />
            </div>
          </div>
          <ul style={{ marginTop: "20px" }}>
            {[1, 2, 3, 4].map((i) => (
              <li key={i} style={{ display: "grid", gridTemplateColumns: "27px 1fr", gap: "9px", marginBottom: "11px" }}>
                <Skeleton style={{ width: "25px", height: "25px", borderRadius: "8px" }} />
                <div>
                  <Skeleton className="mb-2" style={{ width: "90%", height: "12px", borderRadius: "3px" }} />
                  <Skeleton style={{ width: "60%", height: "12px", borderRadius: "3px" }} />
                </div>
              </li>
            ))}
          </ul>
        </article>
      </section>

      {/* Table Skeleton */}
      <section className="schedule-card mt-6">
        <div className="card-heading">
          <Skeleton style={{ width: "150px", height: "20px", borderRadius: "4px" }} />
          <Skeleton style={{ width: "80px", height: "20px", borderRadius: "10px" }} />
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <th key={i}><Skeleton style={{ width: "80%", height: "12px", borderRadius: "3px" }} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4].map((row) => (
                <tr key={row}>
                  {[1, 2, 3, 4, 5, 6].map((col) => (
                    <td key={col}><Skeleton style={{ width: "70%", height: "14px", borderRadius: "4px" }} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
