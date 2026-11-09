import { InlineCheckbox, NumberInput, SelectInput, TextArea, TextInput, type SelectOption } from "@/shared/components/atoms";
import { isValidJson } from "@/pages/ArchTest/engine";
import type { Editor } from "./panelEditor";

interface BoundBase {
  editor: Editor;
  path: string;
  "aria-label"?: string;
  width?: number;
}

export const BoundText = ({
  editor,
  path,
  value,
  ...rest
}: BoundBase & { value: string | number; monospace?: boolean; placeholder?: string }) => (
  <TextInput value={value} onChange={(next) => editor.set(path, next)} {...rest} />
);

export const BoundNumber = ({ editor, path, value, ...rest }: BoundBase & { value: number | string }) => (
  <NumberInput value={value} onChange={(next) => editor.set(path, next)} {...rest} />
);

export const BoundSelect = ({
  editor,
  path,
  value,
  options,
  ...rest
}: BoundBase & { value: string | number; options: readonly SelectOption[] }) => (
  <SelectInput value={value} options={options} onChange={(next) => editor.set(path, next)} {...rest} />
);

type BoundAreaProps = Pick<BoundBase, "editor" | "path" | "aria-label"> & { value: string; rows?: number };

export const BoundTextArea = ({ editor, path, value, rows, ...rest }: BoundAreaProps) => (
  <TextArea value={value} rows={rows} onChange={(next) => editor.set(path, next)} {...rest} />
);

export const BoundJsonArea = ({
  editor,
  path,
  value,
  rows,
  ...rest
}: BoundAreaProps) => (
  <TextArea value={value} rows={rows} invalid={!isValidJson(value)} onChange={(next) => editor.set(path, next)} {...rest} />
);

export const BoundCheck = ({
  editor,
  path,
  checked,
  label,
  keepWidth,
}: Pick<BoundBase, "editor" | "path"> & { checked: boolean; label: string; keepWidth?: boolean }) => (
  <InlineCheckbox checked={checked} label={label} keepWidth={keepWidth} onChange={(next) => editor.set(path, next)} />
);
