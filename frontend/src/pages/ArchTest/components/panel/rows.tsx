import { Fragment, type ReactNode } from "react";
import { Note, ToolButton } from "../../ui/Controls";
import type { Editor } from "./panelEditor";

export const RemoveButton = ({ onClick, label = "Remove" }: { onClick: () => void; label?: string }) => (
  <ToolButton small fixed onClick={onClick} aria-label={label}>
    ✕
  </ToolButton>
);

export const AddRowButton = ({
  label,
  editor,
  path,
  item,
}: {
  label: string;
  editor: Editor;
  path: string;
  item: unknown;
}) => (
  <ToolButton small onClick={() => editor.push(path, item)}>
    {label}
  </ToolButton>
);

interface RowListProps<T> {
  items: readonly T[];
  path: string;
  editor: Editor;
  emptyNote?: string;
  removeLabel?: string;
  renderRow: (item: T, index: number, rowPath: string, removeButton: ReactNode) => ReactNode;
}

export const RowList = <T,>({ items, path, editor, emptyNote, removeLabel, renderRow }: RowListProps<T>) => {
  if (!items.length) return emptyNote ? <Note>{emptyNote}</Note> : null;
  return (
    <>
      {items.map((item, index) => (
        <Fragment key={index}>
          {renderRow(
            item,
            index,
            `${path}.${index}`,
            <RemoveButton label={removeLabel} onClick={() => editor.remove(path, index)} />,
          )}
        </Fragment>
      ))}
    </>
  );
};
