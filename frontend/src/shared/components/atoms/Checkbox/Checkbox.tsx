import React, { useId } from "react";
import styles from "./Checkbox.module.css";

interface CheckboxProps {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  name?: string;
}

export const Checkbox = ({ label, checked, defaultChecked, onChange, name }: CheckboxProps) => {
  const id = useId();

  return (
    <label className={styles.label} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        name={name}
        checked={checked}
        defaultChecked={defaultChecked}
        onChange={onChange}
        className={styles.input}
      />
      <span className={styles.box} aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
};
