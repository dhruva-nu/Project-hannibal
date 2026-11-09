import { findNode } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { GenericDetail } from "./GenericDetail";
import { NosqlDetail } from "./NosqlDetail";
import { ServiceDetail } from "./ServiceDetail";
import { SqlDetail } from "./SqlDetail";

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
    case "service":
      return <ServiceDetail node={node} onClose={onClose} />;
    default:
      return <GenericDetail node={node} onClose={onClose} />;
  }
};
