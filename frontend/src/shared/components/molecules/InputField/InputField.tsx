import React, { useId } from "react";
import { Input } from "@/shared/components/atoms";
import styles from "./InputField.module.css";

interface InputFieldProps {
  label: string;
  type?: "text" | "email" | "password" | "search";
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  promptMark?: string;
  hintLabel?: string;
  hintHref?: string;
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  suffix?: React.ReactNode;
  name?: string;
}

export const InputField = ({
  label,
  type = "text",
  placeholder,
  required,
  autoComplete,
  promptMark,
  hintLabel,
  hintHref,
  value,
  onChange,
  onKeyDown,
  onBlur,
  suffix,
}: InputFieldProps) => {
  const id = useId();

  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label htmlFor={id}>{label.toUpperCase()}</label>
        {hintLabel && (
          <a href={hintHref ?? "#"} className={styles.hint}>
            {hintLabel}
          </a>
        )}
      </div>
      <Input
        id={id}
        type={type}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        promptMark={promptMark}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        suffix={suffix}
        aria-label={label}
      />
    </div>
  );
};
