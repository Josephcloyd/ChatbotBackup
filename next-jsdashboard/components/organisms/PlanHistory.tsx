import React from "react";

interface PlanHistoryProps {
  plans: any[];
  activePlanId: string | null;
  onSelectPlan: (id: string) => void;
}

export function PlanHistory({
  plans,
  activePlanId,
  onSelectPlan,
}: PlanHistoryProps) {
  return (
    <section className="history-card">
      <div className="card-heading">
        <div>
          <span className="eyebrow">PLAN ARCHIVE</span>
          <h3>My generated production plans</h3>
        </div>
        <span className="history-state on">Operator Lock</span>
      </div>
      {plans.length ? (
        <div className="history-list">
          {plans.slice(0, 10).map((item) => (
            <button
              key={item.id}
              onClick={() => onSelectPlan(item.id)}
              style={{
                border:
                  activePlanId === item.id
                    ? "1px solid #046241"
                    : "1px solid #e3e9ee",
              }}
            >
              <span>{item.project_title}</span>
              <small>
                {item.total_hours_estimate}h &middot; team{" "}
                {item.recommended_team_size}
              </small>
            </button>
          ))}
        </div>
      ) : (
        <div className="history-empty">
          <span>⌂</span>
          <p>Generate your first saved plan to build history.</p>
        </div>
      )}
    </section>
  );
}
