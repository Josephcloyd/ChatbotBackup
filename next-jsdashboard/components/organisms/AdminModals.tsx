import React from "react";
import { Button } from "../atoms/Button";

interface EditPlanModalProps {
  editTitle: string;
  setEditTitle: (val: string) => void;
  editSummary: string;
  setEditSummary: (val: string) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function EditPlanModal({
  editTitle,
  setEditTitle,
  editSummary,
  setEditSummary,
  onClose,
  onSubmit,
}: EditPlanModalProps) {
  return (
    <div className="modal-overlay">
      <form onSubmit={onSubmit} className="modal-content">
        <h3 className="modal-title">Edit Plan Information</h3>

        <div className="form-group-compact">
          <label>Project Title</label>
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            required
            className="input-atom"
          />
        </div>
        <div className="form-group-compact">
          <label>Summary Description</label>
          <textarea
            value={editSummary}
            onChange={(e) => setEditSummary(e.target.value)}
            required
            className="textarea-atom"
            style={{ height: "100px", resize: "none" }}
          />
        </div>

        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit">Save Updates</Button>
        </div>
      </form>
    </div>
  );
}

interface DeleteOperatorModalProps {
  operatorName: string;
  operators: any[];
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
    <div className="modal-overlay">
      <div className="modal-content">
        <h3 className="modal-title danger">Delete User: {operatorName}</h3>
        <p className="modal-text">
          Before deleting operator <strong>{operatorName}</strong>, you can reassign their generated
          production schedules to another active operator to avoid losing historical analytics.
        </p>

        <div className="form-group-compact">
          <label>Reassign plans to:</label>
          <select
            value={reassignTarget}
            onChange={(e) => setReassignTarget(e.target.value)}
            className="select-atom"
          >
            <option value="">Do not reassign (Keep orphaned or deleted)</option>
            {operators
              .filter((op) => op.username !== operatorName && op.role === "operator")
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
