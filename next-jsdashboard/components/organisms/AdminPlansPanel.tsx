import React from "react";
import { Icon } from "../atoms/Icon";

interface AdminPlansPanelProps {
  plans: any[];
  activePlanId: string | null;
  onSelectPlan: (id: string) => void;
  onDeletePlan: (id: string) => void;
  onEditPlan: (id: string, title: string, summary: string) => void;
}

export function AdminPlansPanel({ plans, activePlanId, onSelectPlan, onDeletePlan, onEditPlan }: AdminPlansPanelProps) {
  return (
    <section className="schedule-card" style={{ padding: "24px" }}>
      <div className="card-heading">
        <div>
          <span className="eyebrow">ADMIN PLANS OVERVIEW</span>
          <h3>All Generated Production Schedules</h3>
        </div>
        <span className="rows-count">{plans.length} total plans</span>
      </div>

      <div className="table-scroll admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Operator</th>
              <th>Hours</th>
              <th>Team Size</th>
              <th>Created At</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((item) => (
              <tr
                key={item.id}
                className={activePlanId === item.id ? "active-row" : ""}
                onClick={() => onSelectPlan(item.id)}
              >
                <td className="text-primary font-bold">{item.project_title}</td>
                <td>{item.whatsapp_user_id}</td>
                <td>{item.total_hours_estimate}h</td>
                <td>{item.recommended_team_size}</td>
                <td>{new Date(item.created_at).toLocaleDateString()}</td>
                <td className="text-right actions-cell" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="action-btn edit-btn"
                    onClick={() => onEditPlan(item.id, item.project_title, item.summary)}
                    title="Edit Details"
                  >
                    <Icon name="edit" />
                  </button>
                  <button
                    className="action-btn delete-btn"
                    onClick={() => onDeletePlan(item.id)}
                    title="Delete Plan"
                  >
                    <Icon name="trash" />
                  </button>
                </td>
              </tr>
            ))}
            {plans.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-muted p-4">
                  No production plans generated yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
