import { AreaInput, CheckInput, NumberInput, SelectInput, TextInput, type SelectOption } from "../../ui/Controls";
import type { Editor } from "./panelEditor";

interface BoundBase {
  editor: Editor;
  path: string;
  "aria-label"?: string;
  fixedWidth?: number;
}

export const BoundText = ({
  editor,
  path,
  value,
  ...rest
}: BoundBase & { value: string | number; mono?: boolean; placeholder?: string }) => (
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

export const BoundArea = ({
  editor,
  path,
  value,
  rows,
  json,
  ...rest
}: Pick<BoundBase, "editor" | "path" | "aria-label"> & { value: string; rows?: number; json?: boolean }) => (
  <AreaInput value={value} rows={rows} json={json} onChange={(next) => editor.set(path, next)} {...rest} />
);

export const BoundCheck = ({
  editor,
  path,
  checked,
  label,
  fixed,
}: Pick<BoundBase, "editor" | "path"> & { checked: boolean; label: string; fixed?: boolean }) => (
  <CheckInput checked={checked} label={label} fixed={fixed} onChange={(next) => editor.set(path, next)} />
);
