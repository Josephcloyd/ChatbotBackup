import React from "react";

interface ModeSwitchProps {
  mode: "dynamic" | "template";
  onModeChange: (mode: "dynamic" | "template") => void;
}

export function ModeSwitch({ mode, onModeChange }: ModeSwitchProps) {
  return (
    <div className="mode-switch" role="group" aria-label="Workbook mode">
      <button
        type="button"
        className={mode === "dynamic" ? "active" : ""}
        onClick={() => onModeChange("dynamic")}
      >
        Dynamic
      </button>
      <button
        type="button"
        className={mode === "template" ? "active" : ""}
        onClick={() => onModeChange("template")}
      >
        Template
      </button>
    </div>
  );
}
