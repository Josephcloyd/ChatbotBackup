import React from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

export function Input({ error, className = "", ...props }: InputProps) {
  return (
    <input
      className={`input-atom ${error ? "input-error" : ""} ${className}`}
      {...props}
    />
  );
}

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
}

export function Textarea({ error, className = "", ...props }: TextareaProps) {
  return (
    <textarea
      className={`textarea-atom ${error ? "input-error" : ""} ${className}`}
      {...props}
    />
  );
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  options: { label: string; value: string }[];
}

export function Select({
  error,
  options,
  className = "",
  ...props
}: SelectProps) {
  return (
    <select
      className={`select-atom ${error ? "input-error" : ""} ${className}`}
      {...props}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
