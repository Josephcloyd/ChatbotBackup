import React from "react";

interface StatusIndicatorProps {
  status: "online" | "offline" | "pending";
}

export function StatusIndicator({ status }: StatusIndicatorProps) {
  return <span className={`status-dot ${status}`} />;
}
