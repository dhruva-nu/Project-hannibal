import { VAR_TYPES, newVariable, readersOf, writersOf, type StateVar } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { HintText, ToolButton } from "@/shared/components/atoms";
import { ArchNodeLinks } from "@/shared/components/molecules";
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

export const VariableList = ({ items, path, editor, emptyNote, showUsage }: VariableListProps) => {
  const { model } = useArch();
  return (
    <>
      {!items.length && <HintText>{emptyNote}</HintText>}
      {items.map((variable, index) => (
        <div key={variable.id}>
          <div className={styles.varRow}>
            <BoundText editor={editor} path={`${path}.${index}.name`} value={variable.name} monospace aria-label="Variable name" />
            <BoundSelect editor={editor} path={`${path}.${index}.type`} value={variable.type} options={VAR_TYPES} aria-label="Variable type" />
            <BoundText editor={editor} path={`${path}.${index}.init`} value={variable.init} monospace placeholder="initial, JSON" aria-label="Initial value" />
            <RemoveButton label={`Remove ${variable.name}`} onClick={() => editor.remove(path, index)} />
          </div>
          {showUsage && (
            <HintText>
              Read by <ArchNodeLinks nodes={readersOf(model, variable.id)} /> · modified by{" "}
              <ArchNodeLinks nodes={writersOf(model, variable.id)} />
            </HintText>
          )}
        </div>
      ))}
      <ToolButton small onClick={() => editor.push(path, newVariable(items))}>
        Add variable
      </ToolButton>
    </>
  );
};
