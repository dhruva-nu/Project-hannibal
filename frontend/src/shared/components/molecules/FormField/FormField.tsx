import type { ReactNode } from "react";
import { FieldCaption } from "@/shared/components/atoms/FieldCaption/FieldCaption";
import styles from "./FormField.module.css";

interface FormFieldProps {
  label: string;
  children: ReactNode;
}

export const FormField = ({ label, children }: FormFieldProps) => (
  <label className={styles.field}>
    <FieldCaption>{label}</FieldCaption>
    {children}
  </label>
);
