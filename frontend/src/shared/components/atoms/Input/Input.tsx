import React from "react";
import styles from "./Input.module.css";

interface InputProps {
  id?: string;
  type?: "text" | "email" | "password" | "search";
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  required?: boolean;
  autoComplete?: string;
  promptMark?: string;
  suffix?: React.ReactNode;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  className?: string;
  "aria-label"?: string;
}

export const Input = ({
  id,
  type = "text",
  placeholder,
  value,
  defaultValue,
  required,
  autoComplete,
  promptMark,
  suffix,
  onChange,
  onKeyDown,
  onBlur,
  className = "",
  "aria-label": ariaLabel,
}: InputProps) => {
  return (
    <div className={[styles.wrap, className].filter(Boolean).join(" ")}>
      {promptMark && (
        <span className={styles.prompt} aria-hidden="true">
          {promptMark}
        </span>
      )}
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        defaultValue={defaultValue}
        required={required}
        autoComplete={autoComplete}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        aria-label={ariaLabel}
        className={styles.input}
      />
      {suffix && <div className={styles.suffix}>{suffix}</div>}
    </div>
  );
};
