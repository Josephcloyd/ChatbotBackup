import React from "react";

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ className = "", style }: SkeletonProps) {
  return (
    <div 
      className={`skeleton-atom ${className}`} 
      style={style} 
      aria-hidden="true"
    />
  );
}
