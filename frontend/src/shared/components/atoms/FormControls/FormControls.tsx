import type { ChangeEvent } from "react";
import { classNames } from "@/shared/utils/classNames";
import type { SelectOption } from "./selectOption";
import styles from "./FormControls.module.css";

interface AccessibleName {
  "aria-label"?: string;
}

const widthStyle = (width?: number) => (width === undefined ? undefined : { width });

const controlClass = (width?: number, ...extra: Array<string | false | undefined>) =>
  classNames(styles.control, width !== undefined && styles.keepWidth, ...extra);

interface TextInputProps extends AccessibleName {
  value: string | number;
  onChange: (value: string) => void;
  monospace?: boolean;
  placeholder?: string;
  width?: number;
}

export const TextInput = ({ value, onChange, monospace, placeholder, width, ...aria }: TextInputProps) => (
  <input
    className={controlClass(width, monospace && styles.monospace)}
    style={widthStyle(width)}
    type="text"
    value={value}
    placeholder={placeholder}
    onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
    {...aria}
  />
);

interface NumberInputProps extends AccessibleName {
  value: number | string;
  onChange: (value: number | "") => void;
  width?: number;
}

export const NumberInput = ({ value, onChange, width, ...aria }: NumberInputProps) => (
  <input
    className={controlClass(width)}
    style={widthStyle(width)}
    type="number"
    value={value}
    onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
    {...aria}
  />
);

interface SelectInputProps extends AccessibleName {
  value: string | number;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  width?: number;
}

const valueAndLabel = (option: SelectOption): readonly [string, string] => (typeof option === "string" ? [option, option] : option);

export const SelectInput = ({ value, options, onChange, width, ...aria }: SelectInputProps) => (
  <select
    className={controlClass(width)}
    style={widthStyle(width)}
    value={String(value)}
    onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
    {...aria}
  >
    {options.map((option) => {
      const [optionValue, label] = valueAndLabel(option);
      return (
        <option key={optionValue} value={optionValue}>
          {label}
        </option>
      );
    })}
  </select>
);

interface TextAreaProps extends AccessibleName {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  invalid?: boolean;
}

export const TextArea = ({ value, onChange, rows = 4, invalid, ...aria }: TextAreaProps) => (
  <textarea
    className={classNames(styles.control, styles.textArea, invalid && styles.invalid)}
    rows={rows}
    spellCheck={false}
    value={value}
    aria-invalid={invalid || undefined}
    onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
    {...aria}
  />
);

interface InlineCheckboxProps {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  keepWidth?: boolean;
}

export const InlineCheckbox = ({ checked, label, onChange, keepWidth }: InlineCheckboxProps) => (
  <label className={classNames(styles.checkbox, keepWidth && styles.keepWidth)}>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /> {label}
  </label>
);
