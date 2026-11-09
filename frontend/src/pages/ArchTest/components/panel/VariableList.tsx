import { VAR_TYPES, readersOf, uid, writersOf, type StateVar } from "../../engine";
import { useArch } from "../../state/archApi";
import { Note, ToolButton } from "../../ui/Controls";
import { NodeLinks } from "../../ui/NodeLinks";
import { BoundSelect, BoundText } from "./Bound";
import type { Editor } from "./panelEditor";
import { RemoveButton } from "./rows";
import styles from "./panel.module.css";

interface VariableListProps {
  items: readonly StateVar[];
  path: string;
  editor: Editor;
  emptyNote: string;
  showUsage?: boolean;
}

export const newVariable = (existing: readonly StateVar[]): StateVar => ({
  id: uid("v"),
  name: "variable" + (existing.length + 1),
  type: "string",
  init: '""',
});

export const VariableList = ({ items, path, editor, emptyNote, showUsage }: VariableListProps) => {
  const { model } = useArch();
  return (
    <>
      {!items.length && <Note>{emptyNote}</Note>}
      {items.map((variable, index) => (
        <div key={variable.id}>
          <div className={styles.varRow}>
            <BoundText editor={editor} path={`${path}.${index}.name`} value={variable.name} mono aria-label="Variable name" />
            <BoundSelect editor={editor} path={`${path}.${index}.type`} value={variable.type} options={VAR_TYPES} aria-label="Variable type" />
            <BoundText editor={editor} path={`${path}.${index}.init`} value={variable.init} mono placeholder="initial, JSON" aria-label="Initial value" />
            <RemoveButton label={`Remove ${variable.name}`} onClick={() => editor.remove(path, index)} />
          </div>
          {showUsage && (
            <Note>
              Read by <NodeLinks nodes={readersOf(model, variable.id)} /> · modified by{" "}
              <NodeLinks nodes={writersOf(model, variable.id)} />
            </Note>
          )}
        </div>
      ))}
      <ToolButton small onClick={() => editor.push(path, newVariable(items))}>
        Add variable
      </ToolButton>
    </>
  );
};
