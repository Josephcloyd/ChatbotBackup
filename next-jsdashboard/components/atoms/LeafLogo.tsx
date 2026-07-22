import React from "react";

interface LeafLogoProps {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

export function LeafLogo({ width = 32, height = 32, className = "", style = {} }: LeafLogoProps) {
  return (
    <img
      src="/lifeplan-leaf.png"
      alt="LifePlan Logo"
      width={width}
      height={height}
      className={`leaf-logo-icon ${className}`}
      style={{
        objectFit: "contain",
        display: "inline-block",
        verticalAlign: "middle",
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        ...style
      }}
    />
  );
}
