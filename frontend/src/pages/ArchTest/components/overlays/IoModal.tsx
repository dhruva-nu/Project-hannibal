import { useState } from "react";
import { snapshotOf, type Snapshot } from "../../engine";
import { useArch } from "../../state/archApi";
import { AreaInput, Muted, Note, Row, ToolButton } from "../../ui/Controls";
import { Modal } from "./Modal";
import styles from "./overlays.module.css";

interface IoModalProps {
  onClose: () => void;
  onLoadDiagram: (diagram: Snapshot) => void;
}

const exportText = (snapshot: string): string => JSON.stringify(JSON.parse(snapshot), null, 1);

const parseDiagram = (text: string): Snapshot => {
  const parsed: unknown = JSON.parse(text);
  const candidate = parsed as Partial<Snapshot> | null;
  if (!candidate || !Array.isArray(candidate.nodes)) throw new Error("no nodes");
  return candidate as Snapshot;
};

export const IoModal = ({ onClose, onLoadDiagram }: IoModalProps) => {
  const api = useArch();
  const [text, setText] = useState(() => exportText(snapshotOf(api.model)));
  const [message, setMessage] = useState("");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Copied");
    } catch {
      setMessage("Select the text and copy it");
    }
  };

  const load = () => {
    try {
      onLoadDiagram(parseDiagram(text));
    } catch (error) {
      setMessage(`That text is not a valid diagram: ${(error as Error).message}`);
    }
  };

  return (
    <Modal title="Export or import JSON" wide onClose={onClose}>
      <Note>Copy this text to save the diagram, or paste a saved diagram and load it.</Note>
      <AreaInput value={text} onChange={setText} rows={14} aria-label="Diagram JSON" />
      <div className={styles.topGap}>
        <Row>
          <ToolButton fixed onClick={copy}>
            Copy
          </ToolButton>
          <ToolButton fixed onClick={load}>
            Load from text
          </ToolButton>
          <Muted>{message}</Muted>
        </Row>
      </div>
    </Modal>
  );
};
