import React from "react";

interface FormGroupProps {
  label: string;
  htmlFor?: string;
  error?: string;
  children: React.ReactNode;
}

export function FormGroup({ label, htmlFor, error, children }: FormGroupProps) {
  return (
    <div className="form-group">
      <label htmlFor={htmlFor} className="form-label">
        {label}
      </label>
      {children}
      {error && (
        <div role="alert" className="error-box mt-2">
          {error}
        </div>
      )}
    </div>
  );
}
