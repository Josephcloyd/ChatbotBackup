"use client";

import React, { useState, useRef, useEffect } from "react";

// Defines the properties expected by the CustomSelect component
export interface CustomSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  className?: string;
  ariaLabel?: string;
}

export function CustomSelect({
  id,
  value,
  onChange,
  options,
  className = "",
  ariaLabel,
}: CustomSelectProps) {
  // Track whether the dropdown is currently open
  const [isOpen, setIsOpen] = useState(false);

  // Reference to the main container, used to detect clicks outside the component
  const containerRef = useRef<HTMLDivElement>(null);

  // Determine the currently selected option to display its label. Defaults to the first option if not found.
  const selectedOption =
    options.find((opt) => opt.value === value) || options[0];

  // Effect to handle clicking outside the select component to close the dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    // Bind the event listener to the document
    document.addEventListener("mousedown", handleClickOutside);

    // Cleanup the event listener on component unmount
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div
      className={`custom-select-container ${className}`.trim()}
      ref={containerRef}
      style={{ position: "relative" }}
    >
      {/* 
        The main trigger button for the custom select.
        Toggles the dropdown state on click and handles accessibility attributes.
      */}
      <button
        id={id}
        type="button"
        className={`select-atom custom-select-trigger ${isOpen ? "open" : ""}`.trim()}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        <span className="custom-select-value">{selectedOption?.label}</span>

        {/* Dropdown indicator arrow */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            opacity: 0.7,
            transform: isOpen ? "rotate(180deg)" : "none",
            transition: "transform 0.2s ease",
            position: "relative",
            right: "6px", // Adjusts arrow position slightly to the left for better alignment
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* 
        The dropdown menu, rendered only when isOpen is true. 
        Displays the list of options available for selection.
      */}
      {isOpen && (
        <div className="custom-select-dropdown">
          <ul role="listbox">
            {options.map((opt) => (
              <li
                key={opt.value}
                role="option"
                aria-selected={opt.value === value}
                className={`custom-select-option ${opt.value === value ? "selected" : ""}`.trim()}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false); // Close dropdown after selection
                }}
              >
                {opt.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
