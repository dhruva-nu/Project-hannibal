import type { ChangeEvent, MouseEvent, ReactNode } from "react";
import { okJSON } from "../engine";
import styles from "./controls.module.css";

const join = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(" ");

interface ButtonProps {
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  small?: boolean;
  danger?: boolean;
  on?: boolean;
  fixed?: boolean;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
  "aria-pressed"?: boolean;
}

export const ToolButton = ({ children, onClick, small, danger, on, fixed, disabled, title, ...aria }: ButtonProps) => (
  <button
    type="button"
    className={join(styles.btn, small && styles.small, danger && styles.danger, on && styles.on, fixed && styles.fixed)}
    onClick={onClick}
    disabled={disabled}
    title={title}
    {...aria}
  >
    {children}
  </button>
);

export const LinkButton = ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
  <button type="button" className={styles.linkButton} onClick={onClick}>
    {children}
  </button>
);

export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{label}</span>
    {children}
  </label>
);

interface TextFieldProps {
  value: string | number;
  onChange: (value: string) => void;
  mono?: boolean;
  placeholder?: string;
  fixedWidth?: number;
  "aria-label"?: string;
}

export const TextInput = ({ value, onChange, mono, placeholder, fixedWidth, ...aria }: TextFieldProps) => (
  <input
    className={join(styles.input, mono && styles.mono, fixedWidth !== undefined && styles.fixed)}
    style={fixedWidth === undefined ? undefined : { width: fixedWidth }}
    type="text"
    value={value}
    placeholder={placeholder}
    onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    {...aria}
  />
);

interface NumberInputProps {
  value: number | string;
  onChange: (value: number | "") => void;
  fixedWidth?: number;
  "aria-label"?: string;
}

export const NumberInput = ({ value, onChange, fixedWidth, ...aria }: NumberInputProps) => (
  <input
    className={join(styles.input, fixedWidth !== undefined && styles.fixed)}
    style={fixedWidth === undefined ? undefined : { width: fixedWidth }}
    type="number"
    value={value}
    onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
    {...aria}
  />
);

export type SelectOption = string | readonly [value: string, label: string];

interface SelectInputProps {
  value: string | number;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  fixedWidth?: number;
  "aria-label"?: string;
}

const optionParts = (option: SelectOption): readonly [string, string] =>
  typeof option === "string" ? [option, option] : option;

export const SelectInput = ({ value, options, onChange, fixedWidth, ...aria }: SelectInputProps) => (
  <select
    className={join(styles.input, fixedWidth !== undefined && styles.fixed)}
    style={fixedWidth === undefined ? undefined : { width: fixedWidth }}
    value={String(value)}
    onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
    {...aria}
  >
    {options.map((option) => {
      const [optionValue, label] = optionParts(option);
      return (
        <option key={optionValue} value={optionValue}>
          {label}
        </option>
      );
    })}
  </select>
);

interface AreaInputProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  json?: boolean;
  "aria-label"?: string;
}

export const AreaInput = ({ value, onChange, rows = 4, json, ...aria }: AreaInputProps) => (
  <textarea
    className={join(styles.input, json && !okJSON(value) && styles.bad)}
    rows={rows}
    spellCheck={false}
    value={value}
    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
    {...aria}
  />
);

interface CheckInputProps {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  fixed?: boolean;
}

export const CheckInput = ({ checked, label, onChange, fixed }: CheckInputProps) => (
  <label className={join(styles.checkbox, fixed && styles.fixed)}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
  </label>
);

export const Row = ({ children }: { children: ReactNode }) => <div className={styles.row}>{children}</div>;

export const Fixed = ({ children }: { children: ReactNode }) => <span className={styles.fixed}>{children}</span>;

export const Section = ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) => (
  <section className={styles.section}>
    <h4 className={styles.sectionTitle}>
      <span>{title}</span>
      {action}
    </h4>
    {children}
  </section>
);

export const Note = ({ children }: { children: ReactNode }) => <div className={styles.note}>{children}</div>;

export const Muted = ({ children }: { children: ReactNode }) => <span className={styles.muted}>{children}</span>;

export const Code = ({ children }: { children: ReactNode }) => <pre className={styles.code}>{children}</pre>;

export const FieldCaption = ({ children }: { children: ReactNode }) => (
  <div className={styles.fieldLabel}>{children}</div>
);

export const WarnBox = ({ children }: { children: ReactNode }) => <div className={styles.warnBox}>{children}</div>;

export const OkBox = ({ children }: { children: ReactNode }) => <div className={styles.okBox}>{children}</div>;

export const Tag = ({ children, strong }: { children: ReactNode; strong?: boolean }) => (
  <span className={join(styles.tag, strong && styles.tagStrong)}>{children}</span>
);

export const Collapsible = ({
  summary,
  open,
  onToggle,
  children,
}: {
  summary: ReactNode;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) => (
  <details className={styles.details} open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
    <summary>{summary}</summary>
    <div>{children}</div>
  </details>
);

export const DataTable = ({ children }: { children: ReactNode }) => <table className={styles.table}>{children}</table>;
