import React, { useMemo, useState } from "react";
import { Button } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { PlanTable } from "../organisms/PlanTable";
import type {
  HistoryRecord,
  PlanAssistantResponse,
  PlanChangeProposal,
  PlanConversationMessage,
  PlanFileRecord,
  PlanRevision,
  PlanWorkspaceResponse,
} from "../../lib/adminTypes";

interface PlanWorkspaceProps {
  plan: HistoryRecord;
  workspace: PlanWorkspaceResponse | null;
  loading: boolean;
  error: string;
  metrics: {
    unitLabel: string;
    targetCol: string;
    perAnnotCol: string;
    totalPlanned: number;
    teamSize: number;
    scheduledDays: number;
    monthly: Array<{ month: string; value: number }>;
  };
  rows: Record<string, string | number | boolean | null>[];
  downloadUrl?: string;
  sending: boolean;
  applyingProposalId: string;
  restoringRevisionId: string;
  deletingRevisionId?: string;
  files?: PlanFileRecord[];
  filesLoading?: boolean;
  filesError?: string;
  onRetry: () => void;
  onSendMessage: (message: string) => Promise<void>;
  onApplyProposal: (proposal: PlanChangeProposal) => Promise<void>;
  onCancelProposal: (proposal: PlanChangeProposal) => Promise<void>;
  onRestoreRevision: (revision: PlanRevision) => Promise<void>;
  onDeleteRevision?: (revision: PlanRevision) => Promise<void>;
  onDownloadFile?: (file: PlanFileRecord) => void;
}

const suggestions = [
  "Explain this plan",
  "Show how the daily target was calculated",
  "Explain the staffing requirement",
  "Check this plan for mistakes",
  "Change the number of workers to 6",
  "Change total working hours to 240",
  "Use weekdays only",
  "Regenerate the workbook",
];

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number")
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString();
  }
  return String(value);
}

function fileSize(bytes: number | null): string {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safeAssistantResponse(
  message: PlanConversationMessage,
): PlanAssistantResponse | null {
  const response = message.metadata?.assistantResponse;
  if (response && typeof response === "object")
    return response as PlanAssistantResponse;
  return null;
}

function MessageBubble({
  message,
  currentRevisionId,
  applyingProposalId,
  onApplyProposal,
  onCancelProposal,
}: {
  message: PlanConversationMessage;
  currentRevisionId?: string;
  applyingProposalId: string;
  onApplyProposal: (proposal: PlanChangeProposal) => Promise<void>;
  onCancelProposal: (proposal: PlanChangeProposal) => Promise<void>;
}) {
  const response = safeAssistantResponse(message);
  const proposal = response?.proposal;
  const staleProposal = Boolean(
    proposal && proposal.basedOnRevisionId !== currentRevisionId,
  );

  return (
    <article className={`workspace-message workspace-message-${message.role}`}>
      <div className="workspace-message-meta">
        <span>
          {message.role === "assistant" ? "AI assistant" : message.role}
        </span>
        <time>
          {new Date(message.created_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </div>
      <p>{message.content}</p>

      {response?.explanation?.formulas?.length ? (
        <div className="formula-list">
          {response.explanation.formulas.map((formula) => (
            <div key={`${message.id}-${formula.label}`}>
              <span>{formula.label}</span>
              <code>{formula.expression}</code>
              <strong>{formula.result}</strong>
            </div>
          ))}
        </div>
      ) : null}

      {response?.clarificationQuestions?.length ? (
        <ul className="compact-list workspace-question-list">
          {response.clarificationQuestions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ul>
      ) : null}

      {proposal ? (
        <div className="proposal-card">
          <div className="proposal-card-header">
            <div>
              <span className="eyebrow">PROPOSAL</span>
              <h4>{proposal.requestSummary}</h4>
            </div>
            <span className="revision-badge">
              base {proposal.basedOnRevisionId.slice(0, 8)}
            </span>
          </div>
          <p>{proposal.interpretedRequest}</p>
          <div className="proposal-change-list">
            {proposal.changes.map((change) => (
              <div
                key={`${proposal.id}-${change.field}-${change.label}`}
                className="proposal-change-row"
              >
                <span>{change.label}</span>
                <strong>{display(change.previousValue)}</strong>
                <Icon name="clock" />
                <strong>{display(change.proposedValue)}</strong>
              </div>
            ))}
          </div>
          {proposal.warnings.length ? (
            <div className="proposal-warning">
              {proposal.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}
          <div className="proposal-actions">
            <Button
              type="button"
              onClick={() => onApplyProposal(proposal)}
              disabled={staleProposal}
              isLoading={applyingProposalId === proposal.id}
            >
              Apply Changes
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onCancelProposal(proposal)}
              disabled={staleProposal || applyingProposalId === proposal.id}
            >
              Cancel
            </Button>
            {staleProposal && (
              <span className="proposal-stale-note">
                Reloaded after a newer revision.
              </span>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function PlanWorkspace({
  plan,
  workspace,
  loading,
  error,
  metrics,
  rows,
  downloadUrl: _downloadUrl,
  sending,
  applyingProposalId,
  restoringRevisionId,
  deletingRevisionId = "",
  files = [],
  filesLoading = false,
  filesError = "",
  onRetry,
  onSendMessage,
  onApplyProposal,
  onCancelProposal,
  onRestoreRevision,
  onDeleteRevision,
  onDownloadFile,
}: PlanWorkspaceProps) {
  const [draft, setDraft] = useState("");
  const [viewMode, setViewMode] = useState<"details" | "chat">("details");
  const [showRevisionHistory, setShowRevisionHistory] = useState(false);

  const currentRevision = workspace?.currentRevision;
  const revisions = workspace?.revisions ?? [];
  const messages = workspace?.conversation ?? [];
  const assumptions = useMemo(
    () => plan.raw_plan.project.assumptions?.slice(0, 8) ?? [],
    [plan.raw_plan.project.assumptions],
  );

  async function submitMessage(value = draft) {
    const trimmed = value.trim();
    if (!trimmed || sending || !workspace?.permissions.canMessage) return;
    await onSendMessage(trimmed);
    setDraft("");
  }

  const showDetails = viewMode === "details";
  const showChat = viewMode === "chat";

  return (
    <div className="plan-workspace-container">
      <div className="workspace-nav-bar">
        <div className="workspace-tab-group">
          <button
            type="button"
            className={`workspace-tab-btn ${viewMode === "details" ? "active" : ""}`}
            onClick={() => setViewMode("details")}
          >
            <Icon name="file" /> Plan Details
          </button>
          <button
            type="button"
            className={`workspace-tab-btn ${viewMode === "chat" ? "active" : ""}`}
            onClick={() => setViewMode("chat")}
          >
            <Icon name="clock" /> Revisions & Chat{" "}
            {revisions.length > 0 && `(${revisions.length})`}
          </button>
        </div>
      </div>

      <section className={`plan-workspace view-mode-${viewMode}`}>
        {showDetails && (
          <div className="plan-review-area">
            <div className="workspace-section-header compact">
              <div>
                <span className="eyebrow">PLAN DETAILS</span>
              </div>
              <div className="workspace-header-actions">
                {currentRevision && (
                  <span className="revision-badge">
                    Revision {currentRevision.revision_number}
                  </span>
                )}
              </div>
            </div>

            {loading ? (
              <div className="workspace-loading">Loading workspace...</div>
            ) : error ? (
              <div className="error-box" role="alert">
                {error}
                <div className="mt-2">
                  <Button type="button" variant="ghost" onClick={onRetry}>
                    Retry
                  </Button>
                </div>
              </div>
            ) : null}

            {/* 1. Summary Strip with 0% Completion Ring */}
            <div className="summary-strip">
              <div className="project-summary">
                <span className="eyebrow">PLAN OVERVIEW</span>
                <p>
                  {plan.project_description ||
                    plan.raw_plan?.project?.projectDescription}
                </p>
                <div className="date-range mt-2">
                  <Icon name="clock" />
                  <span>
                    {plan.planning_start_date
                      ? new Date(plan.planning_start_date).toLocaleDateString()
                      : "Today"}
                  </span>
                  <span>→</span>
                  <span>
                    {plan.planning_end_date
                      ? new Date(plan.planning_end_date).toLocaleDateString()
                      : "End of schedule"}
                  </span>
                </div>
              </div>
              <div className="completion-ring">
                <div>
                  <strong>0%</strong>
                  <span>ACTUAL</span>
                </div>
              </div>
            </div>

            {/* 2. Rich KPI Cards Grid */}
            <div className="kpi-grid">
              <div className="metric-card">
                <div className="kpi-icon blue">
                  <Icon name="hours" />
                </div>
                <div>
                  <small>Planned {metrics.unitLabel}</small>
                  <strong>
                    {metrics.totalPlanned.toLocaleString(undefined, {
                      maximumFractionDigits: 1,
                    })}
                  </strong>
                  <em>allocated total</em>
                </div>
              </div>
              <div className="metric-card">
                <div className="kpi-icon green">
                  <Icon name="team" />
                </div>
                <div>
                  <small>Active team</small>
                  <strong>{metrics.teamSize}</strong>
                  <em>maximum scheduled</em>
                </div>
              </div>
              <div className="metric-card">
                <div className="kpi-icon amber">
                  <Icon name="clock" />
                </div>
                <div>
                  <small>Scheduled days</small>
                  <strong>{metrics.scheduledDays}</strong>
                  <em>generated dynamically</em>
                </div>
              </div>
              <div className="metric-card">
                <div className="kpi-icon violet">
                  <Icon name="grid" />
                </div>
                <div>
                  <small>Workbook mode</small>
                  <strong className="word-value">
                    {plan.workbook_mode === "official_template"
                      ? "Template"
                      : "Dynamic"}
                  </strong>
                  <em>
                    {plan.raw_plan?.workbook?.sheets?.length ?? 1} plan sheet
                  </em>
                </div>
              </div>
            </div>

            {/* 3. Capacity Curve Bar Chart (Left) + Model Notes Assumptions (Right) */}
            <div className="admin-two-column">
              <article className="chart-card">
                <div className="card-heading">
                  <div>
                    <span className="eyebrow">CAPACITY CURVE</span>
                    <h3>
                      {metrics.unitLabel.charAt(0).toUpperCase() +
                        metrics.unitLabel.slice(1)}{" "}
                      by month
                    </h3>
                  </div>
                  <span className="legend">
                    <i /> Planned
                  </span>
                </div>
                <div className="bar-chart">
                  {metrics.monthly.map((item) => {
                    const maxMonth = Math.max(
                      ...metrics.monthly.map((m) => m.value),
                      1,
                    );
                    return (
                      <div className="bar-column" key={item.month}>
                        <div className="bar-value">
                          {item.value.toLocaleString(undefined, {
                            maximumFractionDigits: 1,
                          })}
                        </div>
                        <div className="bar-track">
                          <div
                            style={{
                              height: `${Math.max((item.value / maxMonth) * 100, 4)}%`,
                            }}
                          />
                        </div>
                        <span>{item.month}</span>
                      </div>
                    );
                  })}
                </div>
              </article>

              <div className="assumptions-card">
                <span className="eyebrow">MODEL NOTES</span>
                <h3 className="section-subtitle mt-1">Key assumptions</h3>
                {assumptions.length ? (
                  <ul>
                    {assumptions.map((assumption, index) => (
                      <li key={`${assumption}-${index}`}>
                        <span>{index + 1}</span>
                        <p style={{ margin: 0 }}>{assumption}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-note mt-2">No assumptions recorded.</p>
                )}
              </div>
            </div>

            {/* 4. Workbook Files Table (if available) */}
            {(filesLoading || filesError || files.length > 0) && (
              <div>
                <div className="card-heading mb-3">
                  <div>
                    <span className="eyebrow">WORKBOOK FILES</span>
                    <h3>Saved versions</h3>
                  </div>
                </div>
                {filesLoading ? (
                  <p className="empty-note">Loading workbook files...</p>
                ) : filesError ? (
                  <div className="error-box" role="alert">
                    {filesError}
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>File name</th>
                          <th>Version</th>
                          <th>Size</th>
                          <th>Created</th>
                          <th className="text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {files.map((file) => (
                          <tr key={file.id}>
                            <td>{file.file_name}</td>
                            <td>v{file.version}</td>
                            <td>{fileSize(file.file_size)}</td>
                            <td>{display(file.created_at)}</td>
                            <td className="text-right">
                              <Button
                                variant="outline"
                                type="button"
                                onClick={() => onDownloadFile?.(file)}
                                disabled={!onDownloadFile}
                              >
                                Download
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 5. Production Schedule Table */}
            <div>
              <PlanTable rows={rows} metrics={metrics} />
            </div>
          </div>
        )}

        {showChat && (
          <aside className="plan-communication-area">
            <div className="workspace-section-header compact">
              <div>
                <span className="eyebrow">REVISION WORKSPACE</span>
                <h3>Revisions & Chat</h3>
              </div>
              {currentRevision && (
                <span className="revision-badge">
                  R{currentRevision.revision_number}
                </span>
              )}
            </div>

            {/* Revision History Accordion */}
            <div className="revision-history-accordion">
              <button
                type="button"
                className="revision-history-toggle"
                onClick={() => setShowRevisionHistory((prev) => !prev)}
              >
                <div className="flex-center gap-2">
                  <Icon name="clock" />
                  <span>Revision History ({revisions.length})</span>
                </div>
                <small>{showRevisionHistory ? "Hide ▲" : "View ▼"}</small>
              </button>

              {showRevisionHistory && (
                <div className="revision-history-body">
                  {revisions.length ? (
                    <div className="revision-list">
                      {revisions.map((revision) => {
                        const isCurrent = revision.id === currentRevision?.id;
                        return (
                          <div
                            className={`revision-row ${isCurrent ? "is-current-revision" : ""}`}
                            key={revision.id}
                          >
                            <div className="revision-info">
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                }}
                              >
                                <strong>
                                  Revision {revision.revision_number}
                                </strong>
                                {isCurrent && (
                                  <span className="revision-current-tag">
                                    Active
                                  </span>
                                )}
                              </div>
                              <span className="revision-summary">
                                {revision.change_summary}
                              </span>
                              <small className="revision-date">
                                {new Date(revision.created_at).toLocaleString()}
                              </small>
                            </div>
                            <div className="revision-actions">
                              {!isCurrent && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  isLoading={
                                    restoringRevisionId === revision.id
                                  }
                                  onClick={() => onRestoreRevision(revision)}
                                  style={{
                                    minHeight: "30px",
                                    padding: "0 10px",
                                    fontSize: "11px",
                                  }}
                                >
                                  Restore
                                </Button>
                              )}
                              {onDeleteRevision && !isCurrent && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  disabled={
                                    !workspace?.permissions.canDeleteRevision
                                  }
                                  isLoading={deletingRevisionId === revision.id}
                                  onClick={() => onDeleteRevision(revision)}
                                  aria-label={`Delete revision ${revision.revision_number}`}
                                  title="Delete revision"
                                  style={{
                                    minHeight: "30px",
                                    padding: "0 8px",
                                    fontSize: "11px",
                                    color: "var(--danger, #b91c1c)",
                                  }}
                                >
                                  <Icon name="trash" /> Delete
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="empty-note">No revisions recorded.</p>
                  )}
                </div>
              )}
            </div>

            <div className="prompt-suggestions">
              {suggestions.map((suggestion) => (
                <button
                  type="button"
                  key={suggestion}
                  onClick={() => submitMessage(suggestion)}
                  disabled={sending || !workspace?.permissions.canMessage}
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <div className="conversation-list" aria-live="polite">
              {messages.length ? (
                messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    currentRevisionId={currentRevision?.id}
                    applyingProposalId={applyingProposalId}
                    onApplyProposal={onApplyProposal}
                    onCancelProposal={onCancelProposal}
                  />
                ))
              ) : (
                <div className="conversation-empty">
                  <span className="eyebrow">READY</span>
                  <p>
                    {currentRevision
                      ? "Revision loaded. Ask for adjustments or corrections."
                      : "Select a saved plan."}
                  </p>
                </div>
              )}
              {sending && (
                <div className="workspace-message workspace-message-assistant">
                  <p>Analyzing request and calculating plan modifications...</p>
                </div>
              )}
            </div>

            <form
              className="workspace-composer"
              onSubmit={(event) => {
                event.preventDefault();
                submitMessage();
              }}
            >
              <div style={{ position: "relative", width: "100%" }}>
                <textarea
                  value={draft}
                  onChange={(event) =>
                    setDraft(event.target.value.slice(0, 4_000))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      submitMessage();
                    }
                  }}
                  disabled={sending || !workspace?.permissions.canMessage}
                  placeholder="Ask a question or request changes (e.g., 'Change workers to 6')"
                  rows={3}
                  style={{
                    paddingRight: "44px",
                    paddingBottom: "32px",
                    resize: "none",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    bottom: "10px",
                    right: "10px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "10px",
                      color: "var(--muted)",
                      opacity: 0.8,
                    }}
                  >
                    {draft.length}/4000
                  </span>
                  <Button
                    type="submit"
                    disabled={
                      !draft.trim() ||
                      sending ||
                      !workspace?.permissions.canMessage
                    }
                    isLoading={sending}
                    style={{
                      padding: "0",
                      width: "28px",
                      height: "28px",
                      minWidth: "28px",
                      maxWidth: "28px",
                      minHeight: "28px",
                      maxHeight: "28px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "6px",
                    }}
                  >
                    {!sending && <Icon name="arrowUp" />}
                  </Button>
                </div>
              </div>
            </form>
          </aside>
        )}
      </section>
    </div>
  );
}
