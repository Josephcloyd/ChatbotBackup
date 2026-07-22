import React from "react";
import { Brand } from "../molecules/Brand";
import { StatusIndicator } from "../atoms/StatusIndicator";
import { ModeSwitch } from "../molecules/ModeSwitch";
import { Icon } from "../atoms/Icon";
import { Button } from "../atoms/Button";
import { Textarea } from "../atoms/Input";

export const TEMPLATE_OPTIONS = [
  { id: "HourBased_Annotation_Production_Plan_Template.xlsx", name: "Hour-Based Annotation Plan" },
  { id: "CollectionBased_Production_Plan_Template.xlsx", name: "Collection-Based Plan" },
  { id: "Drumming_Production_Plan_Template.xlsx", name: "Drumming Production Plan" },
  { id: "StatusBased_Production_Plan_Template.xlsx", name: "Status-Based Plan" },
];

interface SidebarProps {
  user: { username: string; role: "admin" | "operator" };
  plannerOnline: boolean;
  adminTab: "plans" | "operators";
  setAdminTab: (tab: "plans" | "operators") => void;
  mode: "dynamic" | "template";
  setMode: (mode: "dynamic" | "template") => void;
  selectedTemplate: string;
  setSelectedTemplate: (template: string) => void;
  prompt: string;
  setPrompt: (prompt: string) => void;
  placeholder?: string;
  loading: boolean;
  error: string;
  generatePlan: () => void;
}

export function Sidebar({
  user,
  plannerOnline,
  adminTab,
  setAdminTab,
  mode,
  setMode,
  selectedTemplate,
  setSelectedTemplate,
  prompt,
  setPrompt,
  placeholder,
  loading,
  error,
  generatePlan,
}: SidebarProps) {
  return (
    <>
      <div className="brand-section-desktop-only">
        <Brand variant="dark" showSubtitle />
      </div>

      {/* User Card */}
      <div className="user-card">
        <div className="user-card-label">Logged In As</div>
        <div className="user-card-info">
          {user.username} <span className="user-card-role">{user.role}</span>
        </div>
      </div>

      {/* Model Card */}
      <div className="model-card">
        <div className="model-topline">
          <StatusIndicator status={plannerOnline ? "online" : "offline"} />
          <span>Ollama planner</span>
          <small>{plannerOnline ? "Online" : "Offline"}</small>
        </div>
        <div className="model-name">
          Active Model <span>LOCAL</span>
        </div>
      </div>

      {user.role === "operator" ? (
        <>
          <div className="panel-section">
            <label>Workbook mode</label>
            <ModeSwitch mode={mode} onModeChange={setMode} />
            <p className="field-help">
              {mode === "dynamic"
                ? "Build a polished workbook from scratch."
                : "Fill the official workbook structure."}
            </p>
          </div>

          {mode === "template" && (
            <div className="panel-section">
              <label htmlFor="template-select">Select Template</label>
              <select
                id="template-select"
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.375rem",
                  border: "1px solid var(--border-color, #cbd5e1)",
                  backgroundColor: "var(--bg-surface, #ffffff)",
                  color: "var(--text-color, #0f172a)",
                  fontSize: "0.875rem",
                  marginTop: "0.25rem",
                }}
              >
                {TEMPLATE_OPTIONS.map((tmpl) => (
                  <option key={tmpl.id} value={tmpl.id}>
                    {tmpl.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="panel-section grow">
            <label htmlFor="prompt">Describe your production plan</label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={placeholder || "Create a production plan for a class of 4 annotators over 4 calendar months with 400 total hours, starting today."}
            />
            <div className="prompt-meta">
              <span>Natural language</span>
              <span>{prompt.length} characters</span>
            </div>
          </div>

          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          <Button
            className="generate-button"
            onClick={generatePlan}
            disabled={loading || (prompt.trim().length > 0 && prompt.trim().length < 10)}
            isLoading={loading}
          >
            {!loading && <Icon name="spark" />} {loading ? "Building your plan..." : "Generate plan"}
          </Button>
          <p className="privacy-note">Runs locally through Ollama. Data saved under your account.</p>
        </>
      ) : (
        <div className="panel-section grow admin-panel-nav">
          <label>Administration Panels</label>
          <button
            className={`admin-nav-btn ${adminTab === "plans" ? "active" : ""}`}
            onClick={() => setAdminTab("plans")}
          >
            <Icon name="grid" /> Plans Overview
          </button>
          <button
            className={`admin-nav-btn ${adminTab === "operators" ? "active" : ""}`}
            onClick={() => setAdminTab("operators")}
          >
            <Icon name="users" /> Manage Operators
          </button>
        </div>
      )}
    </>
  );
}
