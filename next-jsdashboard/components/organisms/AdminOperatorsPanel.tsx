import React from "react";
import { Icon } from "../atoms/Icon";
import { Button } from "../atoms/Button";
import type { FrontendRole, OperatorAccount } from "../../lib/adminTypes";

interface AdminOperatorsPanelProps {
  operators: OperatorAccount[];
  currentUser: { id?: string; username: string; displayName?: string; role: FrontendRole };
  onDeleteOperator: (op: OperatorAccount) => void;
  onUpdateOperator: (
    op: OperatorAccount,
    updates: { role?: FrontendRole; active?: boolean },
  ) => void;
  newEmail: string;
  setNewEmail: (val: string) => void;
  newUsername: string;
  setNewUsername: (val: string) => void;
  newPassword: string;
  setNewPassword: (val: string) => void;
  newRole: FrontendRole;
  setNewRole: (val: FrontendRole) => void;
  handleCreateOperator: (e: React.FormEvent) => void;
  notification?: { type: "success" | "error"; message: string } | null;
  onClearNotification?: () => void;
}

function displayDate(value: string | undefined): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export function AdminOperatorsPanel({
  operators,
  currentUser,
  onDeleteOperator,
  onUpdateOperator,
  newEmail,
  setNewEmail,
  newUsername,
  setNewUsername,
  newPassword,
  setNewPassword,
  newRole,
  setNewRole,
  handleCreateOperator,
  notification,
  onClearNotification,
}: AdminOperatorsPanelProps) {
  return (
    <section className="admin-operators-grid">
      {notification && (
        <div className={`admin-notification-banner ${notification.type}`}>
          <span>
            {notification.type === "success" ? "✓ " : "⚠ "}
            {notification.message}
          </span>
          {onClearNotification && (
            <button
              type="button"
              className="banner-close-btn"
              onClick={onClearNotification}
              aria-label="Close notification"
            >
              ✕
            </button>
          )}
        </div>
      )}
      <form
        onSubmit={handleCreateOperator}
        className="schedule-card admin-form-card"
      >
        <h3 className="form-title">Create User Profile</h3>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr auto",
            gap: "12px",
            alignItems: "end",
          }}
        >
          <div className="form-group-compact" style={{ margin: 0 }}>
            <label htmlFor="new-email">Email Address</label>
            <input
              id="new-email"
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              required
              placeholder="user@example.com"
              className="input-atom editable-placeholder-field"
            />
          </div>

          <div className="form-group-compact" style={{ margin: 0 }}>
            <label htmlFor="new-username">Username</label>
            <input
              id="new-username"
              value={newUsername}
              onChange={(event) => setNewUsername(event.target.value)}
              required
              placeholder="Enter username"
              className="input-atom editable-placeholder-field"
            />
          </div>

          <div className="form-group-compact" style={{ margin: 0 }}>
            <label htmlFor="new-password">Temporary Password</label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              placeholder="Set temporary password"
              className="input-atom editable-placeholder-field"
            />
          </div>

          <div className="form-group-compact" style={{ margin: 0 }}>
            <label htmlFor="new-role">Role Access</label>
            <select
              id="new-role"
              value={newRole}
              onChange={(event) =>
                setNewRole(event.target.value as FrontendRole)
              }
              className="select-atom editable-placeholder-field"
            >
              <option value="operator">Operator</option>
              <option value="admin">Administrator</option>
            </select>
          </div>

          <Button type="submit">Invite</Button>
        </div>

        <p style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
          An invitation email will be sent to the specified address. The user must
          click the link and change their temporary password before signing in.
        </p>
      </form>

      <div className="schedule-card" style={{ padding: "24px" }}>
        <div className="card-heading">
          <div>
            <span className="eyebrow">OPERATOR ACCOUNTS</span>
            <h3>System User Profiles</h3>
          </div>
        </div>

        <div className="table-scroll admin-table-scroll">
          <table className="admin-table admin-operators-table" style={{ minWidth: 850 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 120 }}>Username</th>
                <th style={{ minWidth: 180, maxWidth: 240 }}>Email</th>
                <th style={{ width: 120 }}>Role</th>
                <th style={{ width: 90 }}>Status</th>
                <th style={{ width: 60 }}>Plans</th>
                <th style={{ width: 110 }}>Created</th>
                <th style={{ width: 110 }}>Updated</th>
                <th style={{ width: 190, textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {operators.map((op) => {
                const isSelf =
                  op.username === currentUser.username ||
                  op.id === currentUser.id;
                return (
                  <tr key={op.id}>
                    <td
                      className="font-bold"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {op.username}
                    </td>
                    <td
                      style={{
                        color: "var(--muted)",
                        fontSize: 12,
                        maxWidth: 220,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={op.email ?? undefined}
                    >
                      {op.email ?? "—"}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <select
                        className="select-atom compact-select"
                        style={{ width: "fit-content", minWidth: 95 }}
                        value={op.role}
                        disabled={isSelf}
                        onChange={(event) =>
                          onUpdateOperator(op, {
                            role: event.target.value as FrontendRole,
                          })
                        }
                        aria-label={`Update role for ${op.username}`}
                        title="Select role"
                      >
                        <option value="operator">Operator</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {(() => {
                        const status = op.status ?? (op.active === false ? "inactive" : "active");
                        const badgeClass =
                          status === "pending"
                            ? "status-pending"
                            : status === "inactive"
                            ? "status-archived"
                            : "status-approved";
                        const statusLabel =
                          status === "pending"
                            ? "Pending"
                            : status === "inactive"
                            ? "Inactive"
                            : "Active";
                        return (
                          <span className={`compact-badge ${badgeClass}`}>
                            {statusLabel}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {Number(op.planCount ?? 0).toLocaleString()}
                    </td>
                    <td style={{ whiteSpace: "nowrap", paddingRight: 16 }}>
                      {displayDate(op.createdAt)}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {displayDate(op.updatedAt)}
                    </td>
                    <td className="text-right actions-cell">
                      {(() => {
                        const status = op.status ?? (op.active === false ? "inactive" : "active");
                        const isInactive = status === "inactive";
                        const isPending = status === "pending";
                        const actionText = isPending ? "Activate" : isInactive ? "Reactivate" : "Deactivate";
                        const btnClass = isInactive || isPending ? "edit-btn" : "deactivate-btn";
                        return (
                          <button
                            className={`action-btn-text ${btnClass}`}
                            onClick={() =>
                              onUpdateOperator(op, { active: isInactive || isPending })
                            }
                            disabled={isSelf}
                            title={
                              isPending
                                ? "Activate this user account manually"
                                : isInactive
                                ? "Reactivate this user account"
                                : "Deactivate this user account"
                            }
                          >
                            {actionText}
                          </button>
                        );
                      })()}
                      <button
                        className="action-btn delete-btn"
                        onClick={() => onDeleteOperator(op)}
                        disabled={isSelf || Number(op.planCount ?? 0) > 0}
                        title={
                          isSelf
                            ? "You cannot delete your own account"
                            : Number(op.planCount ?? 0) > 0
                            ? "Reassign this user's plans before deleting"
                            : "Permanently delete this user account"
                        }
                      >
                        <Icon name="trash" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {operators.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-muted p-4">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="empty-note mt-4">
          Permanent deletion is disabled for accounts that still own plans.
          Reassign their plans first.
        </p>
      </div>
    </section>
  );
}
