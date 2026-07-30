import React from "react";
import Image from "next/image";

interface LeafLogoProps {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

export function LeafLogo({
  width = 32,
  height = 32,
  className = "",
  style = {},
}: LeafLogoProps) {
  return (
    <Image
      src="/lifeplan-leaf.png"
      alt="LifePlan Logo"
      width={typeof width === "string" ? parseInt(width, 10) || 32 : width}
      height={typeof height === "string" ? parseInt(height, 10) || 32 : height}
      className={`leaf-logo-icon ${className}`}
      style={{
        objectFit: "contain",
        display: "inline-block",
        verticalAlign: "middle",
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        ...style,
      }}
    />
  );
}
