import React, { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryRecord } from "../../lib/adminTypes";

interface SidebarHistoryProps {
  username: string;
  role: "admin" | "operator";
  activePlanId: string | null;
  onSelectPlan: (id: string, promptText: string) => void;
}

const PAGE_SIZE = 5;

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

export function SidebarHistory({ username, role, activePlanId, onSelectPlan }: SidebarHistoryProps) {
  const [plans, setPlans] = useState<HistoryRecord[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const fetchingRef = useRef(false);

  const fetchPage = useCallback(
    async (pageOffset: number, isReset = false) => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(pageOffset),
        });
        if (role === "operator") params.set("userId", username);
        const res = await fetch(`/api/planner/plans?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load history");
        const data = await res.json();
        const incoming: HistoryRecord[] = data.plans ?? [];
        setPlans((prev) => {
          if (isReset) return incoming;
          const existingIds = new Set(prev.map((p) => p.id));
          return [...prev, ...incoming.filter((p) => !existingIds.has(p.id))];
        });
        setHasMore(incoming.length === PAGE_SIZE);
        setOffset(pageOffset + incoming.length);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading history");
      } finally {
        setLoading(false);
        fetchingRef.current = false;
      }
    },
    [username, role],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, role]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !fetchingRef.current) {
          fetchPage(offset);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, offset, fetchPage]);

  return (
    <div className="sidebar-history">
      <span className="sidebar-history-label">Recent Plans</span>
      <div className="sidebar-history-list" role="list">
        {plans.length === 0 && !loading && (
          <div className="sidebar-history-empty">
            <span>?</span>
            <p>No plans yet. Generate your first one!</p>
          </div>
        )}
        {plans.map((plan) => {
          const isActive = plan.id === activePlanId;
          const prompt = plan.project_description ?? plan.project_title ?? "";
          const snippet = prompt.length > 60 ? `${prompt.slice(0, 60)}\u2026` : prompt;
          return (
            <button
              key={plan.id}
              className={`sidebar-history-item${isActive ? " sidebar-history-item--active" : ""}`}
              onClick={() => onSelectPlan(plan.id, prompt)}
              title={prompt}
              role="listitem"
              aria-current={isActive ? "true" : undefined}
            >
              <span className="sidebar-history-title">{plan.project_title || "Untitled Plan"}</span>
              {snippet && <span className="sidebar-history-snippet">{snippet}</span>}
              <span className="sidebar-history-meta">
                <span>{formatRelativeDate(plan.created_at)}</span>
                {plan.workbook_mode && (
                  <span className={`sidebar-history-mode sidebar-history-mode--${plan.workbook_mode === "official_template" ? "template" : "dynamic"}`}>
                    {plan.workbook_mode === "official_template" ? "Template" : "Dynamic"}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        <div ref={sentinelRef} className="sidebar-history-sentinel" aria-hidden="true" />
        {loading && (
          <div className="sidebar-history-loading" aria-live="polite">
            <span className="sidebar-history-spinner" />
            <span>Loading\u2026</span>
          </div>
        )}
        {!hasMore && plans.length > 0 && (
          <p className="sidebar-history-end">All plans loaded</p>
        )}
        {error && (
          <p className="sidebar-history-error">{error}</p>
        )}
      </div>
    </div>
  );
}
