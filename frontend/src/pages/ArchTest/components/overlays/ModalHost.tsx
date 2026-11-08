import type { Snapshot } from "../../engine";
import type { ModalState } from "../../state/archApi";
import { ConfirmModal } from "./ConfirmModal";
import { ConnectPickerModal } from "./ConnectPickerModal";
import { DetailModal } from "./details/DetailModal";
import { FlowModal } from "./FlowModal";
import { IoModal } from "./IoModal";

interface ModalHostProps {
  modal: ModalState | null;
  onClose: () => void;
  onLoadDiagram: (diagram: Snapshot) => void;
}

export const ModalHost = ({ modal, onClose, onLoadDiagram }: ModalHostProps) => {
  if (!modal) return null;
  switch (modal.kind) {
    case "confirm":
      return <ConfirmModal request={modal.request} onClose={onClose} />;
    case "io":
      return (
        <IoModal
          onClose={onClose}
          onLoadDiagram={(diagram) => {
            onClose();
            onLoadDiagram(diagram);
          }}
        />
      );
    case "detail":
      return <DetailModal nodeId={modal.nodeId} onClose={onClose} />;
    case "flow":
      return <FlowModal edgeId={modal.edgeId} onClose={onClose} />;
    case "picker":
      return <ConnectPickerModal fromId={modal.fromId} toId={modal.toId} onClose={onClose} />;
  }
};
