import React from "react";
import { Button } from "../atoms/Button";
import type { HistoryRecord, OperatorAccount } from "../../lib/adminTypes";

export interface EditPlanFormValues {
  project_title: string;
  summary: string;
  planning_start_date: string;
  planning_end_date: string;
  actual_start_date: string;
  actual_end_date: string;
  actual_hours: string;
  requested_team_size: string;
}

interface EditPlanModalProps {
  values: EditPlanFormValues;
  errors: Partial<Record<keyof EditPlanFormValues, string>>;
  message: string;
  saving: boolean;
  setValue: (field: keyof EditPlanFormValues, value: string) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
}

export function EditPlanModal({
  values,
  errors,
  message,
  saving,
  setValue,
  onClose,
  onSubmit,
}: EditPlanModalProps) {
  const textFields: Array<[keyof EditPlanFormValues, string, string, string]> = [
    ["planning_start_date", "Planning start date", "date", "Choose planning start date"],
    ["planning_end_date", "Planning end date", "date", "Choose planning end date"],
    ["actual_start_date", "Actual start date", "date", "Choose actual start date"],
    ["actual_end_date", "Actual end date", "date", "Choose actual end date"],
    ["actual_hours", "Actual hours", "number", "Enter actual hours"],
    ["requested_team_size", "Requested team size", "number", "Set team size"],
  ];

  return (
    <div className="modal-overlay" role="presentation">
      <form onSubmit={onSubmit} className="modal-content modal-wide" role="dialog" aria-modal="true" aria-labelledby="edit-plan-title">
        <h3 id="edit-plan-title" className="modal-title">Edit Plan Information</h3>

        <div className="form-group-compact">
          <label htmlFor="edit-project-title">Project Title</label>
          <input
            id="edit-project-title"
            value={values.project_title}
            onChange={(event) => setValue("project_title", event.target.value)}
            required
            placeholder="Enter project title"
            className="input-atom editable-placeholder-field"
          />
          {errors.project_title && <p className="field-error">{errors.project_title}</p>}
        </div>

        <div className="form-group-compact">
          <label htmlFor="edit-summary">Summary Description</label>
          <textarea
            id="edit-summary"
            value={values.summary}
            onChange={(event) => setValue("summary", event.target.value)}
            required
            placeholder="Add summary"
            className="textarea-atom editable-placeholder-field"
          />
          {errors.summary && <p className="field-error">{errors.summary}</p>}
        </div>

        <div className="admin-form-grid">
          {textFields.map(([field, label, type, placeholder]) => (
            <div className="form-group-compact" key={field}>
              <label htmlFor={`edit-${field}`}>{label}</label>
              <input
                id={`edit-${field}`}
                type={type}
                min={type === "number" ? "0" : undefined}
                value={values[field]}
                onChange={(event) => setValue(field, event.target.value)}
                placeholder={placeholder}
                className="input-atom editable-placeholder-field"
              />
              {errors[field] && <p className="field-error">{errors[field]}</p>}
            </div>
          ))}
        </div>

        {message && <div className={message.startsWith("Saved") ? "success-box" : "error-box"} role="alert">{message}</div>}

        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose} type="button" disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" isLoading={saving}>
            Save Updates
          </Button>
        </div>
      </form>
    </div>
  );
}

interface RejectPlanModalProps {
  planTitle: string;
  reason: string;
  setReason: (value: string) => void;
  saving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function RejectPlanModal({ planTitle, reason, setReason, saving, error, onClose, onConfirm }: RejectPlanModalProps) {
  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="reject-plan-title">
        <h3 id="reject-plan-title" className="modal-title danger">Reject Plan</h3>
        <p className="modal-text">Rejecting <strong>{planTitle}</strong> requires a reason for the review record.</p>
        <div className="form-group-compact">
          <label htmlFor="rejection-reason">Rejection reason</label>
          <textarea
            id="rejection-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="textarea-atom"
            placeholder="Add rejection reason"
            required
          />
        </div>
        {error && <div className="error-box" role="alert">{error}</div>}
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} isLoading={saving} disabled={reason.trim().length === 0}>
            Reject Plan
          </Button>
        </div>
      </div>
    </div>
  );
}

interface DeletePlanModalProps {
  plan: HistoryRecord;
  saving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeletePlanModal({ plan, saving, error, onClose, onConfirm }: DeletePlanModalProps) {
  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="delete-plan-title">
        <h3 id="delete-plan-title" className="modal-title danger">Delete Plan</h3>
        <p className="modal-text">
          This will permanently delete <strong>{plan.project_title}</strong>. This is destructive and cannot be undone.
        </p>
        {error && <div className="error-box" role="alert">{error}</div>}
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} isLoading={saving}>Delete Plan</Button>
        </div>
      </div>
    </div>
  );
}

interface BulkDeletePlansModalProps {
  plans: HistoryRecord[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function BulkDeletePlansModal({ plans, saving, error, onClose, onConfirm }: BulkDeletePlansModalProps) {
  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="bulk-delete-plan-title">
        <h3 id="bulk-delete-plan-title" className="modal-title danger">Delete Selected Plans</h3>
        <p className="modal-text">
          This will permanently delete <strong>{plans.length}</strong> selected production plans. This is destructive and cannot be undone.
        </p>
        <div className="bulk-delete-list">
          {plans.slice(0, 6).map((plan) => (
            <span key={plan.id}>{plan.project_title}</span>
          ))}
          {plans.length > 6 && <span>and {plans.length - 6} more...</span>}
        </div>
        {error && <div className="error-box" role="alert">{error}</div>}
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} isLoading={saving}>Delete Selected</Button>
        </div>
      </div>
    </div>
  );
}

interface DeleteOperatorModalProps {
  operatorName: string;
  operators: OperatorAccount[];
  reassignTarget: string;
  setReassignTarget: (val: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteOperatorModal({
  operatorName,
  operators,
  reassignTarget,
  setReassignTarget,
  onClose,
  onConfirm,
}: DeleteOperatorModalProps) {
  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="delete-user-title">
        <h3 id="delete-user-title" className="modal-title danger">Delete User: {operatorName}</h3>
        <p className="modal-text">
          Before deleting operator <strong>{operatorName}</strong>, you can reassign their generated
          production schedules to another active operator to avoid losing historical analytics.
        </p>

        <div className="form-group-compact">
          <label htmlFor="reassign-plans">Reassign plans to:</label>
          <select
            id="reassign-plans"
            value={reassignTarget}
            onChange={(event) => setReassignTarget(event.target.value)}
            className="select-atom editable-placeholder-field"
          >
            <option value="">Do not reassign</option>
            {operators
              .filter((op) => op.username !== operatorName && op.role === "operator" && op.active !== false)
              .map((op) => (
                <option key={op.id} value={op.username}>
                  {op.username}
                </option>
              ))}
          </select>
        </div>

        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Confirm Deletion
          </Button>
        </div>
      </div>
    </div>
  );
}
