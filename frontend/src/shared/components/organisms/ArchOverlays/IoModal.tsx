import { useState } from "react";
import { assertKnownNodeTypes, snapshotOf, type Snapshot } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { HintText, MutedText, TextArea, ToolButton } from "@/shared/components/atoms";
import { FormRow } from "@/shared/components/molecules";
import { Modal } from "@/shared/components/molecules";
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
  assertKnownNodeTypes(candidate.nodes);
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
      <HintText>Copy this text to save the diagram, or paste a saved diagram and load it.</HintText>
      <TextArea value={text} onChange={setText} rows={14} aria-label="Diagram JSON" />
      <div className={styles.topGap}>
        <FormRow>
          <ToolButton keepWidth onClick={copy}>
            Copy
          </ToolButton>
          <ToolButton keepWidth onClick={load}>
            Load from text
          </ToolButton>
          <MutedText>{message}</MutedText>
        </FormRow>
      </div>
    </Modal>
  );
};
