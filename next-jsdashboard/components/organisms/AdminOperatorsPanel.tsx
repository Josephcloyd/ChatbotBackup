import React from "react";
import { Icon } from "../atoms/Icon";
import { Button } from "../atoms/Button";

interface AdminOperatorsPanelProps {
  operators: any[];
  currentUser: any;
  onDeleteOperator: (op: any) => void;
  // Form props
  newUsername: string;
  setNewUsername: (val: string) => void;
  newPassword: string;
  setNewPassword: (val: string) => void;
  newRole: "admin" | "operator";
  setNewRole: (val: "admin" | "operator") => void;
  handleCreateOperator: (e: React.FormEvent) => void;
}

export function AdminOperatorsPanel({
  operators,
  currentUser,
  onDeleteOperator,
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
      {/* Operators List */}
      <div className="schedule-card" style={{ padding: "24px" }}>
        <div className="card-heading">
          <div>
            <span className="eyebrow">OPERATOR ACCOUNTS</span>
            <h3>System Operator Profiles</h3>
          </div>
        </div>

        <div className="table-scroll admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Created At</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {operators.map((op) => (
                <tr key={op.id}>
                  <td className="font-bold">{op.username}</td>
                  <td>
                    <span className={`role-badge ${op.role === "admin" ? "role-admin" : "role-op"}`}>
                      {op.role}
                    </span>
                  </td>
                  <td>{new Date(op.createdAt).toLocaleDateString()}</td>
                  <td className="text-right actions-cell">
                    <button
                      className="action-btn delete-btn"
                      onClick={() => onDeleteOperator(op)}
                      disabled={op.username === currentUser.username}
                      title="Delete operator"
                    >
                      <Icon name="trash" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Operator Form */}
      <form onSubmit={handleCreateOperator} className="schedule-card admin-form-card">
        <h3 className="form-title">Create Operator Profile</h3>

        <div className="form-group-compact">
          <label>Username</label>
          <input
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            required
            placeholder="e.g. operator2"
            className="input-atom"
          />
        </div>

        <div className="form-group-compact">
          <label>Password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            placeholder="••••••••"
            className="input-atom"
          />
        </div>

        <div className="form-group-compact">
          <label>Role Access</label>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as "admin" | "operator")}
            className="select-atom"
          >
            <option value="operator">Operator (Prompt Generator)</option>
            <option value="admin">Administrator (Manager)</option>
          </select>
        </div>

        <Button type="submit" className="mt-2 w-full">
          Create User Account
        </Button>
      </form>
    </section>
  );
}
