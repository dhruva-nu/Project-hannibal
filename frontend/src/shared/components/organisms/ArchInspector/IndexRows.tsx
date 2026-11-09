import type { IndexDef } from "@/pages/ArchTest/engine";
import { FieldCaption } from "@/shared/components/atoms";
import { FormRow } from "@/shared/components/molecules";
import { BoundCheck, BoundText } from "./Bound";
import type { Editor } from "./panelEditor";
import { AddRowButton, RowList } from "./rows";

interface Props {
  indexes: readonly IndexDef[];
  path: string;
  editor: Editor;
  columnsPlaceholder: string;
  newIndex: IndexDef;
  addLabel: string;
}

export const IndexRows = ({ indexes, path, editor, columnsPlaceholder, newIndex, addLabel }: Props) => (
  <>
    <FieldCaption>Indexes</FieldCaption>
    <RowList
      items={indexes}
      path={path}
      editor={editor}
      renderRow={(index, _i, rowPath, removeButton) => (
        <FormRow>
          <BoundText editor={editor} path={`${rowPath}.name`} value={index.name} monospace placeholder="name" aria-label="Index name" />
          <BoundText editor={editor} path={`${rowPath}.columns`} value={index.columns} monospace placeholder={columnsPlaceholder} aria-label="Index columns" />
          <BoundCheck editor={editor} path={`${rowPath}.unique`} checked={index.unique} label="unique" keepWidth />
          {removeButton}
        </FormRow>
      )}
    />
    <AddRowButton label={addLabel} editor={editor} path={path} item={newIndex} />
  </>
);
