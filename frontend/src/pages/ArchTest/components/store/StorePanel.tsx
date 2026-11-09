import { useArch } from "../../state/archApi";
import { Note, ToolButton } from "../../ui/Controls";
import { StateLine } from "../canvas/NodeBody";
import { useEditor } from "../panel/panelEditor";
import { VariableList } from "../panel/VariableList";
import styles from "./store.module.css";

const TracedValues = () => {
  const { model, trace } = useArch();
  return (
    <>
      <Note>Values at the current trace step.</Note>
      {model.store.map((variable) => (
        <StateLine key={variable.id} variable={variable} trace={trace} />
      ))}
    </>
  );
};

export const StorePanel = ({ onClose }: { onClose: () => void }) => {
  const { model, trace, openModal } = useArch();
  const editor = useEditor("model", "store");
  return (
    <aside className={styles.store} aria-label="App state">
      <header className={styles.head}>
        <div>
          <div className={styles.title}>App state</div>
          <div className={styles.subtitle}>Shared by every component</div>
        </div>
        <ToolButton small aria-label="Hide app state" onClick={onClose}>
          ✕
        </ToolButton>
      </header>
      <div className={styles.body}>
        {trace ? (
          <TracedValues />
        ) : (
          <VariableList
            items={model.store}
            path="store"
            editor={editor}
            emptyNote="Nothing global yet. Values several components share, like the signed-in user, go here."
            showUsage
          />
        )}
      </div>
      <footer className={styles.foot}>
        <ToolButton small onClick={() => openModal({ kind: "state" })}>
          Who reads and writes what
        </ToolButton>
      </footer>
    </aside>
  );
};
