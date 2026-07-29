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
  if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
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

function safeAssistantResponse(message: PlanConversationMessage): PlanAssistantResponse | null {
  const response = message.metadata?.assistantResponse;
  if (response && typeof response === "object") return response as PlanAssistantResponse;
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
  const staleProposal = Boolean(proposal && proposal.basedOnRevisionId !== currentRevisionId);

  return (
    <article className={`workspace-message workspace-message-${message.role}`}>
      <div className="workspace-message-meta">
        <span>{message.role === "assistant" ? "AI assistant" : message.role}</span>
        <time>{new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
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
          {response.clarificationQuestions.map((question) => <li key={question}>{question}</li>)}
        </ul>
      ) : null}

      {proposal ? (
        <div className="proposal-card">
          <div className="proposal-card-header">
            <div>
              <span className="eyebrow">PROPOSAL</span>
              <h4>{proposal.requestSummary}</h4>
            </div>
            <span className="revision-badge">base {proposal.basedOnRevisionId.slice(0, 8)}</span>
          </div>
          <p>{proposal.interpretedRequest}</p>
          <div className="proposal-change-list">
            {proposal.changes.map((change) => (
              <div key={`${proposal.id}-${change.field}-${change.label}`} className="proposal-change-row">
                <span>{change.label}</span>
                <strong>{display(change.previousValue)}</strong>
                <Icon name="clock" />
                <strong>{display(change.proposedValue)}</strong>
              </div>
            ))}
          </div>
          {proposal.warnings.length ? (
            <div className="proposal-warning">
              {proposal.warnings.map((warning) => <p key={warning}>{warning}</p>)}
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
            {staleProposal && <span className="proposal-stale-note">Reloaded after a newer revision.</span>}
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
  downloadUrl,
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
  const currentRevision = workspace?.currentRevision;
  const revisions = workspace?.revisions ?? [];
  const messages = workspace?.conversation ?? [];
  const assumptions = useMemo(
    () => plan.raw_plan.project.assumptions?.slice(0, 6) ?? [],
    [plan.raw_plan.project.assumptions],
  );

  async function submitMessage(value = draft) {
    const trimmed = value.trim();
    if (!trimmed || sending || !workspace?.permissions.canMessage) return;
    await onSendMessage(trimmed);
    setDraft("");
  }

  return (
    <section className="plan-workspace">
      <div className="plan-review-area">
        <div className="workspace-section-header">
          <div>
            <span className="eyebrow">PLAN WORKSPACE</span>
            <h2>{plan.project_title}</h2>
          </div>
          <div className="workspace-header-actions">
            {currentRevision && <span className="revision-badge">Revision {currentRevision.revision_number}</span>}
            {downloadUrl && (
              <a className="download-button" href={downloadUrl} download>
                <Icon name="download" /> Workbook
              </a>
            )}
          </div>
        </div>

        {loading ? (
          <div className="workspace-loading">Loading workspace...</div>
        ) : error ? (
          <div className="error-box" role="alert">
            {error}
            <div className="mt-2">
              <Button type="button" variant="ghost" onClick={onRetry}>Retry</Button>
            </div>
          </div>
        ) : null}

        <div className="workspace-metrics-grid">
          <div><span>Plan ID</span><strong>{plan.id}</strong></div>
          <div><span>Assigned operator</span><strong>{plan.whatsapp_user_id}</strong></div>
          <div><span>Status</span><strong>{plan.status ?? "generated"}</strong></div>
          <div><span>Workbook mode</span><strong>{plan.workbook_mode === "official_template" ? "template" : "dynamic"}</strong></div>
          <div><span>Working days</span><strong>{metrics.scheduledDays}</strong></div>
          <div><span>Workers</span><strong>{metrics.teamSize}</strong></div>
          <div><span>Total {metrics.unitLabel}</span><strong>{metrics.totalPlanned.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
          <div><span>Daily target</span><strong>{(metrics.totalPlanned / Math.max(metrics.scheduledDays, 1)).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
        </div>

        <div className="prompt-card mt-4">
          <span className="eyebrow">ORIGINAL PROMPT</span>
          <p>{plan.project_description || plan.raw_plan.project.projectDescription}</p>
        </div>

        <div className="admin-two-column mt-6">
          <div>
            <h4 className="section-subtitle">Assumptions</h4>
            {assumptions.length ? (
              <ul className="compact-list">
                {assumptions.map((assumption, index) => <li key={`${assumption}-${index}`}>{assumption}</li>)}
              </ul>
            ) : (
              <p className="empty-note">No assumptions recorded.</p>
            )}
          </div>
          <div>
            <h4 className="section-subtitle">Revision history</h4>
            {revisions.length ? (
              <div className="revision-list">
                {revisions.map((revision) => {
                  const isCurrent = revision.id === currentRevision?.id;
                  return (
                    <div className="revision-row" key={revision.id}>
                      <div>
                        <strong>Revision {revision.revision_number}</strong>
                        <span>{revision.change_summary}</span>
                        <small>{new Date(revision.created_at).toLocaleString()}</small>
                      </div>
                      <div className="revision-actions">
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={isCurrent}
                          isLoading={restoringRevisionId === revision.id}
                          onClick={() => onRestoreRevision(revision)}
                        >
                          {isCurrent ? "Current" : "Restore"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={isCurrent || !onDeleteRevision || !workspace?.permissions.canDeleteRevision}
                          isLoading={deletingRevisionId === revision.id}
                          onClick={() => onDeleteRevision?.(revision)}
                          aria-label={`Delete revision ${revision.revision_number}`}
                          title={isCurrent ? "The current revision cannot be deleted" : "Delete revision"}
                        >
                          <Icon name="trash" /> Delete
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="empty-note">No revisions recorded.</p>
            )}
          </div>
        </div>

        {(filesLoading || filesError || files.length > 0) && (
          <div className="mt-6">
            <div className="card-heading">
              <div>
                <span className="eyebrow">WORKBOOK FILES</span>
                <h3>Saved versions</h3>
              </div>
            </div>
            {filesLoading ? (
              <p className="empty-note">Loading workbook files...</p>
            ) : filesError ? (
              <div className="error-box" role="alert">{filesError}</div>
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

        <div className="mt-6">
          <PlanTable rows={rows} metrics={metrics} />
        </div>
      </div>

      <aside className="plan-communication-area">
        <div className="workspace-section-header compact">
          <div>
            <span className="eyebrow">COMMUNICATION</span>
            <h3>{plan.project_title}</h3>
          </div>
          {currentRevision && <span className="revision-badge">R{currentRevision.revision_number}</span>}
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
              <p>{currentRevision ? "Revision loaded." : "Select a saved plan."}</p>
            </div>
          )}
          {sending && <div className="workspace-message workspace-message-assistant"><p>Analyzing...</p></div>}
        </div>

        <form
          className="workspace-composer"
          onSubmit={(event) => {
            event.preventDefault();
            submitMessage();
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 4_000))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitMessage();
              }
            }}
            disabled={sending || !workspace?.permissions.canMessage}
            placeholder="Ask about this selected plan"
            rows={4}
          />
          <div className="workspace-composer-footer">
            <span>{draft.length}/4000</span>
            <Button type="submit" disabled={!draft.trim() || sending || !workspace?.permissions.canMessage} isLoading={sending}>
              Send
            </Button>
          </div>
        </form>
      </aside>
    </section>
  );
}
