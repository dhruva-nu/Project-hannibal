import { findNode, useArch } from "../../../state/archApi";
import { ApiDetail } from "./ApiDetail";
import { ConnectorDetail } from "./ConnectorDetail";
import { GenericDetail } from "./GenericDetail";
import { NosqlDetail } from "./NosqlDetail";
import { SqlDetail } from "./SqlDetail";
import { StateDetail } from "./StateDetail";

interface DetailModalProps {
  nodeId: string;
  onClose: () => void;
}

export const DetailModal = ({ nodeId, onClose }: DetailModalProps) => {
  const { model } = useArch();
  const node = findNode(model, nodeId);
  if (!node) return null;
  switch (node.type) {
    case "sqldb":
      return <SqlDetail node={node} onClose={onClose} />;
    case "nosql":
      return <NosqlDetail node={node} onClose={onClose} />;
    case "state":
      return <StateDetail node={node} onClose={onClose} />;
    case "connector":
      return <ConnectorDetail node={node} onClose={onClose} />;
    case "api":
      return <ApiDetail node={node} onClose={onClose} />;
    default:
      return <GenericDetail node={node} onClose={onClose} />;
  }
};
