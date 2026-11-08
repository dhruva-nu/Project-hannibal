import type { IndexDef } from "../../engine";
import { FieldCaption, Row } from "../../ui/Controls";
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
        <Row>
          <BoundText editor={editor} path={`${rowPath}.name`} value={index.name} mono placeholder="name" aria-label="Index name" />
          <BoundText editor={editor} path={`${rowPath}.columns`} value={index.columns} mono placeholder={columnsPlaceholder} aria-label="Index columns" />
          <BoundCheck editor={editor} path={`${rowPath}.unique`} checked={index.unique} label="unique" fixed />
          {removeButton}
        </Row>
      )}
    />
    <AddRowButton label={addLabel} editor={editor} path={path} item={newIndex} />
  </>
);
