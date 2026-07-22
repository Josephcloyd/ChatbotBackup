import React, { useMemo, useState } from "react";
import { Icon } from "../atoms/Icon";
import type { HistoryRecord, GenerationSource, PlanStatus } from "../../lib/adminTypes";

type SortMode = "newest" | "oldest" | "highest_hours";
const PLAN_OVERVIEW_LIMIT = 15;

interface AdminPlansPanelProps {
  plans: HistoryRecord[];
  activePlanId: string | null;
  onSelectPlan: (id: string) => void;
  onViewPlan: (id: string) => void;
  onDeletePlan: (plan: HistoryRecord) => void;
  onDeleteSelectedPlans: (plans: HistoryRecord[]) => void;
  onEditPlan: (plan: HistoryRecord) => void;
}

function statusOf(plan: HistoryRecord): PlanStatus {
  return plan.status ?? "generated";
}

function sourceOf(plan: HistoryRecord): GenerationSource {
  return plan.generation_source ?? "whatsapp";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function AdminPlansPanel({
  plans,
  activePlanId,
  onSelectPlan,
  onViewPlan,
  onDeletePlan,
  onDeleteSelectedPlans,
  onEditPlan,
}: AdminPlansPanelProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [selectedPlanIds, setSelectedPlanIds] = useState<Set<string>>(new Set());

  const operators = useMemo(
    () => [...new Set(plans.map((plan) => plan.whatsapp_user_id).filter(Boolean))].sort(),
    [plans],
  );

  const summary = useMemo(() => {
    const countByStatus = (status: PlanStatus) => plans.filter((plan) => statusOf(plan) === status).length;
    return {
      totalPlans: plans.length,
      generated: countByStatus("generated"),
      failed: countByStatus("failed"),
      archived: countByStatus("archived"),
    };
  }, [plans]);

  const filteredPlans = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return plans
      .filter((plan) => !needle || plan.project_title.toLowerCase().includes(needle))
      .filter((plan) => !statusFilter || statusOf(plan) === statusFilter)
      .filter((plan) => !sourceFilter || sourceOf(plan) === sourceFilter)
      .filter((plan) => !operatorFilter || plan.whatsapp_user_id === operatorFilter)
      .sort((left, right) => {
        if (sortMode === "oldest") return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
        if (sortMode === "highest_hours") return Number(right.total_hours_estimate || 0) - Number(left.total_hours_estimate || 0);
        return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
      });
  }, [plans, search, statusFilter, sourceFilter, operatorFilter, sortMode]);

  const visiblePlans = useMemo(() => filteredPlans.slice(0, PLAN_OVERVIEW_LIMIT), [filteredPlans]);
  const hiddenFilteredCount = Math.max(filteredPlans.length - visiblePlans.length, 0);

  function clearFilters() {
    setSearch("");
    setStatusFilter("");
    setSourceFilter("");
    setOperatorFilter("");
    setSortMode("newest");
  }

  const selectedPlans = visiblePlans.filter((plan) => selectedPlanIds.has(plan.id));
  const allVisibleSelected = visiblePlans.length > 0 && visiblePlans.every((plan) => selectedPlanIds.has(plan.id));

  function togglePlan(planId: string) {
    setSelectedPlanIds((current) => {
      const next = new Set(current);
      if (next.has(planId)) next.delete(planId);
      else next.add(planId);
      return next;
    });
  }

  function toggleVisiblePlans() {
    setSelectedPlanIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        visiblePlans.forEach((plan) => next.delete(plan.id));
      } else {
        visiblePlans.forEach((plan) => next.add(plan.id));
      }
      return next;
    });
  }

  function deleteSelected() {
    if (selectedPlans.length === 0) return;
    onDeleteSelectedPlans(selectedPlans);
    setSelectedPlanIds(new Set());
  }

  const cards = [
    ["Total plans", summary.totalPlans.toLocaleString()],
    ["Generated", summary.generated.toLocaleString()],
    ["Failed", summary.failed.toLocaleString()],
    ["Archived", summary.archived.toLocaleString()],
  ];

  return (
    <section className="schedule-card admin-plans-panel">
      <div className="card-heading">
        <div>
          <span className="eyebrow">ADMIN PLANS OVERVIEW</span>
          <h3>All Generated Production Schedules</h3>
        </div>
        <span className="rows-count">
          {visiblePlans.length} shown{hiddenFilteredCount ? ` / ${filteredPlans.length} matching` : ""} / {plans.length} loaded
        </span>
      </div>

      <div className="admin-summary-grid">
        {cards.map(([label, value]) => (
          <div className="admin-summary-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <div className="admin-filter-panel" aria-label="Plan filters">
        <div className="admin-filter-field admin-filter-search">
          <label htmlFor="plan-search">Search</label>
          <input
            id="plan-search"
            className="input-atom"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search project title"
            aria-label="Search project title"
          />
        </div>
        <div className="admin-filter-grid">
          <div className="admin-filter-field">
            <label htmlFor="plan-status-filter">Status</label>
            <select id="plan-status-filter" className="select-atom" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              {["generated", "archived", "failed"].map((status) => (
                <option value={status} key={status}>{status.replace("_", " ")}</option>
              ))}
            </select>
          </div>
          <div className="admin-filter-field">
            <label htmlFor="plan-source-filter">Source</label>
            <select id="plan-source-filter" className="select-atom" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} aria-label="Filter by generation source">
              <option value="">All sources</option>
              {["whatsapp", "dashboard", "api", "admin"].map((source) => (
                <option value={source} key={source}>{source}</option>
              ))}
            </select>
          </div>
          <div className="admin-filter-field">
            <label htmlFor="plan-operator-filter">Operator</label>
            <select id="plan-operator-filter" className="select-atom" value={operatorFilter} onChange={(event) => setOperatorFilter(event.target.value)} aria-label="Filter by operator">
              <option value="">All operators</option>
              {operators.map((operator) => (
                <option value={operator} key={operator}>{operator}</option>
              ))}
            </select>
          </div>
          <div className="admin-filter-field">
            <label htmlFor="plan-sort">Sort</label>
            <select id="plan-sort" className="select-atom" value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label="Sort plans">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="highest_hours">Highest hours</option>
            </select>
          </div>
          <button className="download-button admin-clear-button" type="button" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      </div>

      <div className="bulk-actions-bar">
        <span>{selectedPlans.length} selected</span>
        <button
          type="button"
          className="download-button danger-outline"
          onClick={deleteSelected}
          disabled={selectedPlans.length === 0}
        >
          Delete selected
        </button>
      </div>

      <div className="table-scroll admin-table-scroll">
        <table className="admin-table admin-plans-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleVisiblePlans}
                  aria-label="Select visible plans"
                />
              </th>
              <th>Title</th>
              <th>Operator</th>
              <th>Status</th>
              <th>Estimated hours</th>
              <th>Team size</th>
              <th>Source</th>
              <th>Created at</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visiblePlans.map((item) => (
                <tr
                  key={item.id}
                  className={activePlanId === item.id ? "active-row" : ""}
                  onClick={() => onSelectPlan(item.id)}
                >
                  <td data-label="Select" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedPlanIds.has(item.id)}
                      onChange={() => togglePlan(item.id)}
                      aria-label={`Select ${item.project_title}`}
                    />
                  </td>
                  <td className="plan-title-cell" data-label="Title">
                    <span className="plan-title-main">{item.project_title}</span>
                    <span className={`plan-title-subtext ${item.summary || item.project_description ? "" : "placeholder-copy"}`}>
                      {item.summary || item.project_description || "Add summary"}
                    </span>
                  </td>
                  <td data-label="Operator">
                    <span className="cell-stack">
                      <strong>{item.whatsapp_user_id}</strong>
                      <small>{item.requested_by ? `Requested by ${item.requested_by}` : "Requester not set"}</small>
                    </span>
                  </td>
                  <td data-label="Status"><span className={`compact-badge status-${statusOf(item)}`}>{statusOf(item).replace("_", " ")}</span></td>
                  <td className="numeric-cell" data-label="Estimated hours">{Number(item.total_hours_estimate || 0).toLocaleString()}</td>
                  <td className="numeric-cell" data-label="Team size">{item.recommended_team_size ?? "—"}</td>
                  <td data-label="Source"><span className={`compact-badge source-${sourceOf(item)}`}>{sourceOf(item)}</span></td>
                  <td data-label="Created at">
                    <span className="date-cell">{formatDateTime(item.created_at)}</span>
                  </td>
                  <td data-label="Actions" className="text-right actions-cell" onClick={(event) => event.stopPropagation()}>
                    <button type="button" className="action-btn view-btn" onClick={() => onViewPlan(item.id)} title="View plan" aria-label={`View ${item.project_title}`}>
                      <Icon name="eye" />
                    </button>
                    <button type="button" className="action-btn edit-btn" onClick={() => onEditPlan(item)} title="Edit plan" aria-label={`Edit ${item.project_title}`}>
                      <Icon name="edit" />
                    </button>
                    <button type="button" className="action-btn delete-btn" onClick={() => onDeletePlan(item)} title="Delete plan" aria-label={`Delete ${item.project_title}`}>
                      <Icon name="trash" />
                    </button>
                  </td>
                </tr>
            ))}
            {filteredPlans.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-muted p-4">
                  No production plans match the current filters.
                </td>
              </tr>
            )}
            {hiddenFilteredCount > 0 && (
              <tr className="table-limit-row">
                <td colSpan={9}>
                  Showing the first {PLAN_OVERVIEW_LIMIT} matching records. Refine filters to narrow the overview.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
