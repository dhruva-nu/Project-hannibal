import type { Snapshot } from "@/pages/ArchTest/engine";
import type { ModalState } from "@/pages/ArchTest/state/archApi";
import { ConfirmDialog } from "@/shared/components/molecules";
import { ConnectPickerModal } from "./ConnectPickerModal";
import { DetailModal } from "./details/DetailModal";
import { StateDetail } from "./details/StateDetail";
import { FlowModal } from "./FlowModal";
import { IoModal } from "./IoModal";

interface ModalHostProps {
  modal: ModalState | null;
  onClose: () => void;
  onLoadDiagram: (diagram: Snapshot) => void;
}

export const ArchModalHost = ({ modal, onClose, onLoadDiagram }: ModalHostProps) => {
  if (!modal) return null;
  switch (modal.kind) {
    case "confirm":
      return <ConfirmDialog {...modal.request} onClose={onClose} />;
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
    case "state":
      return <StateDetail onClose={onClose} />;
    case "flow":
      return <FlowModal edgeId={modal.edgeId} onClose={onClose} />;
    case "picker":
      return <ConnectPickerModal fromId={modal.fromId} toId={modal.toId} onClose={onClose} />;
  }
};
