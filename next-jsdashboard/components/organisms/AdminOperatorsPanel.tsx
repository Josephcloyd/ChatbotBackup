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
  newUsername: string;
  setNewUsername: (val: string) => void;
  newPassword: string;
  setNewPassword: (val: string) => void;
  newRole: FrontendRole;
  setNewRole: (val: FrontendRole) => void;
  handleCreateOperator: (e: React.FormEvent) => void;
}

function displayDate(value: string | undefined): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export function AdminOperatorsPanel({
  operators,
  currentUser,
  onDeleteOperator,
  onUpdateOperator,
  newUsername,
  setNewUsername,
  newPassword,
  setNewPassword,
  newRole,
  setNewRole,
  handleCreateOperator,
}: AdminOperatorsPanelProps) {
  return (
    <section className="admin-operators-grid">
      <form
        onSubmit={handleCreateOperator}
        className="schedule-card admin-form-card"
      >
        <h3 className="form-title">Create User Profile</h3>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr auto",
            gap: "12px",
            alignItems: "end",
          }}
        >
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
            <label htmlFor="new-password">Password</label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              placeholder="Enter temporary password"
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
              <option value="operator">Operator (stored as DB user)</option>
              <option value="admin">Administrator</option>
            </select>
          </div>

          <Button type="submit">Create User Account</Button>
        </div>
      </form>

      <div className="schedule-card" style={{ padding: "24px" }}>
        <div className="card-heading">
          <div>
            <span className="eyebrow">OPERATOR ACCOUNTS</span>
            <h3>System User Profiles</h3>
          </div>
        </div>

        <div className="table-scroll admin-table-scroll">
          <table className="admin-table admin-operators-table">
            <thead>
              <tr>
                <th>Username</th>
                <th style={{ width: "160px" }}>Role</th>
                <th style={{ width: "100px" }}>Status</th>
                <th>Plans</th>
                <th>Created</th>
                <th>Updated</th>
                <th className="text-right" style={{ width: "200px" }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {operators.map((op) => {
                const isSelf =
                  op.username === currentUser.username ||
                  op.id === currentUser.id;
                return (
                  <tr key={op.id}>
                    <td className="font-bold">{op.username}</td>
                    <td>
                      <select
                        className="select-atom compact-select"
                        style={{ width: "100%", maxWidth: 140 }}
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
                      <small
                        className="db-role-note"
                        style={{ color: "var(--muted)", fontSize: 10 }}
                      >
                        DB: {op.role === "admin" ? "admin" : "user"}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`compact-badge ${op.active === false ? "status-archived" : "status-approved"}`}
                      >
                        {op.active === false ? "inactive" : "active"}
                      </span>
                    </td>
                    <td>{Number(op.planCount ?? 0).toLocaleString()}</td>
                    <td>{displayDate(op.createdAt)}</td>
                    <td>{displayDate(op.updatedAt)}</td>
                    <td className="text-right actions-cell">
                      <button
                        className={`action-btn-text ${op.active === false ? "edit-btn" : ""}`}
                        onClick={() =>
                          onUpdateOperator(op, { active: op.active === false })
                        }
                        disabled={isSelf}
                        title={
                          op.active === false
                            ? "Activate user"
                            : "Deactivate user"
                        }
                      >
                        {op.active === false ? "Activate" : "Deactivate"}
                      </button>
                      <button
                        className="action-btn delete-btn"
                        onClick={() => onDeleteOperator(op)}
                        disabled={isSelf || Number(op.planCount ?? 0) > 0}
                        title={
                          Number(op.planCount ?? 0) > 0
                            ? "Reassign plans before deleting"
                            : "Delete user"
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
                  <td colSpan={7} className="text-center text-muted p-4">
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
