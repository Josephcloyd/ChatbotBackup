import React from "react";
import { Brand } from "../molecules/Brand";
import { StatusIndicator } from "../atoms/StatusIndicator";
import { ModeSwitch } from "../molecules/ModeSwitch";
import { Icon } from "../atoms/Icon";
import { Button } from "../atoms/Button";
import { Textarea } from "../atoms/Input";

interface SidebarProps {
  user: { username: string; role: "admin" | "operator" };
  plannerOnline: boolean;
  adminTab: "plans" | "operators";
  setAdminTab: (tab: "plans" | "operators") => void;
  mode: "dynamic" | "template";
  setMode: (mode: "dynamic" | "template") => void;
  prompt: string;
  setPrompt: (prompt: string) => void;
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
  prompt,
  setPrompt,
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

          <div className="panel-section grow">
            <label htmlFor="prompt">Describe your production plan</label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Enter prompt..."
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
            disabled={loading || prompt.trim().length < 10}
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
